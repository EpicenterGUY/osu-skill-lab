(()=>{
"use strict";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let lastStatus=null,pollTimer=null;

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
function renderStatus(data){
  lastStatus=data;
  const hosted=isHosted(),path=$("clientSongsPath"),state=$("clientStatus"),progress=$("clientScanProgress");
  if($("clientModeKpi"))$("clientModeKpi").textContent=hosted?"WEB":"LOCAL";
  if($("clientMapCount"))$("clientMapCount").textContent=Number(data?.maps||0).toLocaleString();
  if($("clientSetCount"))$("clientSetCount").textContent=Number(data?.beatmapsets||0).toLocaleString();
  if($("clientLastScanKpi"))$("clientLastScanKpi").textContent=formatWhen(data?.last_scan);
  if(path&&document.activeElement!==path)path.value=data?.songs_path||"";
  if(hosted){
    state.innerHTML='<b>GitHub Pages · OSL Client Bridge 비활성</b><span>로컬 파일 시스템 접근은 실행.bat / server.py로 연 PC 서버에서만 동작합니다.</span>';
    progress.classList.remove("running");progress.querySelector("span").textContent="웹/PWA 모드";
    ["clientSongsPath","clientAutoDetect","clientSavePath","clientScan","clientSearch","clientQuery"].forEach(id=>{const el=$(id);if(el)el.disabled=true});
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
    if(data?.scan?.running){clearTimeout(pollTimer);pollTimer=setTimeout(refreshStatus,900)}
    else if(lastStatus?.maps) await searchLibrary(false);
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
  const id=esc(m.md5||""),title=(m.artist||"?")+" — "+(m.title||"?"),meta=[
    m.creator?"Mapper "+m.creator:null,m.version?"["+m.version+"]":null,
    Number.isFinite(Number(m.bpm))?Number(m.bpm).toFixed(0)+" BPM":null,
    m.ar!=null?"AR "+Number(m.ar).toFixed(1):null,m.od!=null?"OD "+Number(m.od).toFixed(1):null,
    m.beatmap_id?"#"+m.beatmap_id:null
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
  document.addEventListener("click",e=>{
    const analyzeButton=e.target.closest?.("[data-client-analyze]");
    if(analyzeButton){analyze(decodeURIComponent(analyzeButton.dataset.clientAnalyze||""),analyzeButton);return}
    const tab=e.target.closest?.('[data-tab="client"]');if(tab)setTimeout(refreshStatus,0);
  });
}
bind();refreshStatus();
window.OSLClientBridge={refresh:refreshStatus,search:searchLibrary,scan:startScan};
})();
