"""osu! Skill Lab Mobile/PWA v0.5 â€” local-only prototype, Python 3.10+."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import struct,lzma,json,math,statistics,webbrowser,threading,hashlib,os,sqlite3,time,uuid
from datetime import datetime, timezone
import osu_api
BASE=Path(__file__).resolve().parent; MAX_UPLOAD=25*1024*1024
CLIENT_HOME=Path.home()/'.osu-skill-lab'
CLIENT_CONFIG=CLIENT_HOME/'client.json'
CLIENT_DB=CLIENT_HOME/'client.db'
CLIENT_SCAN_LOCK=threading.Lock()
CLIENT_SCAN={'running':False,'scanned':0,'updated':0,'reused':0,'errors':0,'started_at':None,'finished_at':None,'message':'대기 중'}
CLIENT_REPLAY_LOCK=threading.Lock()
CLIENT_REPLAY_SCAN={'running':False,'scanned':0,'updated':0,'reused':0,'errors':0,'started_at':None,'finished_at':None,'message':'대기 중'}

def client_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def client_json_read(path,default):
    try:return json.loads(path.read_text(encoding='utf-8'))
    except:return default

def client_json_write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    tmp.replace(path)

def client_candidates():
    out=[]
    env=os.environ.get('OSU_SONGS')
    if env:out.append(Path(env))
    local=os.environ.get('LOCALAPPDATA')
    if local:out.append(Path(local)/'osu!'/'Songs')
    out.extend([Path.home()/'AppData'/'Local'/'osu!'/'Songs',Path('C:/osu!/Songs'),Path('D:/osu!/Songs')])
    seen=set();result=[]
    for p in out:
        try:key=str(p.expanduser().resolve()).lower()
        except:key=str(p).lower()
        if key not in seen:
            seen.add(key);result.append(p.expanduser())
    return result

def client_resolve_songs():
    cfg=client_json_read(CLIENT_CONFIG,{})
    configured=str(cfg.get('songs_path') or '').strip()
    if configured:
        p=Path(configured).expanduser()
        if p.exists() and p.is_dir():return p.resolve(),'configured'
    for p in client_candidates():
        if p.exists() and p.is_dir():return p.resolve(),'auto'
    return None,'missing'

def client_db():
    CLIENT_HOME.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(CLIENT_DB,timeout=30)
    db.row_factory=sqlite3.Row
    db.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS maps(
      path TEXT PRIMARY KEY, root TEXT NOT NULL, mtime_ns INTEGER NOT NULL, size INTEGER NOT NULL,
      md5 TEXT, beatmap_id INTEGER, beatmapset_id INTEGER, artist TEXT, title TEXT,
      creator TEXT, version TEXT, mode INTEGER, ar REAL, od REAL, cs REAL, hp REAL,
      bpm REAL, scan_token TEXT, indexed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_maps_root ON maps(root);
    CREATE INDEX IF NOT EXISTS idx_maps_md5 ON maps(md5);
    CREATE INDEX IF NOT EXISTS idx_maps_beatmap_id ON maps(beatmap_id);
    CREATE INDEX IF NOT EXISTS idx_maps_title ON maps(title);
    CREATE INDEX IF NOT EXISTS idx_maps_creator ON maps(creator);
    CREATE TABLE IF NOT EXISTS replays(
      path TEXT PRIMARY KEY, root TEXT NOT NULL, record_id TEXT NOT NULL, mtime_ns INTEGER NOT NULL, size INTEGER NOT NULL,
      map_hash TEXT, replay_hash TEXT, player TEXT, replay_time TEXT, score INTEGER, combo INTEGER, mods INTEGER,
      accuracy REAL, miss INTEGER, non300_rate REAL, scan_token TEXT, indexed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_replays_record_id ON replays(record_id);
    CREATE INDEX IF NOT EXISTS idx_replays_root ON replays(root);
    CREATE INDEX IF NOT EXISTS idx_replays_map_hash ON replays(map_hash);
    CREATE INDEX IF NOT EXISTS idx_replays_time ON replays(replay_time);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
    ''')
    return db

def client_meta_set(db,key,value):
    db.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,str(value)))

def client_meta_get(db,key,default=None):
    row=db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
    return row['value'] if row else default

def client_resolve_replays():
    cfg=client_json_read(CLIENT_CONFIG,{})
    configured=str(cfg.get('replay_path') or '').strip()
    if configured:
        p=Path(configured).expanduser()
        if p.exists() and p.is_dir():return p.resolve(),'configured'
    songs,_=client_resolve_songs()
    if songs:
        sibling=songs.parent/'Replays'
        if sibling.exists() and sibling.is_dir():return sibling.resolve(),'auto'
    local=os.environ.get('LOCALAPPDATA')
    if local:
        p=Path(local)/'osu!'/'Replays'
        if p.exists() and p.is_dir():return p.resolve(),'auto'
    return None,'missing'

def client_replay_record_id(path):
    return hashlib.sha1(str(Path(path).resolve()).encode('utf-8','replace')).hexdigest()[:24]

def client_scan_replay_worker(root):
    root=Path(root).resolve();token=uuid.uuid4().hex;now=client_now();db=None
    with CLIENT_REPLAY_LOCK:
        CLIENT_REPLAY_SCAN.update({'running':True,'scanned':0,'updated':0,'reused':0,'errors':0,'started_at':now,'finished_at':None,'message':'Replay Inbox 검색 중'})
    try:
        db=client_db();root_s=str(root)
        for path in root.rglob('*.osr'):
            with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['scanned']+=1
            try:
                st=path.stat();path_s=str(path.resolve());record_id=client_replay_record_id(path_s)
                old=db.execute('SELECT mtime_ns,size FROM replays WHERE path=?',(path_s,)).fetchone()
                if old and int(old['mtime_ns'])==int(st.st_mtime_ns) and int(old['size'])==int(st.st_size):
                    db.execute('UPDATE replays SET scan_token=? WHERE path=?',(token,path_s))
                    with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['reused']+=1
                else:
                    r=parse_replay(path.read_bytes());h=r.get('hits') or {}
                    db.execute('''INSERT INTO replays(path,root,record_id,mtime_ns,size,map_hash,replay_hash,player,replay_time,score,combo,mods,accuracy,miss,non300_rate,scan_token,indexed_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                      ON CONFLICT(path) DO UPDATE SET root=excluded.root,record_id=excluded.record_id,mtime_ns=excluded.mtime_ns,size=excluded.size,
                      map_hash=excluded.map_hash,replay_hash=excluded.replay_hash,player=excluded.player,replay_time=excluded.replay_time,
                      score=excluded.score,combo=excluded.combo,mods=excluded.mods,accuracy=excluded.accuracy,miss=excluded.miss,
                      non300_rate=excluded.non300_rate,scan_token=excluded.scan_token,indexed_at=excluded.indexed_at''',
                      (path_s,root_s,record_id,st.st_mtime_ns,st.st_size,str(r.get('map_hash') or '').lower(),str(r.get('replay_hash') or ''),
                       str(r.get('player') or ''),r.get('replay_timestamp'),int(r.get('score') or 0),int(r.get('combo') or 0),int(r.get('mods') or 0),
                       r.get('accuracy'),int(h.get('miss') or 0),r.get('non300_rate'),token,now))
                    with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['updated']+=1
                if CLIENT_REPLAY_SCAN['scanned']%100==0:db.commit()
            except Exception:
                with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['errors']+=1
        db.execute('DELETE FROM replays WHERE root=? AND scan_token<>?',(root_s,token))
        client_meta_set(db,'replay_path',root_s);client_meta_set(db,'last_replay_scan',client_now());db.commit()
        count=db.execute('SELECT COUNT(*) c FROM replays WHERE root=?',(root_s,)).fetchone()['c']
        with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['message']=f'완료 · .osr {count:,}개 Inbox'
    except Exception as exc:
        with CLIENT_REPLAY_LOCK:CLIENT_REPLAY_SCAN['message']='Replay 스캔 실패: '+str(exc)
    finally:
        if db:db.close()
        with CLIENT_REPLAY_LOCK:
            CLIENT_REPLAY_SCAN['running']=False;CLIENT_REPLAY_SCAN['finished_at']=client_now()

def client_start_replay_scan():
    root,source=client_resolve_replays()
    if not root:return {'ok':False,'error':'Replay 폴더를 찾지 못했습니다. .osr 파일이 있는 폴더를 직접 지정해 주세요.'}
    with CLIENT_REPLAY_LOCK:
        if CLIENT_REPLAY_SCAN['running']:return {'ok':True,'started':False,'source':source,'replay_path':str(root),'scan':dict(CLIENT_REPLAY_SCAN)}
    threading.Thread(target=client_scan_replay_worker,args=(root,),daemon=True).start()
    return {'ok':True,'started':True,'source':source,'replay_path':str(root)}

def client_replay_list(limit=30):
    root,_=client_resolve_replays()
    if not root:return []
    limit=max(1,min(100,int(limit or 30)));db=client_db()
    rows=[dict(r) for r in db.execute('''SELECT r.record_id,r.map_hash,r.player,r.replay_time,r.score,r.combo,r.mods,r.accuracy,r.miss,r.non300_rate,
      m.beatmap_id,m.artist,m.title,m.creator,m.version
      FROM replays r LEFT JOIN maps m ON m.md5=r.map_hash
      WHERE r.root=? ORDER BY COALESCE(r.replay_time,r.indexed_at) DESC LIMIT ?''',(str(root),limit)).fetchall()]
    db.close();return rows

def client_replay_analyze(record_id):
    root,_=client_resolve_replays()
    if not root:raise ValueError('Replay 폴더가 설정되지 않았습니다.')
    db=client_db();row=db.execute('SELECT path,map_hash FROM replays WHERE root=? AND record_id=?',(str(root),str(record_id))).fetchone()
    if not row:db.close();raise ValueError('Replay Inbox에서 해당 .osr을 찾지 못했습니다. 다시 스캔해 주세요.')
    path=Path(row['path']).resolve()
    if root not in path.parents:db.close();raise ValueError('설정된 Replay 폴더 밖의 파일은 읽지 않습니다.')
    replay=parse_replay(path.read_bytes());replay['filename']=path.name;local_map=None
    maprow=db.execute('SELECT path FROM maps WHERE md5=? LIMIT 1',(str(row['map_hash'] or '').lower(),)).fetchone()
    db.close()
    if maprow:
        mpath=Path(maprow['path']).resolve();songs,_=client_resolve_songs()
        if songs and songs in mpath.parents:
            local_map=parse_map(mpath.read_bytes());local_map['filename']=mpath.name;local_map['client_source']='replay-inbox-match'
    return {'replay':replay,'map':local_map}

def parse_map_index(blob):
    raw=blob.decode('utf-8-sig','replace');sec='';meta={};diff={};general={};timing=[];mode=0
    for line0 in raw.splitlines():
        line=line0.strip()
        if not line or line.startswith('//'):continue
        if line.startswith('[') and line.endswith(']'):sec=line[1:-1];continue
        if sec in ('Metadata','Difficulty','General') and ':' in line:
            k,v=line.split(':',1);k=k.strip();v=v.strip();{'Metadata':meta,'Difficulty':diff,'General':general}[sec][k]=v
            if sec=='General' and k=='Mode':
                try:mode=int(v)
                except:mode=0
            continue
        if sec=='TimingPoints' and len(timing)<16:
            a=line.split(',')
            try:
                if len(a)>=7 and int(a[6])==1 and float(a[1])>0:timing.append(60000/float(a[1]))
            except:pass
        if sec=='HitObjects':break
    def intval(v):
        try:return int(v)
        except:return None
    def num(v):
        try:return float(v)
        except:return None
    return {
      'md5':hashlib.md5(blob).hexdigest(),'beatmap_id':intval(meta.get('BeatmapID')),
      'beatmapset_id':intval(meta.get('BeatmapSetID')),'artist':meta.get('ArtistUnicode') or meta.get('Artist') or '',
      'title':meta.get('TitleUnicode') or meta.get('Title') or '','creator':meta.get('Creator') or '',
      'version':meta.get('Version') or '','mode':mode,'ar':num(diff.get('ApproachRate')),
      'od':num(diff.get('OverallDifficulty')),'cs':num(diff.get('CircleSize')),'hp':num(diff.get('HPDrainRate')),
      'bpm':round(max(timing),2) if timing else None
    }

def client_scan_worker(root):
    root=Path(root).resolve();token=uuid.uuid4().hex;now=client_now();db=None
    with CLIENT_SCAN_LOCK:
        CLIENT_SCAN.update({'running':True,'scanned':0,'updated':0,'reused':0,'errors':0,'started_at':now,'finished_at':None,'message':'Songs 폴더 검색 중'})
    try:
        db=client_db();root_s=str(root)
        for path in root.rglob('*.osu'):
            with CLIENT_SCAN_LOCK:CLIENT_SCAN['scanned']+=1
            try:
                st=path.stat();path_s=str(path.resolve())
                old=db.execute('SELECT mtime_ns,size,mode FROM maps WHERE path=?',(path_s,)).fetchone()
                if old and int(old['mtime_ns'])==int(st.st_mtime_ns) and int(old['size'])==int(st.st_size):
                    db.execute('UPDATE maps SET scan_token=? WHERE path=?',(token,path_s))
                    with CLIENT_SCAN_LOCK:CLIENT_SCAN['reused']+=1
                else:
                    blob=path.read_bytes();m=parse_map_index(blob)
                    if m['mode']!=0:continue
                    db.execute('''INSERT INTO maps(path,root,mtime_ns,size,md5,beatmap_id,beatmapset_id,artist,title,creator,version,mode,ar,od,cs,hp,bpm,scan_token,indexed_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                      ON CONFLICT(path) DO UPDATE SET root=excluded.root,mtime_ns=excluded.mtime_ns,size=excluded.size,md5=excluded.md5,
                      beatmap_id=excluded.beatmap_id,beatmapset_id=excluded.beatmapset_id,artist=excluded.artist,title=excluded.title,
                      creator=excluded.creator,version=excluded.version,mode=excluded.mode,ar=excluded.ar,od=excluded.od,cs=excluded.cs,hp=excluded.hp,
                      bpm=excluded.bpm,scan_token=excluded.scan_token,indexed_at=excluded.indexed_at''',
                      (path_s,root_s,st.st_mtime_ns,st.st_size,m['md5'],m['beatmap_id'],m['beatmapset_id'],m['artist'],m['title'],m['creator'],m['version'],m['mode'],m['ar'],m['od'],m['cs'],m['hp'],m['bpm'],token,now))
                    with CLIENT_SCAN_LOCK:CLIENT_SCAN['updated']+=1
                if CLIENT_SCAN['scanned']%250==0:
                    db.commit()
                    with CLIENT_SCAN_LOCK:CLIENT_SCAN['message']=f"{CLIENT_SCAN['scanned']:,}개 파일 확인 중"
            except Exception:
                with CLIENT_SCAN_LOCK:CLIENT_SCAN['errors']+=1
        db.execute('DELETE FROM maps WHERE root=? AND scan_token<>?',(root_s,token))
        client_meta_set(db,'songs_path',root_s);client_meta_set(db,'last_scan',client_now());db.commit()
        count=db.execute('SELECT COUNT(*) c FROM maps WHERE root=?',(root_s,)).fetchone()['c']
        with CLIENT_SCAN_LOCK:CLIENT_SCAN['message']=f'완료 · osu!standard {count:,}개 인덱스'
    except Exception as exc:
        with CLIENT_SCAN_LOCK:CLIENT_SCAN['message']='스캔 실패: '+str(exc)
    finally:
        if db:db.close()
        with CLIENT_SCAN_LOCK:
            CLIENT_SCAN['running']=False;CLIENT_SCAN['finished_at']=client_now()

def client_start_scan():
    root,source=client_resolve_songs()
    if not root:return {'ok':False,'error':'osu! stable Songs 폴더를 찾지 못했습니다. 경로를 직접 지정해 주세요.'}
    with CLIENT_SCAN_LOCK:
        if CLIENT_SCAN['running']:return {'ok':True,'started':False,'source':source,'songs_path':str(root),'scan':dict(CLIENT_SCAN)}
    threading.Thread(target=client_scan_worker,args=(root,),daemon=True).start()
    return {'ok':True,'started':True,'source':source,'songs_path':str(root)}

def client_status():
    root,source=client_resolve_songs();count=sets=0;last_scan=None
    try:
        db=client_db()
        if root:
            root_s=str(root);count=db.execute('SELECT COUNT(*) c FROM maps WHERE root=?',(root_s,)).fetchone()['c']
            sets=db.execute('SELECT COUNT(DISTINCT COALESCE(beatmapset_id,path)) c FROM maps WHERE root=?',(root_s,)).fetchone()['c']
        last_scan=client_meta_get(db,'last_scan');db.close()
    except:pass
    replay_root,replay_source=client_resolve_replays();replay_count=0;last_replay_scan=None
    try:
        rdb=client_db()
        if replay_root:replay_count=rdb.execute('SELECT COUNT(*) c FROM replays WHERE root=?',(str(replay_root),)).fetchone()['c']
        last_replay_scan=client_meta_get(rdb,'last_replay_scan');rdb.close()
    except:pass
    with CLIENT_SCAN_LOCK:scan=dict(CLIENT_SCAN)
    with CLIENT_REPLAY_LOCK:replay_scan=dict(CLIENT_REPLAY_SCAN)
    return {'local_server':True,'client_version':'0.2.0','songs_path':str(root) if root else None,'path_source':source,'path_exists':bool(root),'maps':count,'beatmapsets':sets,'last_scan':last_scan,'scan':scan,
      'replay_path':str(replay_root) if replay_root else None,'replay_path_source':replay_source,'replay_path_exists':bool(replay_root),'replays':replay_count,'last_replay_scan':last_replay_scan,'replay_scan':replay_scan}

def client_search(q='',limit=40):
    root,_=client_resolve_songs()
    if not root:return []
    limit=max(1,min(100,int(limit or 40)));terms=[x for x in str(q or '').strip().split() if x]
    db=client_db();root_s=str(root)
    sql='SELECT md5,beatmap_id,beatmapset_id,artist,title,creator,version,ar,od,cs,hp,bpm,path FROM maps WHERE root=?'
    args=[root_s]
    for term in terms:
        like='%'+term+'%';sql+=' AND (artist LIKE ? OR title LIKE ? OR creator LIKE ? OR version LIKE ? OR CAST(beatmap_id AS TEXT)=?)';args.extend([like,like,like,like,term])
    sql+=' ORDER BY indexed_at DESC,title COLLATE NOCASE LIMIT ?';args.append(limit)
    rows=[dict(r) for r in db.execute(sql,args).fetchall()];db.close()
    for r in rows:r.pop('path',None)
    return rows

def client_analyze(md5=None,beatmap_id=None):
    root,_=client_resolve_songs()
    if not root:raise ValueError('Songs 폴더가 설정되지 않았습니다.')
    db=client_db();row=None
    if md5:row=db.execute('SELECT path FROM maps WHERE root=? AND md5=?',(str(root),str(md5).lower())).fetchone()
    elif beatmap_id:row=db.execute('SELECT path FROM maps WHERE root=? AND beatmap_id=?',(str(root),int(beatmap_id))).fetchone()
    db.close()
    if not row:raise ValueError('로컬 인덱스에서 채보를 찾지 못했습니다. 먼저 스캔해 주세요.')
    path=Path(row['path']).resolve()
    if root not in path.parents:raise ValueError('Songs 폴더 밖의 파일은 분석하지 않습니다.')
    result=parse_map(path.read_bytes());result['filename']=path.name;result['client_source']='songs-index'
    return result

def osu_string(b,p):
    marker=b[p];p+=1
    if marker==0:return '',p
    if marker!=0x0b:raise ValueError('Invalid osu string')
    n=0;s=0
    while True:
        v=b[p];p+=1;n|=(v&127)<<s
        if not v&128:break
        s+=7
    return b[p:p+n].decode('utf-8','replace'),p+n

def parse_replay(blob):
    p=0
    def take(f):
        nonlocal p
        z=struct.calcsize('<'+f);v=struct.unpack_from('<'+f,blob,p)[0];p+=z;return v
    mode=take('B');version=take('i')
    if mode!=0:raise ValueError('osu!standard ë¦¬í”Œë ˆì´ë§Œ ì§€ì›í•©ë‹ˆë‹¤.')
    beatmap,p=osu_string(blob,p);player,p=osu_string(blob,p);checksum,p=osu_string(blob,p)
    h=[take('H') for _ in range(6)];score=take('i');combo=take('H');perfect=take('?');mods=take('i');life,p=osu_string(blob,p);ticks=take('q');size=take('i')
    raw=''
    if size>0:
        raw=lzma.decompress(blob[p:p+size],format=lzma.FORMAT_AUTO).decode('utf-8','replace')
    t=0;presses=[];old=0
    for c in raw.split(','):
        a=c.split('|')
        if len(a)!=4:continue
        try:d=int(a[0]);x=float(a[1]);y=float(a[2]);keys=int(a[3])
        except:continue
        if d<0:continue
        t+=d;k=keys&15;mask=((k>>2)&3) if (k&12) else (k&3);rise=mask&~old
        for bit,name in ((1,'K1'),(2,'K2')):
            if rise&bit:presses.append({'t':t,'key':name,'x':x,'y':y})
        old=mask
    gaps=[presses[i]['t']-presses[i-1]['t'] for i in range(1,len(presses))]
    plausible=[x for x in gaps if 35<=x<=300]
    bursts=[];run=[]
    for i,a in enumerate(presses):
        if i and 40<=a['t']-presses[i-1]['t']<=220:run.append(a)
        else:
            if len(run)>=7:bursts.append(run)
            run=[a]
    if len(run)>=7:bursts.append(run)
    bs=[]
    for r in sorted(bursts,key=len,reverse=True)[:20]:
        gs=[r[i]['t']-r[i-1]['t'] for i in range(1,len(r))]
        bs.append({'start':r[0]['t'],'notes':len(r),'bpm':round(15000/statistics.median(gs),1),'std':round(statistics.pstdev(gs),1) if len(gs)>1 else 0})
    judged=h[0]+h[1]+h[2]+h[5]
    accuracy=((300*h[0]+100*h[1]+50*h[2])/(300*judged)*100) if judged else None
    non300=h[1]+h[2]+h[5]
    replay_timestamp=None
    try:
        unix_seconds=(ticks-621355968000000000)/10000000
        if unix_seconds>0:
            replay_timestamp=datetime.fromtimestamp(unix_seconds,tz=timezone.utc).isoformat().replace('+00:00','Z')
    except (OverflowError,OSError,ValueError):
        pass
    burst_std_values=[float(x.get('std') or 0) for x in bs if x.get('std') is not None]
    return {
        'player':player,'version':version,'map_hash':beatmap.lower(),'score':score,'combo':combo,'perfect':bool(perfect),'mods':mods,
        'hits':{'great':h[0],'good':h[1],'meh':h[2],'300':h[0],'100':h[1],'50':h[2],'miss':h[5]},
        'accuracy':round(accuracy,2) if accuracy is not None else None,
        'judged':judged,'non300':non300,
        'miss_rate':round(h[5]/judged*100,2) if judged else None,
        'non300_rate':round(non300/judged*100,2) if judged else None,
        'replay_timestamp':replay_timestamp,
        'header_only':False,'replay_data_analyzed':True,
        'taps':len(presses),'duration_s':round(t/1000,1),
        'median_gap':round(statistics.median(plausible),1) if plausible else None,
        'burst_count':len(bs),
        'burst_std_median':round(statistics.median(burst_std_values),1) if burst_std_values else None,
        'bursts':bs,'presses':presses[:50000]
    }

def fnum(d,k,default=0):
    try:return float(d.get(k,default))
    except:return default

def parse_map(blob):
    raw=blob.decode('utf-8-sig','replace');sec='';meta={};diff={};general={};timing=[];objs=[]
    for line0 in raw.splitlines():
        line=line0.strip()
        if not line or line.startswith('//'):continue
        if line.startswith('[') and line.endswith(']'):sec=line[1:-1];continue
        if sec in ('Metadata','Difficulty','General') and ':' in line:
            k,v=line.split(':',1);{'Metadata':meta,'Difficulty':diff,'General':general}[sec][k.strip()]=v.strip();continue
        if sec=='TimingPoints':
            a=line.split(',')
            try:
                if len(a)>=7 and int(a[6])==1 and float(a[1])>0:timing.append({'t':float(a[0]),'bpm':60000/float(a[1])})
            except:pass
        if sec=='HitObjects':
            a=line.split(',')
            try:
                x,y,t,typ=int(a[0]),int(a[1]),int(a[2]),int(a[3]);kind='circle' if typ&1 else ('slider' if typ&2 else ('spinner' if typ&8 else 'other'))
                objs.append({'x':x,'y':y,'t':t,'type':kind})
            except:pass
    if not objs:raise ValueError('HitObjectsê°€ ì—†ëŠ” .osu íŒŒì¼ìž…ë‹ˆë‹¤.')
    # Per-object geometric/rhythm features.
    gaps=[];dists=[];angles=[];features=[]
    for i,o in enumerate(objs):
        gap=None;dist=None;ang=None
        if i:
            p=objs[i-1];gap=o['t']-p['t'];dist=math.hypot(o['x']-p['x'],o['y']-p['y']);gaps.append(gap);dists.append(dist)
        if i>=2:
            a,b=objs[i-2],objs[i-1];v1=(b['x']-a['x'],b['y']-a['y']);v2=(o['x']-b['x'],o['y']-b['y']);n1=math.hypot(*v1);n2=math.hypot(*v2)
            if n1 and n2:
                c=max(-1,min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2)));ang=math.degrees(math.acos(c));angles.append(ang)
        features.append({'t':o['t'],'x':o['x'],'y':o['y'],'gap':gap,'dist':round(dist,1) if dist is not None else None,'angle':round(ang,1) if ang is not None else None,'type':o['type']})
    # 2-second windows, stepped each second.
    start=objs[0]['t'];end=objs[-1]['t'];timeline=[]
    for t in range((start//1000)*1000,end+1,1000):
        win=[(i,o) for i,o in enumerate(objs) if t<=o['t']<t+2000]
        if not win:continue
        ids=[i for i,_ in win];local_g=[features[i]['gap'] for i in ids if features[i]['gap'] and features[i]['gap']>0];local_d=[features[i]['dist'] for i in ids if features[i]['dist'] is not None];local_a=[features[i]['angle'] for i in ids if features[i]['angle'] is not None]
        density=len(win)/2;speed=sum(max(0,180-g) for g in local_g)/max(1,len(local_g))/1.8;aim=sum((d or 0)/max(45,features[i]['gap'] or 999)*25 for i,d in [(i,features[i]['dist']) for i in ids if features[i]['dist'] is not None])/max(1,len(local_d));tech=(statistics.pstdev(local_g) if len(local_g)>1 else 0)/2+(sum(abs(90-a) for a in local_a)/max(1,len(local_a)))/3
        strain=min(100,density*4+speed*.45+aim*.55+tech*.25)
        timeline.append({'t':t,'density':round(density,1),'strain':round(strain,1)})
    # stream/burst candidates: consecutive 1/4-like short gaps with tolerance.
    runs=[];cur=[]
    for i in range(1,len(objs)):
        g=objs[i]['t']-objs[i-1]['t']
        if 45<=g<=180:
            if not cur:cur=[i-1,i]
            else:
                prev=objs[cur[-1]]['t']-objs[cur[-2]]['t'] if len(cur)>1 else g
                if abs(g-prev)<=max(18,prev*.22):cur.append(i)
                else:
                    if len(cur)>=4:runs.append(cur)
                    cur=[i-1,i]
        else:
            if len(cur)>=4:runs.append(cur)
            cur=[]
    if len(cur)>=4:runs.append(cur)
    patterns=[]
    for r in runs:
        gs=[objs[r[j]]['t']-objs[r[j-1]]['t'] for j in range(1,len(r))];ds=[features[i]['dist'] or 0 for i in r[1:]]
        med=statistics.median(gs);bpm=15000/med
        patterns.append({'start':objs[r[0]]['t'],'end':objs[r[-1]]['t'],'notes':len(r),'bpm':round(bpm,1),'spacing':round(statistics.mean(ds),1) if ds else 0,'kind':'Long Stream' if len(r)>=24 else ('Stream' if len(r)>=10 else 'Burst')})
    patterns=sorted(patterns,key=lambda x:(x['notes'],x['bpm']),reverse=True)[:50]
    circles=sum(o['type']=='circle' for o in objs);sliders=sum(o['type']=='slider' for o in objs)
    duration=max(1,(end-start)/1000);medgap=statistics.median([g for g in gaps if g>0]) if gaps else 1000;mean_dist=statistics.mean(dists) if dists else 0;angle_std=statistics.pstdev(angles) if len(angles)>1 else 0
    maxrun=max([p['notes'] for p in patterns],default=0);fastbpm=max([p['bpm'] for p in patterns],default=0);peak=max([x['strain'] for x in timeline],default=0)
    # Heuristic 0-100 descriptors, explicitly not official difficulty.
    aim=min(100,mean_dist/2.2 + sum(1 for d in dists if d>180)/max(1,len(dists))*35)
    stream=min(100,maxrun*1.6 + max(0,fastbpm-140)*.35)
    speed=min(100,max(0,15000/max(45,medgap)-120)*.65 + sum(1 for g in gaps if 0<g<100)/max(1,len(gaps))*55)
    stamina=min(100,stream*.55 + max(0,duration-90)/5 + len(patterns)*.8)
    tech=min(100,angle_std*.55 + (statistics.pstdev([g for g in gaps if 0<g<500]) if len(gaps)>2 else 0)*.18)
    reading=min(100,len(objs)/duration*9 + fnum(diff,'ApproachRate',fnum(diff,'OverallDifficulty',5))*5)
    flow=min(100,stream*.55 + (statistics.mean([d for d in dists if d<160]) if dists else 0)*.25)
    overall=round((aim+stream+speed+stamina+tech+reading+flow)/7,1)
    bpm=max([x['bpm'] for x in timing],default=0)
    return {'md5':hashlib.md5(blob).hexdigest(),'meta':meta,'difficulty':diff,'general':general,'objects':len(objs),'circles':circles,'sliders':sliders,'duration_s':round(duration,1),'bpm':round(bpm,2),'timeline':timeline,'patterns':patterns,'features':features[:30000],'skills':{'overall':overall,'aim':round(aim,1),'stream':round(stream,1),'speed':round(speed,1),'stamina':round(stamina,1),'tech':round(tech,1),'reading':round(reading,1),'flow':round(flow,1)},'peak':round(peak,1),'stats':{'mean_spacing':round(mean_dist,1),'median_gap':round(medgap,1),'max_stream':maxrun,'pattern_count':len(patterns)}}

class H(BaseHTTPRequestHandler):
    def sendj(self,d,s=200):
        b=json.dumps(d,ensure_ascii=False).encode();self.send_response(s);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        p=urlparse(self.path).path
        if p.startswith('/api/'):
            try:
                q=parse_qs(urlparse(self.path).query)
                if p=='/api/osu/status': return self.sendj({'configured':osu_api.configured(),'version':'0.4.0'})
                if p=='/api/osu/lookup': return self.sendj(osu_api.lookup_md5(q.get('checksum',[''])[0]))
                if p=='/api/osu/search': return self.sendj(osu_api.search_ranked(q.get('q',[''])[0],q.get('page',['1'])[0]))
                if p=='/api/client/status': return self.sendj(client_status())
                if p=='/api/client/library': return self.sendj({'maps':client_search(q.get('q',[''])[0],q.get('limit',['40'])[0])})
                if p=='/api/client/replays': return self.sendj({'replays':client_replay_list(q.get('limit',['30'])[0])})
                return self.sendj({'error':'Not found'},404)
            except Exception as exc: return self.sendj({'error':str(exc)},400)
        if p in ('/','/index.html'):
            fp=BASE/'index.html';ct='text/html; charset=utf-8'
        elif p.startswith('/data/') and p.endswith('.json'):
            fp=(BASE/p.lstrip('/')).resolve()
            data_root=(BASE/'data').resolve()
            if data_root not in fp.parents:self.send_error(404);return
            ct='application/json; charset=utf-8'
        else:
            allowed={
                '/manifest.webmanifest':'application/manifest+json',
                '/sw.js':'text/javascript; charset=utf-8',
                '/mobile-analyzer.js':'text/javascript; charset=utf-8',
                '/mobile-replay.js':'text/javascript; charset=utf-8',
                '/ranked-catalog.js':'text/javascript; charset=utf-8',
                '/client-bridge.js':'text/javascript; charset=utf-8',
                '/profile.js':'text/javascript; charset=utf-8',
                '/app-shell.css':'text/css; charset=utf-8',
                '/version.json':'application/json; charset=utf-8',
            }
            ct=allowed.get(p)
            if not ct:self.send_error(404);return
            fp=BASE/p.lstrip('/')
        if not fp.exists() or not fp.is_file():self.send_error(404);return
        b=fp.read_bytes();self.send_response(200);self.send_header('Content-Type',ct);self.send_header('Cache-Control','no-cache');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        try:
            p=urlparse(self.path).path
            n=int(self.headers.get('Content-Length','0'))
            if n>MAX_UPLOAD:raise ValueError('요청은 25MB 이하여야 합니다.')
            b=self.rfile.read(n) if n else b''
            if p=='/api/client/scan':
                return self.sendj(client_start_scan(),202)
            if p=='/api/client/config':
                data=json.loads(b.decode('utf-8') or '{}');raw=str(data.get('songs_path') or '').strip()
                if not raw:
                    client_json_write(CLIENT_CONFIG,{})
                    return self.sendj(client_status())
                songs=Path(raw).expanduser()
                if not songs.exists() or not songs.is_dir():raise ValueError('존재하는 Songs 폴더 경로를 입력해 주세요.')
                client_json_write(CLIENT_CONFIG,{'songs_path':str(songs.resolve()),'updated_at':client_now()})
                return self.sendj(client_status())
            if p=='/api/client/analyze':
                data=json.loads(b.decode('utf-8') or '{}')
                return self.sendj(client_analyze(data.get('md5'),data.get('beatmap_id')))
            if p=='/api/client/replays/scan':
                return self.sendj(client_start_replay_scan(),202)
            if p=='/api/client/replays/config':
                data=json.loads(b.decode('utf-8') or '{}');raw=str(data.get('replay_path') or '').strip()
                cfg=client_json_read(CLIENT_CONFIG,{})
                if raw:
                    replay_path=Path(raw).expanduser()
                    if not replay_path.exists() or not replay_path.is_dir():raise ValueError('존재하는 Replay 폴더 경로를 입력해 주세요.')
                    cfg['replay_path']=str(replay_path.resolve())
                else:
                    cfg.pop('replay_path',None)
                cfg['updated_at']=client_now();client_json_write(CLIENT_CONFIG,cfg)
                return self.sendj(client_status())
            if p=='/api/client/replays/analyze':
                data=json.loads(b.decode('utf-8') or '{}')
                return self.sendj(client_replay_analyze(data.get('record_id')))
            if n<1:raise ValueError('파일은 비어 있을 수 없습니다.')
            if p=='/api/map':return self.sendj(parse_map(b))
            if p=='/api/replay':return self.sendj(parse_replay(b))
            return self.sendj({'error':'not found'},404)
        except Exception as e:self.sendj({'error':str(e)},400)
    def log_message(self,*a):pass

def main():
    s=ThreadingHTTPServer(('127.0.0.1',0),H);u=f'http://127.0.0.1:{s.server_port}';print('osu! Skill Lab local PC server:',u);threading.Timer(.7,lambda:webbrowser.open(u)).start()
    try:s.serve_forever()
    except KeyboardInterrupt:pass
if __name__=='__main__':main()
