(()=>{
"use strict";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let lastStatus=null,pollTimer=null,replayWatchTimer=null;

function isHosted(){return location.hostname.endsWith(".github.io")||!/^https?:$/.test(location.protocol)}
async function api(path,options={}){
  const r=await fetch(path,{cache:"no-store",...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data?.error)throw Error(data?.error||("HTTP "+r.status));
  return data;
}
function formatWhen(value){
  if(!value)return "—";
  const d=new Date(value);if(Number.isNaN(d.getTime()))return "—";
  const days=(Date.now()-d.getTime())/86400000;
  if(days<1)return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  if(days<7)return Math.floor(days)+"일 전";
  return d.toLocaleDateString();
}
function replayModsLabel(mods){
  const value=Number(mods||0);if(!value)return "NM";
  const defs=[[1,"NF"],[2,"EZ"],[8,"HD"],[16,"HR"],[32,"SD"],[64,"DT"],[256,"HT"],[512,"NC"],[1024,"FL"],[4096,"SO"],[16384,"PF"]];
  const out=[];for(const [bit,name] of defs)if(value&bit)out.push(name);
  if(value&512){const i=out.indexOf("DT");if(i>=0)out.splice(i,1)}
  if(value&16384){const i=out.indexOf("SD");if(i>=0)out.splice(i,1)}
  return out.join("")||("Mods "+value);
}
function renderReplayStatus(data){
  const path=$("clientReplayPath"),state=$("clientReplayStatus"),watchState=$("clientReplayWatchState");
  if(!path||!state)return;
  if(document.activeElement!==path)path.value=data?.replay_path||"";
  if(isHosted()){
    state.innerHTML='<b>웹/PWA 모드</b><span>Replay Inbox는 로컬 OSL Client 서버에서만 동작합니다.</span>';
    if(watchState)watchState.textContent="웹에서는 비활성";
    return;
  }
  const scan=data?.replay_scan||{},exists=Boolean(data?.replay_path_exists),count=Number(data?.replays||0);
  state.innerHTML='<b>'+(exists?'✓ Replay 폴더 연결 · '+count.toLocaleString()+'개 .osr':'Replay 폴더 설정 필요')+'</b><span>'+
    (exists?esc(data.replay_path)+(data.replay_path_source==="auto"?" · 자동 감지":" · 직접 설정"):'Songs 폴더 옆 Replays를 찾지 못했습니다. .osr 폴더를 직접 지정할 수 있습니다.')+
    (scan.running?' · '+esc(scan.message||"스캔 중"):'')+'</span>';
  const btn=$("clientReplayScan");if(btn){btn.disabled=Boolean(scan.running)||!exists;btn.textContent=scan.running?"Replay 스캔 중…":"Replay 스캔";}
  if(watchState){
    const enabled=Boolean($("clientReplayWatch")?.checked);
    watchState.textContent=enabled?(scan.running?"자동 확인 · 스캔 중":"자동 확인 켜짐 · 약 12초 간격"):"수동 확인";
  }
}
function replayRowHtml(r){
  const title=r.title?((r.artist||"?")+" — "+r.title+" ["+(r.version||"?")+"]"):"MD5 "+String(r.map_hash||"미상").slice(0,10)+"…";
  const when=formatWhen(r.replay_time),acc=r.accuracy==null?"—":Number(r.accuracy).toFixed(2)+"%";
  return '<div class="client-replay-row"><div><span>'+esc(when)+' · '+esc(replayModsLabel(r.mods))+(r.player?' · '+esc(r.player):'')+'</span><b>'+esc(title)+'</b><small>ACC '+esc(acc)+' · Miss '+Number(r.miss||0).toLocaleString()+' · Combo '+Number(r.combo||0).toLocaleString()+(r.beatmap_id?' · #'+Number(r.beatmap_id):'')+'</small></div><button type="button" class="ghost-btn" data-client-replay="'+esc(r.record_id||"")+'">'+(r.title?"Replay 분석":"맵 연결 시도")+'</button></div>';
}
async function refreshReplays(showLoading=false){
  if(isHosted())return;
  const host=$("clientReplayList");if(!host)return;
  if(showLoading)host.innerHTML='<div class="empty">Replay Inbox 읽는 중…</div>';
  try{
    const data=await api("/api/client/replays?limit=40"),rows=Array.isArray(data.replays)?data.replays:[];
    host.innerHTML=rows.length?rows.map(replayRowHtml).join(""):'<div class="empty">색인된 .osr가 없습니다. Replay 폴더에 실제 .osr 파일이 있는지 확인하세요.</div>';
  }catch(err){host.innerHTML='<div class="empty">Replay Inbox 읽기 실패: '+esc(err.message)+'</div>'}
}
async function saveReplayPath(auto=false){
  if(isHosted())return;
  const raw=auto?"":($("clientReplayPath")?.value||"").trim(),button=auto?$("clientReplayAutoDetect"):$("clientReplaySavePath");
  if(button)button.disabled=true;
  try{
    const data=await api("/api/client/replays/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({replay_path:raw})});
    renderStatus(data);renderReplayStatus(data);await refreshReplays(false);
  }catch(err){alert("Replay 폴더 설정 실패: "+err.message)}
  finally{if(button)button.disabled=false}
}
async function startReplayScan(silent=false){
  if(isHosted())return;
  const btn=$("clientReplayScan");if(btn)btn.disabled=true;
  try{
    const data=await api("/api/client/replays/scan",{method:"POST"});
    if(data.error)throw Error(data.error);
    const status=await refreshStatus();
    if(!status?.replay_scan?.running)await refreshReplays(false);
  }catch(err){if(!silent)alert("Replay Inbox 스캔 실패: "+err.message);if(btn)btn.disabled=false}
}
async function analyzeReplay(recordId,button){
  if(!recordId||isHosted())return;
  const old=button?.textContent;if(button){button.disabled=true;button.textContent="Replay 분석 중…"}
  try{
    const data=await api("/api/client/replays/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:recordId})});
    const replay=data?.replay,map=data?.map;
    if(!replay)throw Error("Replay 분석 데이터가 없습니다.");
    if(map&&typeof window.OSLClientAcceptMap==="function")window.OSLClientAcceptMap(map);
    if(typeof window.OSLReplayBridge?.record!=="function")throw Error("Replay Signals 연결이 준비되지 않았습니다.");
    await window.OSLReplayBridge.record(replay,map||null);
    const train=document.querySelector('[data-tab="train"]');if(train)train.click();
  }catch(err){alert("Replay Inbox 분석 실패: "+err.message)}
  finally{if(button){button.disabled=false;button.textContent=old||"Replay 분석"}}
}
function scheduleReplayWatch(){
  clearTimeout(replayWatchTimer);
  const enabled=Boolean($("clientReplayWatch")?.checked);
  if(!enabled||isHosted()||Boolean(lastStatus?.watch?.enabled))return;
  replayWatchTimer=setTimeout(async()=>{
    const panel=$("client");
    if(panel?.classList.contains("active"))await startReplayScan(true);
    scheduleReplayWatch();
  },12000);
}

function renderWatcherStatus(data){
  const state=$("clientWatcherStatus"),enabledEl=$("clientWatcherEnabled"),intervalEl=$("clientWatcherInterval"),save=$("clientWatcherSave");
  if(!state)return;
  const hosted=isHosted(),watch=data?.watch||{};
  if(enabledEl&&document.activeElement!==enabledEl)enabledEl.checked=Boolean(watch.enabled);
  if(intervalEl&&document.activeElement!==intervalEl)intervalEl.value=String(Number(watch.interval_s||30));
  if(hosted){
    state.innerHTML='<b>웹/PWA 모드</b><span>상시 watcher는 로컬 OSL Client 서버에서만 동작합니다.</span>';
    if(enabledEl)enabledEl.disabled=true;if(intervalEl)intervalEl.disabled=true;if(save)save.disabled=true;return;
  }
  const active=Boolean(watch.enabled),running=Boolean(watch.thread_running);
  state.innerHTML='<b>'+(active?(running?'✓ 상시 watcher 동작 중':'Watcher 시작 대기'):'상시 watcher 꺼짐')+'</b><span>'+
    (active?esc(watch.message||"변경 확인 대기")+" · "+Number(watch.interval_s||30)+"초 간격":"필요할 때만 수동 스캔합니다.")+
    (watch.last_check?' · 마지막 확인 '+esc(formatWhen(watch.last_check)):'')+
    (watch.last_change?' · 마지막 변경 '+esc(formatWhen(watch.last_change)):'')+
    (watch.triggered_scans?' · 자동 스캔 '+Number(watch.triggered_scans).toLocaleString()+"회":'')+
    '</span>';
}
async function saveWatcher(){
  if(isHosted())return;
  const button=$("clientWatcherSave");if(button)button.disabled=true;
  const enabled=Boolean($("clientWatcherEnabled")?.checked),interval_s=Number($("clientWatcherInterval")?.value||30);
  try{
    await api("/api/client/watch/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,interval_s})});
    await refreshStatus();scheduleReplayWatch();
  }catch(err){alert("상시 watcher 설정 실패: "+err.message)}
  finally{if(button)button.disabled=false}
}

function renderUpdaterStatus(data){
  const state=$("clientUpdateStatus"),check=$("clientUpdateCheck"),apply=$("clientUpdateApply"),progress=$("clientUpdateProgress");
  if(!state)return;
  const hosted=isHosted(),up=data?.update||{},local=up.local_version||"—",remote=up.remote_version||"—";
  if($("clientUpdateLocal"))$("clientUpdateLocal").textContent=local;
  if($("clientUpdateRemote"))$("clientUpdateRemote").textContent=remote;
  if(hosted){
    state.innerHTML='<b>웹/PWA 모드</b><span>Client Updater는 로컬 OSL Client 서버에서만 사용할 수 있습니다.</span>';
    if(check)check.disabled=true;if(apply)apply.disabled=true;
    if(progress){progress.classList.remove("running");progress.querySelector("span").textContent="웹에서는 비활성";}
    return;
  }
  const checking=Boolean(up.checking),applying=Boolean(up.applying),available=Boolean(up.update_available),restart=Boolean(up.restart_required);
  const done=Number(up.progress_done||0),total=Number(up.progress_total||0);
  const title=restart?"✓ 업데이트 설치 완료 · 재시작 필요":applying?"업데이트 설치 중…":checking?"최신 버전 확인 중…":available?("새 버전 "+remote+" 사용 가능"):"Client Updater";
  state.innerHTML='<b>'+esc(title)+'</b><span>'+esc(up.message||"업데이트 확인 전")+
    (up.checked_at?' · 확인 '+esc(formatWhen(up.checked_at)):'')+
    (up.applied_at?' · 설치 '+esc(formatWhen(up.applied_at)):'')+'</span>';
  if(progress){
    progress.classList.toggle("running",applying);
    const bar=progress.querySelector("i");
    if(bar)bar.style.width=total?Math.min(100,done/total*100).toFixed(1)+"%":"0%";
    progress.querySelector("span").textContent=applying?("검증/설치 "+done.toLocaleString()+" / "+total.toLocaleString()):restart?"재시작하면 새 server.py가 적용됩니다.":available?("v"+local+" → v"+remote):"수동 확인 · 자동 설치 안 함";
  }
  if(check){check.disabled=checking||applying;check.textContent=checking?"확인 중…":"업데이트 확인";}
  if(apply){apply.disabled=!available||checking||applying||restart;apply.textContent=applying?"업데이트 중…":restart?"재시작 필요":"업데이트 적용";}
}
async function checkUpdate(){
  if(isHosted())return;
  const btn=$("clientUpdateCheck");if(btn)btn.disabled=true;
  try{
    const update=await api("/api/client/update/check",{method:"POST"});
    renderUpdaterStatus({update});await refreshStatus();
  }catch(err){alert("업데이트 확인 실패: "+err.message);if(btn)btn.disabled=false}
}
async function applyUpdate(){
  if(isHosted())return;
  const btn=$("clientUpdateApply");if(btn)btn.disabled=true;
  try{
    await api("/api/client/update/apply",{method:"POST"});
    await refreshStatus();
  }catch(err){alert("업데이트 시작 실패: "+err.message);if(btn)btn.disabled=false}
}

function dominantDna(dna){
  const skills=dna?.skills||{},keys=["aim","stream","speed","stamina","tech","reading","flow"];
  const best=keys.map(k=>[k,Number(skills[k])]).filter(([,v])=>Number.isFinite(v)).sort((a,b)=>b[1]-a[1])[0];
  if(!best)return "";
  const labels={aim:"Aim",stream:"Stream",speed:"Speed",stamina:"Stamina",tech:"Tech",reading:"Reading",flow:"Flow"};
  const overall=Number(skills.overall);
  return "DNA "+labels[best[0]]+" "+Math.round(best[1])+(Number.isFinite(overall)?" · Overall "+Math.round(overall):"");
}
function renderDnaStatus(data){
  const state=$("clientDnaStatus"),progress=$("clientDnaProgress"),start=$("clientDnaStart"),stop=$("clientDnaStop");
  if(!state||!progress)return;
  const hosted=isHosted(),dna=data?.dna||{},cached=Number(dna.cached||0),remaining=Number(dna.remaining||0),processed=Number(dna.processed||0),limit=Number(dna.limit||0);
  if($("clientDnaCached"))$("clientDnaCached").textContent=cached.toLocaleString();
  if($("clientDnaRemaining"))$("clientDnaRemaining").textContent=remaining.toLocaleString();
  if(hosted){
    state.innerHTML='<b>웹/PWA 모드</b><span>Background DNA는 로컬 OSL Client 서버에서만 실행됩니다.</span>';
    progress.classList.remove("running");progress.querySelector("span").textContent="웹에서는 비활성";
    if(start)start.disabled=true;if(stop)stop.disabled=true;return;
  }
  const running=Boolean(dna.running),done=Math.max(0,cached),total=Math.max(1,cached+remaining);
  state.innerHTML='<b>'+(running?'Background DNA 분석 중':'로컬 DNA 캐시 · '+cached.toLocaleString()+'개')+'</b><span>'+
    esc(dna.message||("남은 채보 "+remaining.toLocaleString()+"개"))+
    (dna.last_run?' · 마지막 '+esc(formatWhen(dna.last_run)):'')+'</span>';
  progress.classList.toggle("running",running);
  const bar=progress.querySelector("i");if(bar&&!running)bar.style.width=Math.min(100,done/total*100).toFixed(1)+"%";else if(bar)bar.style.width="";
  progress.querySelector("span").textContent=running?
    ("처리 "+processed.toLocaleString()+(limit?" / 최대 "+limit.toLocaleString():"")+" · 캐시 "+cached.toLocaleString()+" · 남음 "+remaining.toLocaleString()):
    ("캐시 "+cached.toLocaleString()+" · 남음 "+remaining.toLocaleString());
  if(start)start.disabled=running||!data?.path_exists;
  if(stop)stop.disabled=!running;
}
async function startDna(){
  if(isHosted())return;
  const btn=$("clientDnaStart");if(btn)btn.disabled=true;
  const limit=Number($("clientDnaLimit")?.value||200);
  try{await api("/api/client/dna/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({limit})});await refreshStatus()}
  catch(err){alert("Background DNA 시작 실패: "+err.message);if(btn)btn.disabled=false}
}
async function stopDna(){
  if(isHosted())return;
  const btn=$("clientDnaStop");if(btn)btn.disabled=true;
  try{await api("/api/client/dna/stop",{method:"POST"});await refreshStatus()}
  catch(err){alert("Background DNA 중지 실패: "+err.message);if(btn)btn.disabled=false}
}

function renderStatus(data){
  lastStatus=data;
  const hosted=isHosted(),path=$("clientSongsPath"),state=$("clientStatus"),progress=$("clientScanProgress");
  if($("clientModeKpi"))$("clientModeKpi").textContent=hosted?"WEB":"LOCAL";
  if($("clientMapCount"))$("clientMapCount").textContent=Number(data?.maps||0).toLocaleString();
  if($("clientSetCount"))$("clientSetCount").textContent=Number(data?.beatmapsets||0).toLocaleString();
  if($("clientLastScanKpi"))$("clientLastScanKpi").textContent=formatWhen(data?.last_scan);
  if(path&&document.activeElement!==path)path.value=data?.songs_path||"";
  renderReplayStatus(data);
  renderDnaStatus(data);
  renderWatcherStatus(data);
  renderUpdaterStatus(data);
  if(hosted){
    state.innerHTML='<b>GitHub Pages · OSL Client Bridge 비활성</b><span>로컬 파일 시스템 접근은 실행.bat / server.py로 연 PC 서버에서만 동작합니다.</span>';
    progress.classList.remove("running");progress.querySelector("span").textContent="웹/PWA 모드";
    ["clientSongsPath","clientAutoDetect","clientSavePath","clientScan","clientSearch","clientQuery","clientReplayPath","clientReplayAutoDetect","clientReplaySavePath","clientReplayScan","clientReplayWatch","clientDnaLimit","clientDnaStart","clientDnaStop","clientWatcherEnabled","clientWatcherInterval","clientWatcherSave","clientUpdateCheck","clientUpdateApply"].forEach(id=>{const el=$(id);if(el)el.disabled=true});
    return;
  }
  const scan=data?.scan||{},exists=Boolean(data?.path_exists);
  state.innerHTML='<b>'+(exists?'✓ Songs 폴더 연결됨':'Songs 폴더 설정 필요')+'</b><span>'+
    (exists?esc(data.songs_path)+(data.path_source==="auto"?" · 자동 감지":" · 직접 설정"):'기본 osu! stable 경로를 찾지 못했습니다. Songs 경로를 직접 입력하세요.')+
    '</span>';
  progress.classList.toggle("running",Boolean(scan.running));
  progress.querySelector("span").textContent=scan.running?
    ((scan.message||"스캔 중")+" · 확인 "+Number(scan.scanned||0).toLocaleString()+" · 갱신 "+Number(scan.updated||0).toLocaleString()+" · 재사용 "+Number(scan.reused||0).toLocaleString()):
    (scan.message||"대기 중");
  const scanBtn=$("clientScan");if(scanBtn){scanBtn.disabled=Boolean(scan.running)||!exists;scanBtn.textContent=scan.running?"스캔 중…":"라이브러리 스캔";}
}
async function refreshStatus(){
  if(isHosted()){renderStatus({maps:0,beatmapsets:0});return null}
  try{
    const data=await api("/api/client/status");renderStatus(data);
    clearTimeout(pollTimer);
    if(data?.scan?.running||data?.replay_scan?.running||data?.dna?.running||data?.update?.applying)pollTimer=setTimeout(refreshStatus,900);
    else {
      if(lastStatus?.maps) await searchLibrary(false);
      await refreshReplays(false);
      if(data?.watch?.enabled&&$("client")?.classList.contains("active"))pollTimer=setTimeout(refreshStatus,5000);
    }
    return data;
  }catch(err){
    const state=$("clientStatus");if(state)state.innerHTML='<b>OSL Client Bridge 연결 실패</b><span>'+esc(err.message)+' · 로컬 server.py를 다시 실행해 보세요.</span>';
    return null;
  }
}
async function savePath(auto=false){
  if(isHosted())return;
  const raw=auto?"":($("clientSongsPath")?.value||"").trim();
  const button=auto?$("clientAutoDetect"):$("clientSavePath");if(button)button.disabled=true;
  try{
    const data=await api("/api/client/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({songs_path:raw})});
    renderStatus(data);
    if(data.path_exists) await searchLibrary(false);
  }catch(err){alert("Songs 경로 설정 실패: "+err.message)}
  finally{if(button)button.disabled=false}
}
async function startScan(){
  if(isHosted())return;
  const btn=$("clientScan");if(btn)btn.disabled=true;
  try{
    const data=await api("/api/client/scan",{method:"POST"});
    if(data.error)throw Error(data.error);
    await refreshStatus();
  }catch(err){alert("라이브러리 스캔 시작 실패: "+err.message);if(btn)btn.disabled=false}
}
function resultHtml(m){
  const id=esc(m.md5||""),title=(m.artist||"?")+" — "+(m.title||"?"),dnaLabel=dominantDna(m.dna),meta=[
    m.creator?"Mapper "+m.creator:null,m.version?"["+m.version+"]":null,
    Number.isFinite(Number(m.bpm))?Number(m.bpm).toFixed(0)+" BPM":null,
    m.ar!=null?"AR "+Number(m.ar).toFixed(1):null,m.od!=null?"OD "+Number(m.od).toFixed(1):null,
    m.beatmap_id?"#"+m.beatmap_id:null,dnaLabel||null
  ].filter(Boolean).join(" · ");
  return '<div class="client-result-row"><div><b>'+esc(title)+'</b><span>'+esc(meta)+'</span></div><button type="button" class="ghost-btn" data-client-analyze="'+id+'">분석 열기</button></div>';
}
async function searchLibrary(showLoading=true){
  if(isHosted())return;
  const host=$("clientResults");if(!host)return;
  const q=($("clientQuery")?.value||"").trim();
  if(showLoading)host.innerHTML='<div class="empty">로컬 SQLite 검색 중…</div>';
  try{
    const data=await api("/api/client/library?q="+encodeURIComponent(q)+"&limit=50");
    const maps=Array.isArray(data.maps)?data.maps:[];
    host.innerHTML=maps.length?maps.map(resultHtml).join(""):'<div class="empty">검색 결과가 없습니다. 스캔을 실행했는지 확인하세요.</div>';
  }catch(err){host.innerHTML='<div class="empty">로컬 검색 실패: '+esc(err.message)+'</div>'}
}
async function analyze(md5,button){
  if(!md5||isHosted())return;
  const old=button?.textContent;if(button){button.disabled=true;button.textContent="분석 중…"}
  try{
    const map=await api("/api/client/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({md5})});
    if(typeof window.OSLClientAcceptMap!=="function")throw Error("Skill Lab 분석 연결이 준비되지 않았습니다.");
    window.OSLClientAcceptMap(map);
  }catch(err){alert("로컬 채보 분석 실패: "+err.message)}
  finally{if(button){button.disabled=false;button.textContent=old||"분석 열기"}}
}
function bind(){
  $("clientAutoDetect")?.addEventListener("click",()=>savePath(true));
  $("clientSavePath")?.addEventListener("click",()=>savePath(false));
  $("clientScan")?.addEventListener("click",startScan);
  $("clientSearch")?.addEventListener("click",()=>searchLibrary(true));
  $("clientQuery")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchLibrary(true)}});
  $("clientReplayAutoDetect")?.addEventListener("click",()=>saveReplayPath(true));
  $("clientReplaySavePath")?.addEventListener("click",()=>saveReplayPath(false));
  $("clientReplayScan")?.addEventListener("click",()=>startReplayScan(false));
  $("clientDnaStart")?.addEventListener("click",startDna);
  $("clientDnaStop")?.addEventListener("click",stopDna);
  $("clientWatcherSave")?.addEventListener("click",saveWatcher);
  $("clientUpdateCheck")?.addEventListener("click",checkUpdate);
  $("clientUpdateApply")?.addEventListener("click",applyUpdate);
  const watch=$("clientReplayWatch");
  if(watch){
    try{watch.checked=localStorage.getItem("osl-client-replay-watch")==="1"}catch(_){}
    watch.addEventListener("change",()=>{try{localStorage.setItem("osl-client-replay-watch",watch.checked?"1":"0")}catch(_){};renderReplayStatus(lastStatus||{});scheduleReplayWatch()});
  }
  document.addEventListener("click",e=>{
    const replayButton=e.target.closest?.("[data-client-replay]");
    if(replayButton){analyzeReplay(decodeURIComponent(replayButton.dataset.clientReplay||""),replayButton);return}
    const analyzeButton=e.target.closest?.("[data-client-analyze]");
    if(analyzeButton){analyze(decodeURIComponent(analyzeButton.dataset.clientAnalyze||""),analyzeButton);return}
    const tab=e.target.closest?.('[data-tab="client"]');if(tab)setTimeout(()=>{refreshStatus();scheduleReplayWatch()},0);
  });
}
bind();refreshStatus();scheduleReplayWatch();
window.OSLClientBridge={refresh:refreshStatus,search:searchLibrary,scan:startScan,replays:refreshReplays,replayScan:startReplayScan,dnaStart:startDna,dnaStop:stopDna,watchSave:saveWatcher,updateCheck:checkUpdate,updateApply:applyUpdate};
})();
