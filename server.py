"""osu! Skill Lab Mobile/PWA v0.5 â€” local-only prototype, Python 3.10+."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import struct,lzma,json,math,statistics,webbrowser,threading,hashlib
from datetime import datetime, timezone
import osu_api
BASE=Path(__file__).resolve().parent; MAX_UPLOAD=25*1024*1024

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
        features.append({'t':o['t'],'gap':gap,'dist':round(dist,1) if dist is not None else None,'angle':round(ang,1) if ang is not None else None,'type':o['type']})
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
                return self.sendj({'error':'Not found'},404)
            except Exception as exc: return self.sendj({'error':str(exc)},400)
        if p in ('/manifest.webmanifest','/sw.js','/mobile-analyzer.js'):
            fp=BASE/p.lstrip('/');b=fp.read_bytes();ct='application/manifest+json' if p.endswith('.webmanifest') else ('text/javascript; charset=utf-8' if p.endswith('.js') else 'application/octet-stream');self.send_response(200);self.send_header('Content-Type',ct);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if p=='/version.json':
            b=(BASE/'version.json').read_bytes();self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if p not in ('/','/index.html'):self.send_error(404);return
        b=(BASE/'index.html').read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<1 or n>MAX_UPLOAD:raise ValueError('mŒŒì¼ì€ 25MB ì´í•˜ì—¬ì•¼ í•©ë‹ˆë‹¤.')
            b=self.rfile.read(n);p=urlparse(self.path).path
            self.sendj(parse_map(b) if p=='/api/map' else parse_replay(b) if p=='/api/replay' else {'error':'not found'},200 if p in ('/api/map','/api/replay') else 404)
        except Exception as e:self.sendj({'error':str(e)},400)
    def log_message(self,*a):pass

def main():
    s=ThreadingHTTPServer(('127.0.0.1',0),H);u=f'http://127.0.0.1:{s.server_port}';print('osu! Skill Lab Ranked Edition v0.2:',u);threading.Timer(.7,lambda:webbrowser.open(u)).start()
    try:s.serve_forever()
    except KeyboardInterrupt:pass
if __name__=='__main__':main()
