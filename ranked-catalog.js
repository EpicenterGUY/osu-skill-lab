/* Public osu! Skill Lab Ranked catalogue (v0.9).
 * Startup: fetch only one precomputed summary, never all raw monthly beatmap JSON.
 * Search: lazily request lightweight yearly indexes on entering RANKED.
 * "All years" is opt-in to protect phones as the catalogue grows.
 */
let catalogSummary = null;
let summaryRetryCount = 0;
let summaryRetryTimer = null;
let summaryLoadInFlight = false;

let rankedIndex = [];
let indexedLimit = 20;
const indexedImported = new Map();
const indexedYearCache = new Map();
const dnaOverlayCache = new Map();
let dnaOverlayLoadPromise = null;
let legacyLoaded = false;
let indexedGeneration = 0;
let indexedLoadedKey = "";
let indexedLoadPromise = null;
let indexedSearchTimer = null;
let lastFilteredRows = [];
let globalSearchGeneration = 0;
let globalSearchActive = false;
let sharedMapHandled = false;
let similaritySeedMap = null;
let similarityGeneration = 0;
let relationGeneration = 0;
let relationSelectedMap = null;
let relationFocusMap = null;
const relationGraphMaps = new Map();
const similarityResultMaps = new Map();
const compareMaps = new Map();
const favoriteMaps = new Map();
let recentViewedMaps = [];
let savedSearches = [];
let rankedSearchHistory = [];
let sharedSearchHandled = false;
let trainingPoolCache = null;
let trainingRouteGeneration = 0;
let trainingRouteState = {skill:null,requested_band:null,band:null,mode:null,scope:null,maps:[],done:[],done_at:{},feel:"",note:"",created_at:null};
let trainingHistory = [];
let replaySignalHistory = [];
let replayAutoRelinkVersion = "";
const replayChecksumShardCache = new Map();
const replaySignalMaps = new Map();
const trainingRouteMaps = new Map();
try {
  const savedCompare = JSON.parse(localStorage.getItem("osl-ranked-compare") || "[]");
  if (Array.isArray(savedCompare)) for (const m of savedCompare.slice(0,4))
    if (m?.beatmap_id) compareMaps.set(String(m.beatmap_id), m);
} catch (_) {}
try {
  const savedFavorites = JSON.parse(localStorage.getItem("osl-ranked-favorites") || "[]");
  if (Array.isArray(savedFavorites)) for (const m of savedFavorites)
    if (m?.beatmap_id) favoriteMaps.set(String(m.beatmap_id), m);
} catch (_) {}
try {
  const savedRecent = JSON.parse(localStorage.getItem("osl-ranked-recent") || "[]");
  if (Array.isArray(savedRecent)) recentViewedMaps = savedRecent.filter(m=>m?.beatmap_id).slice(0,20);
} catch (_) {}
try {
  const saved = JSON.parse(localStorage.getItem("osl-ranked-saved-searches") || "[]");
  if (Array.isArray(saved)) savedSearches = saved.slice(0,20);
} catch (_) {}
try {
  const saved = JSON.parse(localStorage.getItem("osl-ranked-search-history") || "[]");
  if (Array.isArray(saved)) rankedSearchHistory = saved.slice(0,12);
} catch (_) {}
try {
  const saved = JSON.parse(localStorage.getItem("osl-training-route") || "null");
  if(saved && Array.isArray(saved.maps)) trainingRouteState = {...trainingRouteState,...saved,maps:saved.maps.slice(0,20),done:Array.isArray(saved.done)?saved.done:[],done_at:saved.done_at&&typeof saved.done_at==="object"?saved.done_at:{}};
} catch (_) {}
try {
  const saved = JSON.parse(localStorage.getItem("osl-training-history") || "[]");
  if(Array.isArray(saved)) trainingHistory = saved.filter(x=>x&&Array.isArray(x.maps)).slice(0,80);
} catch (_) {}
try {
  const saved = JSON.parse(localStorage.getItem("osl-replay-signals") || "[]");
  if(Array.isArray(saved)) replaySignalHistory = saved.filter(x=>x&&x.id).slice(0,200);
} catch (_) {}

try {
  const saved = JSON.parse(localStorage.getItem("osl-ranked-index") || "[]");
  if (Array.isArray(saved)) for (const m of saved)
    if (m && m.beatmap_id && m.source === "osu! API v2")
      indexedImported.set(String(m.beatmap_id), m);
} catch (_) {}

const ct = (n) => Number(n || 0).toLocaleString("ko-KR");

// Start the only network-critical boot task before optional UI bindings below.
// A missing/older DOM control must never prevent the public summary from loading.
queueMicrotask(() => loadRankedSummary());
const cx = (s) => esc(s === null || s === undefined ? "" : s);
const barGraph = (rows, key, labelKey, limit = 25) => {
  const data = (rows || []).slice(0, limit);
  const max = Math.max(1, ...data.map(x => Number(x[key]) || 0));
  return '<div class="stat-bars">' + data.map(x => {
    const n = Number(x[key]) || 0;
    const label = cx(x[labelKey]);
    return '<div class="stat-bar-row"><span title="' + label + '">' + label +
      '</span><div class="stat-bar-track"><i style="width:' + Math.max(n ? 2 : 0, n / max * 100).toFixed(1) +
      '%"></i></div><b>' + ct(n) + '</b></div>';
  }).join("") + '</div>';
};
const officialMapLink = m => '<a href="https://osu.ppy.sh/beatmaps/' +
  encodeURIComponent(m.beatmap_id) + '" target="_blank" rel="noopener noreferrer">' +
  cx(m.artist || "?") + ' — ' + cx(m.title || "?") + ' [' + cx(m.version || "?") + ']</a>';
const topRows = (list, kind) => (list || []).slice(0, 10).map((m, i) =>
  '<tr><td>' + (i + 1) + '</td><td>' + officialMapLink(m) + '</td><td>' +
  (kind === "sr" ? "★" + Number(m.official_sr || 0).toFixed(2) : kind === "bpm" ? Number(m.bpm || 0).toFixed(0) : ct(m.playcount)) +
  '</td></tr>').join("");
const statsTable = (header, rows, extra = "") =>
  '<table><thead><tr><th>#</th><th>' + header + '</th><th>' +
  (extra || "기록") + '</th></tr></thead><tbody>' + rows + '</tbody></table>';

function setRankedLoadState(stage, detail = "", percent = null) {
  const host = $("hostedSyncState");
  if (!host) return;
  const pct = percent == null ? "" : Math.max(0, Math.min(100, Number(percent))).toFixed(0);
  host.innerHTML = '<div class="ranked-loader"><div class="ranked-loader-head"><b>' + cx(stage) +
    '</b><span>' + cx(detail) + '</span></div><div class="ranked-loader-track"><i style="width:' +
    (pct || "7") + '%"></i></div>' + (pct ? '<small>' + pct + '%</small>' : '<small>연결 중…</small>') + '</div>';
}
async function fetchCatalogJson(path, version, fresh = false, progress = null) {
  if (path.includes("..") || !path.startsWith("data/") || !path.endsWith(".json"))
    throw Error("허용되지 않은 DB 경로");
  const url = "./" + path + "?v=" + encodeURIComponent(String(version || "1"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {cache: fresh ? "no-store" : "default", signal: controller.signal});
    if (!response.ok) throw Error("HTTP " + response.status + " · " + path);
    const total = Number(response.headers.get("content-length") || 0);
    if (!response.body || !progress) return response.json();
    const reader = response.body.getReader(), chunks = [];
    let loaded = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      progress(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e?.name === "AbortError") throw Error("15초 응답 시간 초과");
    throw e;
  } finally { clearTimeout(timeout); }
}

function compactOverlayDna(record) {
  if (!record?.skills) return null;
  return {
    skills: record.skills,
    objects: record.objects,
    duration_s: record.duration_s,
    max_stream: record.max_stream,
    peak_density_2s: record.peak_density_2s,
    median_gap_ms: record.median_gap_ms,
    analysis_method: record.analysis_method,
  };
}
function mergeCachedDna(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  for (const m of rows) {
    const year=String(m.ranked_date||"").slice(0,4);
    const overlay=dnaOverlayCache.get(year)?.get(String(m.beatmap_id));
    if (overlay) {
      m.dna=overlay;
      const saved=compareMaps.get(String(m.beatmap_id));
      if(saved){saved.dna=overlay;compareMaps.set(String(m.beatmap_id),saved);}
    }
  }
  return rows;
}
function dnaYearsForSelection(selection) {
  const shards=catalogSummary?.chart_dna?.shards||[];
  if (globalSearchActive) return [...new Set(rankedIndex.map(m=>String(m.ranked_date||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))];
  if (selection==="recent") return [];
  if (selection==="all") return shards.map(x=>String(x.year)).filter(x=>/^\d{4}$/.test(x));
  const value=selection.replace("year:","").replace("month:","");
  const year=value.slice(0,4);
  return /^\d{4}$/.test(year)?[year]:[];
}
async function loadDnaOverlayYears(years, generation=indexedGeneration, explicit=false) {
  const unique=[...new Set((years||[]).filter(y=>/^\d{4}$/.test(String(y))))];
  if (!unique.length || !catalogSummary) return;
  const manifest=new Map((catalogSummary.chart_dna?.shards||[]).map(x=>[String(x.year),x]));
  const wanted=unique.filter(y=>manifest.has(y)&&!dnaOverlayCache.has(y));
  if (!wanted.length) {mergeCachedDna(rankedIndex);return;}
  const key=wanted.join(",")+"@"+String(catalogSummary.chart_dna?.coverage_percent||catalogSummary.updated_at||"1");
  if (dnaOverlayLoadPromise?.key===key) return dnaOverlayLoadPromise.promise;
  const task=(async()=>{
    let files=0, records=0, failed=0;
    for(let i=0;i<wanted.length;i+=2){
      const batchYears=wanted.slice(i,i+2);
      if(explicit) setRankedLoadState("Chart DNA overlay", (files)+"/"+wanted.length+" 연도 · 메타데이터는 이미 사용 가능", wanted.length?files/wanted.length*100:0);
      const batch=await Promise.allSettled(batchYears.map(async year=>{
        const sh=manifest.get(year);
        const rows=await fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
        if(!Array.isArray(rows)) throw Error("손상된 DNA overlay · "+sh.path);
        const mapped=new Map();
        for(const row of rows){
          const dna=compactOverlayDna(row);
          if(row?.beatmap_id&&dna)mapped.set(String(row.beatmap_id),dna);
        }
        dnaOverlayCache.set(year,mapped);
        return mapped.size;
      }));
      if(generation!==indexedGeneration&&!explicit)return;
      for(const result of batch){
        files++;
        if(result.status==="fulfilled") records+=result.value;
        else{failed++;console.warn("Chart DNA overlay unavailable",result.reason);}
      }
      mergeCachedDna(rankedIndex);
      indexedLimit=Math.max(20,indexedLimit);
      renderIndexed();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const state=$("hostedSyncState");
    if(state) state.textContent="Chart DNA overlay "+ct(records)+"개 연결 · "+files+"/"+wanted.length+" 연도"+(failed?" · 실패 "+failed:"")+" · 메타데이터와 분리 로딩";
  })();
  dnaOverlayLoadPromise={key,promise:task};
  try{await task;}finally{if(dnaOverlayLoadPromise?.promise===task)dnaOverlayLoadPromise=null;}
}
async function ensureDnaForCurrentSelection() {
  const selection=$("indexedYear")?.value||"recent";
  const years=dnaYearsForSelection(selection);
  if(selection==="recent"){renderIndexed();return;}
  await loadDnaOverlayYears(years,indexedGeneration,true);
}

function renderEraComparison() {
  const host=$("obsCompareResult"), aSel=$("obsYearA"), bSel=$("obsYearB"), metricSel=$("obsMetric");
  if(!host||!aSel||!bSel||!metricSel||!catalogSummary)return;
  const era=catalogSummary.research?.era_trends||[];
  const eraMap=new Map(era.map(x=>[String(x.year),x]));
  const dnaMap=new Map((catalogSummary.chart_dna?.coverage_by_year||[]).map(x=>[String(x.year),x]));
  const metric=metricSel.value||"sr", a=eraMap.get(aSel.value), b=eraMap.get(bSel.value);
  if(!a||!b){host.innerHTML='<div class="empty">비교할 시대 통계가 없습니다.</div>';return;}
  const defs={
    sr:["평균 공식 SR",x=>Number(x?.sr||0),"★",2],
    bpm:["평균 BPM",x=>Number(x?.bpm||0)," BPM",1],
    ar:["평균 AR",x=>Number(x?.ar||0),"",2],
    od:["평균 OD",x=>Number(x?.od||0),"",2],
    cs:["평균 CS",x=>Number(x?.cs||0),"",2],
    count:["Ranked 채보 수",x=>Number(x?.count||0),"",0],
    dna:["Chart DNA 커버리지",x=>Number(dnaMap.get(String(x?.year))?.coverage_percent||0),"%",2],
  };
  const [label,get,unit,digits]=defs[metric]||defs.sr;
  const av=get(a), bv=get(b), delta=av-bv;
  const format=v=>metric==="count"?ct(v):v.toFixed(digits)+unit;
  const sign=delta>0?"+":"";
  const pct=bv?delta/Math.abs(bv)*100:null;
  host.innerHTML='<div class="era-compare-kpis">'+
    '<div><span>'+cx(a.year)+'</span><b>'+cx(format(av))+'</b><small>'+cx(label)+'</small></div>'+
    '<div><span>'+cx(b.year)+'</span><b>'+cx(format(bv))+'</b><small>'+cx(label)+'</small></div>'+
    '<div><span>차이 A−B</span><b>'+cx(sign+format(delta))+'</b><small>'+(pct==null?'기준값 0':cx((pct>=0?"+":"")+pct.toFixed(1)+"%"))+'</small></div>'+
    '<div><span>표본</span><b>'+ct(a.count)+' / '+ct(b.count)+'</b><small>각 연도 Ranked difficulties</small></div></div>'+
    '<p class="hint-text">'+cx(a.year)+'와 '+cx(b.year)+'의 수집 DB 평균을 비교한 값입니다. Chart DNA는 분석 완료 표본의 커버리지이며 실력이나 공식 난이도 지표가 아닙니다.</p>';
}
function setupEraComparison(s) {
  const aSel=$("obsYearA"), bSel=$("obsYearB"); if(!aSel||!bSel)return;
  const years=(s.research?.era_trends||[]).map(x=>String(x.year));
  if(!years.length)return;
  const options=years.slice().reverse().map(y=>'<option value="'+cx(y)+'">'+cx(y)+'</option>').join("");
  const oldA=aSel.value, oldB=bSel.value;
  aSel.innerHTML=options; bSel.innerHTML=options;
  const latest=years[years.length-1], target=String(Number(latest)-10);
  aSel.value=years.includes(oldA)?oldA:latest;
  bSel.value=years.includes(oldB)?oldB:(years.includes(target)?target:years[0]);
  renderEraComparison();
}
$("obsYearA")?.addEventListener("change",renderEraComparison);
$("obsYearB")?.addEventListener("change",renderEraComparison);
$("obsMetric")?.addEventListener("change",renderEraComparison);

function renderCatalogSummary(s) {
  const count = s.counts || {};
  setupEraComparison(s);
  const replayLinkVersion=String(s.replay_lookup?.entries||0)+"@"+String(s.updated_at||"");
  if(s.replay_lookup?.versions&&replaySignalHistory.some(r=>!r.map?.beatmap_id||r.link_type==="ranked-checksum-id")&&replayAutoRelinkVersion!==replayLinkVersion){
    replayAutoRelinkVersion=replayLinkVersion;
    queueMicrotask(()=>relinkReplaySignals(true).catch(err=>console.warn("Replay auto-relink failed",err)));
  }
  const avg = s.averages || {};
  const oldest = (s.date_range?.oldest || "").slice(0, 10);
  const newest = (s.date_range?.newest || "").slice(0, 10);
  const current = s.backfill_complete ? "과거 검색 순회 종료 · 누락 검증 별도" : "과거 Ranked 수집 중";
  $("catalogHeadline").innerHTML =
    '<div class="metric"><b>' + ct(count.beatmapsets) + '</b><span>수집된 비트맵셋 (곡)</span></div>' +
    '<div class="metric"><b>' + ct(count.difficulties) + '</b><span>수집된 난이도 (채보)</span></div>' +
    '<div class="metric"><b>' + (s.averages?.sr == null ? "—" : "★" + Number(s.averages.sr).toFixed(2)) +
    '</b><span>평균 공식 SR</span></div>' +
    '<div class="metric"><b>' + (s.averages?.bpm == null ? "—" : Number(s.averages.bpm).toFixed(0)) +
    '</b><span>평균 BPM</span></div>';
  const time = s.updated_at && !isNaN(Date.parse(s.updated_at)) ?
    new Date(s.updated_at).toLocaleString("ko-KR", {timeZone: "Asia/Seoul"}) : "—";
  $("catalogUpdated").textContent = current + " · 수집 기간 " + (oldest || "—") +
    " ~ " + (newest || "—") + " · DB 갱신 " + time +
    " · 시범 Chart DNA " + ct(count.chart_dna_analyzed || 0) + "채보" +
    " · 수치는 현재 수집된 DB 기준이며 전 세계 Ranked 전체 합계가 아닙니다.";

  const rankedKpis = $("rankedHeroKpis");
  if (rankedKpis) {
    const oldest = String(s.date_range?.oldest || "").slice(0,4), newest = String(s.date_range?.newest || "").slice(0,4);
    rankedKpis.innerHTML =
      '<div class="dash-kpi"><span>Ranked 채보</span><b>' + ct(count.difficulties) + '</b><small>공식 DB</small></div>' +
      '<div class="dash-kpi"><span>비트맵셋</span><b>' + ct(count.beatmapsets) + '</b><small>공식 DB</small></div>' +
      '<div class="dash-kpi"><span>맵퍼</span><b>' + ct(count.mappers) + '</b><small>수집 DB</small></div>' +
      '<div class="dash-kpi"><span>수집 범위</span><b>' + cx(oldest) + '–' + cx(newest) + '</b><small>Ranked 날짜</small></div>';
  }
  const kpis = $("statsHeroKpis");
  if (kpis) kpis.innerHTML =
    '<div class="dash-kpi"><span>Ranked 채보</span><b>' + ct(count.difficulties) + '</b><small>수집 DB</small></div>' +
    '<div class="dash-kpi"><span>비트맵셋</span><b>' + ct(count.beatmapsets) + '</b><small>수집 DB</small></div>' +
    '<div class="dash-kpi"><span>평균 SR</span><b>★' + Number(avg.sr || 0).toFixed(2) + '</b><small>공식 Star Rating</small></div>' +
    '<div class="dash-kpi"><span>평균 BPM</span><b>' + Number(avg.bpm || 0).toFixed(1) + '</b><small>수집 DB</small></div>';
  const dnaCoverage = $("dnaCoverage");
  if (dnaCoverage) {
    const dnaN = Number(count.chart_dna_analyzed || 0), all = Number(count.difficulties || 0), pct = all ? dnaN / all * 100 : 0;
    dnaCoverage.innerHTML =
      '<div class="dash-kpi"><span>전체 Ranked</span><b>' + ct(all) + '</b><small>메타데이터</small></div>' +
      '<div class="dash-kpi"><span>DNA 분석</span><b>' + ct(dnaN) + '</b><small>실제 .osu 기반</small></div>' +
      '<div class="dash-kpi"><span>커버리지</span><b>' + pct.toFixed(pct < 1 ? 2 : 1) + '%</b><small>분석 진행률</small></div>' +
      '<div class="dash-kpi"><span>내 분석</span><b>' + ct(Number($("dbCount")?.textContent || 0)) + '</b><small>이 기기</small></div>';
    const global = $("dnaGlobalRanking");
    if (global && !dnaN) global.innerHTML = '<div class="collection-state"><b>Chart DNA 대량 분석 준비 중</b><span>메타데이터 ' + ct(all) +
      '개 확보 · 실제 노트 분석이 들어오면 스킬 랭킹이 자동 활성화됩니다.</span><div class="coverage-track"><i style="width:' + Math.max(.3,pct) + '%"></i></div></div>';
  }

  const dnaMeta=s.chart_dna||{}, dnaYears=dnaMeta.coverage_by_year||[], lastBatch=dnaMeta.last_batch||{};
  const dnaDist=$("dnaDistribution");
  if(dnaDist){
    const elapsed=Number(lastBatch.elapsed_seconds||0), success=Number(lastBatch.succeeded||0), attempts=Number(lastBatch.attempted||0);
    const perMin=elapsed>0?success/(elapsed/60):0;
    dnaDist.innerHTML=
      '<div class="collector-health"><b>'+ct(success)+' / '+ct(attempts)+' 성공</b><span>최근 자동 배치'+(perMin?' · '+perMin.toFixed(1)+'채보/분':'')+(lastBatch.blocked?' · 소스 제한 감지 후 자동 중지':' · 정상 체크포인트')+'</span></div>'+
      '<div class="dna-era-list">'+dnaYears.map(x=>'<div><span>'+cx(x.year)+'</span><div class="coverage-track"><i style="width:'+Math.max(.25,Math.min(100,Number(x.coverage_percent||0)))+'%"></i></div><b>'+Number(x.coverage_percent||0).toFixed(Number(x.coverage_percent||0)<1?2:1)+'%</b><small>'+ct(x.analyzed)+' / '+ct(x.candidates)+'</small></div>').join('')+'</div>';
  }

  const research=s.research||{}, era=research.era_trends||[], fps=research.mapper_fingerprints||[], odds=research.oddities||[], twins=research.difficulty_twins||[];
  const eraEl=$("eraResearch"); if(eraEl) eraEl.innerHTML=era.length ? '<div class="research-table">'+era.slice(-12).map(x=>'<div><b>'+cx(x.year)+'</b><span>★'+Number(x.sr||0).toFixed(2)+'</span><span>'+Number(x.bpm||0).toFixed(0)+' BPM</span><span>AR '+Number(x.ar||0).toFixed(1)+'</span></div>').join('')+'</div>' : '<div class="empty">시대 통계가 없습니다.</div>';
  const mapEl=$("mapperResearch"); if(mapEl) mapEl.innerHTML=fps.length ? fps.slice(0,14).map((x,i)=>'<button type="button" class="research-rank research-rank-btn" data-mapper-fp="'+encodeURIComponent(x.name)+'"><b>'+(i+1)+'</b><span><strong>'+cx(x.name)+'</strong><small>'+ct(x.beatmapsets)+' sets · 평균 ★'+Number(x.avg_sr||0).toFixed(2)+' · '+Number(x.avg_bpm||0).toFixed(0)+' BPM'+(x.dna_sample?' · DNA '+ct(x.dna_sample):'')+'</small></span></button>').join('') : '<div class="empty">맵퍼 통계가 없습니다.</div>';
  const oddEl=$("oddityResearch"); if(oddEl) oddEl.innerHTML=odds.length ? odds.slice(0,10).map((m,i)=>'<button type="button" class="research-rank research-rank-btn" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id||""))+'"><b>'+(i+1)+'</b><span><strong>'+cx(m.artist)+' — '+cx(m.title)+'</strong><small>★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM · '+Math.round(Number(m.total_length||0)/60)+'분</small></span></button>').join('') : '<div class="empty">이상치가 없습니다.</div>';
  const twinEl=$("twinResearch"); if(twinEl) twinEl.innerHTML=twins.length ? twins.slice(0,12).map(x=>'<div class="twin-pair"><button data-ranked-detail="'+encodeURIComponent(String(x.a?.beatmap_id||''))+'">'+cx(x.a?.title)+' ['+cx(x.a?.version)+']</button><b>≈</b><button data-ranked-detail="'+encodeURIComponent(String(x.b?.beatmap_id||''))+'">'+cx(x.b?.title)+' ['+cx(x.b?.version)+']</button><small>DNA 거리 '+Number(x.dna_distance).toFixed(1)+' · SR 차이 '+Number(x.sr_gap).toFixed(2)+'</small></div>').join('') : '<div class="collection-state"><b>DNA 쌍둥이 탐색 준비 중</b><span>실제 Chart DNA 표본이 들어오는 즉시 자동 계산됩니다.</span></div>';
  const leader=$("dnaSkillLeaderboard"), rankings=research.dna_rankings||{}; if(leader){const skills=["aim","stream","speed","stamina","tech","reading","flow"]; leader.innerHTML=skills.map(k=>{const top=(rankings[k]||[])[0];return top?'<button type="button" class="dna-lead dna-lead-btn" data-ranked-detail="'+encodeURIComponent(String(top.beatmap_id||""))+'"><span>'+k.toUpperCase()+'</span><b>'+cx(top.title)+'</b><small>'+Number(top.dna?.skills?.[k]||0).toFixed(1)+' · ★'+Number(top.official_sr||0).toFixed(2)+'</small></button>':'<div class="dna-lead"><span>'+k.toUpperCase()+'</span><b>수집 중</b><small>실제 .osu 분석 대기</small></div>'}).join('');}
  renderDnaRanking();
  const yearRows = (s.years || []).filter(x => x.year !== "unknown");
  const mapperRows = (s.top_mappers || []).slice(0, 15).map((m, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + cx(m.name) + '</td><td>' +
    ct(m.beatmapsets) + '곡 / ' + ct(m.difficulties) + '채보</td></tr>').join("");
  const officialStats=$("officialStatsArea"); if(officialStats) officialStats.innerHTML =
    '<div class="grid">' +
    '<div class="card half"><h2>연도별 Ranked 난이도</h2>' +
    '<p class="muted">현재 수집분 기준 · 연도별 비트맵셋은 아래 표기</p>' +
    barGraph(yearRows, "difficulties", "year") +
    '<div class="stat-year-links">' + yearRows.map(x =>
      '<button class="stat-year-button" data-year-link="' + cx(x.year) + '">' +
      cx(x.year) + ' · ' + ct(x.beatmapsets) + '곡</button>').join("") + '</div></div>' +
    '<div class="card half"><h2>공식 Star Rating 분포</h2>' +
    barGraph(s.sr_buckets, "count", "label") + '</div>' +
    '<div class="card half"><h2>BPM 분포</h2>' +
    barGraph(s.bpm_buckets, "count", "label") + '</div>' +
    '<div class="card half"><h2>최근 Ranked 월별 채보 수</h2>' +
    barGraph(s.months, "difficulties", "month", 12) + '</div>' +
    '<div class="card half"><h2>AR 분포</h2>' + barGraph(s.attribute_buckets?.ar, "count", "label", 12) + '</div>' +
    '<div class="card half"><h2>OD 분포</h2>' + barGraph(s.attribute_buckets?.od, "count", "label", 12) + '</div>' +
    '<div class="card half"><h2>CS 분포</h2>' + barGraph(s.attribute_buckets?.cs, "count", "label", 12) + '</div>' +
    '<div class="card half"><h2>채보 길이</h2>' + barGraph(s.attribute_buckets?.length, "count", "label", 8) + '</div>' +
    '<div class="card half"><h2>맵퍼 TOP 15 · 비트맵셋 수</h2>' +
    statsTable("맵퍼", mapperRows, "곡 / 난이도") + '</div>' +
    '<div class="card half"><h2>공식 SR TOP 10</h2>' +
    statsTable("채보", topRows(s.top_sr, "sr"), "SR") + '</div>' +
    '<div class="card half"><h2>최고 BPM</h2>' + statsTable("채보", topRows(s.extremes?.highest_bpm, "bpm"), "BPM") + '</div>' +
    '<div class="card half"><h2>최장 채보</h2>' + statsTable("채보", (s.extremes?.longest || []).slice(0,8).map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+officialMapLink(m)+'</td><td>'+Math.floor(Number(m.total_length||0)/60)+'m '+Math.round(Number(m.total_length||0)%60)+'s</td></tr>').join(""), "길이") + '</div>' +
    '<div class="card full"><h2>플레이카운트 TOP 10 · 현재 수집분</h2>' +
    statsTable("채보", topRows(s.top_playcount, "plays"), "플레이 수") + '</div>' +
    '<div class="card full"><h2>실제 채보 기반 Chart DNA · 시범 운영</h2>' +
    '<p class="muted">실제 .osu 노트 데이터를 읽어 계산한 자체 Aim / Stream / Speed 등의 점수입니다. 공식 SR 또는 pp가 아닙니다.</p>' +
    '<div class="metrics"><div class="metric"><b>' + ct(count.chart_dna_analyzed || 0) +
    '</b><span>실제 채보 분석 완료</span></div><div class="metric"><b>' + ct(count.difficulties) +
    '</b><span>전체 수집된 채보</span></div></div>' +
    '<p class="hint-text">Chart DNA는 새로운 Ranked부터 소량씩 시범 분석하며, 원본 .osu 파일을 사이트에 공개하지 않습니다. API 또는 파일 제공처 접근 제한 시 분석이 지연될 수 있습니다.</p></div>' +
    '</div>';
  if($("rankedIndexStats")) $("rankedIndexStats").textContent = ct(count.beatmapsets) + "곡 · " +
    ct(count.difficulties) + "채보 · " + current +
    " · 공식 메타데이터만 집계 (채보 DNA는 별도)";
  if($("rankedIndexTop")) $("rankedIndexTop").innerHTML = '<h3>수집된 공식 SR TOP 10</h3>' +
    (s.top_sr || []).slice(0, 10).map((m, i) =>
      '<div class="dbitem"><b>#' + (i + 1) + ' ' + officialMapLink(m) +
      '</b><div class="muted">★' + Number(m.official_sr || 0).toFixed(2) +
      ' · ' + ct(m.bpm) + ' BPM</div></div>').join("");
}

async function loadRankedSummary() {
  if (summaryLoadInFlight) return;
  summaryLoadInFlight = true;
  clearTimeout(summaryRetryTimer);
  const started = performance.now();
  setRankedLoadState("DB 연결 중", "Ranked 요약 통계 요청", 5);
  try {
    const s = await fetchCatalogJson("data/ranked-summary.json", Date.now(), true, (loaded,total) => {
      const kb = n => (n / 1024).toFixed(n > 1024 * 100 ? 0 : 1) + " KB";
      const pct = total ? 10 + loaded / total * 70 : Math.min(78, 10 + loaded / 4096);
      setRankedLoadState("요약 통계 다운로드", total ? kb(loaded) + " / " + kb(total) : kb(loaded) + " 수신", pct);
    });
    setRankedLoadState("데이터 검증", "응답 형식 확인", 88);
    if (s.format !== "osu-skill-lab-summary" || !Array.isArray(s.search_shards))
      throw Error("지원하지 않는 통계 형식");
    catalogSummary = s;
    window.__rankedSummaryReady = true;
    summaryRetryCount = 0;
    try { localStorage.setItem("osl-ranked-summary-backup", JSON.stringify(s)); } catch (_) {}
    indexedYearCache.clear();
    dnaOverlayCache.clear();
    trainingPoolCache = null;
    indexedLoadedKey = "";
    renderCatalogSummary(s);
    setRankedLoadState("Ranked 인덱스 준비", ct(s.counts?.difficulties) + "채보 · " + ((performance.now()-started)/1000).toFixed(1) + "초", 96);
    const progress = $("backfillProgress");
    if (progress) {
      const oldest = s.date_range?.oldest || "—";
      const newest = s.date_range?.newest || "—";
      const complete = Boolean(s.backfill_complete);
      progress.innerHTML = '<div class="card-header"><b>역대 Ranked 수집 현황</b><span class="pill">' +
        (complete ? "검색 커서 순회 완료" : "과거 데이터 수집 중") + '</span></div>' +
        '<div class="metrics"><div class="metric"><b>' + ct(s.counts?.difficulties) +
        '</b><span>확보된 채보</span></div><div class="metric"><b>' + ct(s.counts?.beatmapsets) +
        '</b><span>확보된 비트맵셋</span></div></div>' +
        '<p class="hint-text">수집된 날짜 범위: ' + cx(oldest) + ' ~ ' + cx(newest) +
        ' · ' + (complete ? "API 페이지 순회가 끝났지만 삭제된 과거 채보의 완전성은 별도 검증이 필요합니다." :
        "과거 채보를 계속 수집하는 중입니다. 전체 목표 개수가 확인되지 않아 퍼센트는 표시하지 않습니다.") +
        '</p><a class="ghost-btn" target="_blank" rel="noopener noreferrer" href="https://github.com/EpicenterGUY/osu-skill-lab/actions/workflows/fast-ranked-backfill.yml">고속 수집 작업 확인 ↗</a>';
    }
    const select = $("indexedYear");
    const prev = select.value;
    const months = s.search_shards.filter(sh => typeof sh.month === "string");
    const yearCounts = new Map();
    for (const sh of s.search_shards) yearCounts.set(String(sh.year), (yearCounts.get(String(sh.year)) || 0) + Number(sh.count || 0));
    const yearOptions = [...yearCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year,count]) => '<option value="year:' + cx(year) + '">' + cx(year) + '년 전체 · ' + ct(count) + '채보</option>').join("");
    select.innerHTML = '<option value="recent">최근 Ranked 30개 (즉시 표시)</option>' +
      (months.length ? '<optgroup label="월별 빠른 검색">' + months.map(sh =>
        '<option value="month:' + cx(sh.month) + '">' + cx(sh.month) + ' · ' + ct(sh.count) + '채보</option>').join("") + '</optgroup>' : "") +
      '<optgroup label="연도별 검색">' + yearOptions + '</optgroup>' +
      '<option value="all">전체 연도 검색 (데이터 다운로드 많음)</option>';
    const validValues = ["recent","all",...months.map(sh => "month:" + sh.month),...yearCounts.keys()].map(x=>x.startsWith("year:")||x==="recent"||x==="all"||x.startsWith("month:")?x:"year:"+x);
    select.value = validValues.includes(prev) ? prev : "recent";
    $("hostedSyncState").innerHTML = '<div class="ranked-loader ranked-loader-done"><div class="ranked-loader-head"><b>✓ 최신 DB 준비 완료</b><span>' + ct(s.counts?.difficulties) + '채보 · ' + ((performance.now()-started)/1000).toFixed(1) + '초</span></div><div class="ranked-loader-track"><i style="width:100%"></i></div><small>월·연도 데이터는 선택할 때만 받습니다.</small></div>';
    renderRecentPreview();
    renderSavedShelves();
renderSimilaritySeed();
    if (document.getElementById("ranked").classList.contains("active"))
      loadRankedSearch();
    queueMicrotask(async()=>{try{await restoreSearchStateFromUrl();await openSharedMapFromUrl();}catch(err){console.warn("Shared ranked state open failed",err);}});
  } catch (err) {
    // A transient failed request must not leave the Ranked dashboard blank indefinitely.
    if (!catalogSummary) {
      try {
        const cached = JSON.parse(localStorage.getItem("osl-ranked-summary-backup") || "null");
        if (cached?.format === "osu-skill-lab-summary" && Array.isArray(cached.search_shards)) {
          catalogSummary = cached;
          renderCatalogSummary(cached);
        }
      } catch (_) {}
    }
    $("catalogUpdated").textContent = "공식 Ranked 통계를 아직 불러오지 못했습니다. 배포 및 연결을 확인하세요.";
    $("hostedSyncState").innerHTML = "검색 인덱스 로딩 실패 · " + cx(err.message) + ' <button type="button" class="ghost-btn" id="retryRankedSummary">다시 불러오기 ↻</button>';
    $("retryRankedSummary")?.addEventListener("click",loadRankedSummary);
    $("officialStatsArea").innerHTML = '<p class="muted">통계 데이터 배포 또는 네트워크 연결을 기다리는 중입니다.</p>';
    console.warn("Ranked summary unavailable", err);
    // Graceful migration: earlier public releases provide a seeded official index.
    try {
      const m = await fetchCatalogJson("data/ranked-manifest.json", Date.now(), true);
      $("catalogHeadline").innerHTML =
        '<div class="metric"><b>' + ct(m.indexed_sets) + '</b><span>수집된 비트맵셋</span></div>' +
        '<div class="metric"><b>' + ct(m.indexed_difficulties) + '</b><span>수집된 난이도</span></div>' +
        '<div class="metric"><b>—</b><span>평균 공식 SR</span></div>' +
        '<div class="metric"><b>—</b><span>평균 BPM</span></div>';
      $("catalogUpdated").textContent = "요약 통계 배포 대기 중 · 기본 DB 목차로 수집량 표시";
    } catch (_) {}
    // Never download the bulky legacy JSON on the landing page.
    if (catalogSummary) {
      $("hostedSyncState").textContent = "저장된 통계 표시 중 · 최신 DB 연결 재시도 중 (" + err.message + ")";
    }
    if (!catalogSummary) $("indexedYear").innerHTML = '<option value="seed">통계 로딩 실패 · 다시 불러오기</option>';
    if (!catalogSummary) $("recentRankedPreview").innerHTML = '<p class="muted">공식 통계 연결 대기 중입니다. 자동 재시도 중이며, 계속 실패하면 다시 불러오기를 눌러주세요.</p>';
    if (summaryRetryCount < 5) {
      const delay = Math.min(30000, 2000 * Math.pow(2, summaryRetryCount++));
      summaryRetryTimer = setTimeout(loadRankedSummary, delay);
    }
  } finally {
    summaryLoadInFlight = false;
  }
}

function renderRecentPreview() {
  if (!catalogSummary) return;
  const recent = (catalogSummary.recent || []).slice();
  rankedIndex = mergeCachedDna(recent);
  indexedLimit = 20;
  renderIndexed();
  $("indexedCount").textContent = "최근 Ranked 미리보기 " + ct(recent.length) +
    "개 · 전체 검색은 위 연도를 선택해서 불러옵니다.";
  const items = recent.slice(0, 7);
  $("recentRankedPreview").innerHTML = items.length ? items.map((m, i) =>
    '<div class="recent-item"><span class="recent-num">' +
    String(i + 1).padStart(2, "0") + '</span><span class="recent-copy">' +
    '<a class="recent-title" href="https://osu.ppy.sh/beatmaps/' +
    encodeURIComponent(m.beatmap_id) + '" target="_blank" rel="noopener noreferrer">' +
    cx(m.artist || "?") + ' — ' + cx(m.title || "?") + '</a>' +
    '<span class="recent-sub">' + cx(m.creator || "Unknown") +
    ' · ' + cx((m.ranked_date || "").slice(0, 10)) + '</span></span>' +
    '<span class="recent-sr">★' + Number(m.official_sr || 0).toFixed(2) +
    '</span></div>').join("") : '<div class="empty">최근 Ranked 데이터가 아직 없습니다.</div>';
}
function compactStoredMap(m) {
  if(!m)return null;
  const keys=["beatmap_id","beatmapset_id","artist","title","creator","version","ranked_date","official_sr","bpm","ar","od","cs","hp","playcount","total_length","status","checksum"];
  const out={}; for(const k of keys) if(m[k]!=null) out[k]=m[k];
  if(m.dna?.skills) out.dna=m.dna;
  return out;
}
function saveDiscoveryState() {
  try{localStorage.setItem("osl-ranked-favorites",JSON.stringify([...favoriteMaps.values()]));}catch(_){}
  try{localStorage.setItem("osl-ranked-recent",JSON.stringify(recentViewedMaps.slice(0,20)));}catch(_){}
}
function renderSavedShelves() {
  const renderList=(host,rows,type)=>{
    if(!host)return;
    host.innerHTML=rows.length?rows.map(m=>'<div class="saved-map-row"><button type="button" class="saved-map-main" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id))+'"><b>'+cx(m.artist||"?")+' — '+cx(m.title||"?")+'</b><small>'+cx(m.creator||"?")+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM</small></button>'+
      (type==="favorite"?'<button type="button" class="saved-map-remove" aria-label="즐겨찾기 제거" data-favorite-map="'+encodeURIComponent(String(m.beatmap_id))+'">★</button>':'')+'</div>').join(""):
      '<div class="empty">'+(type==="favorite"?"즐겨찾기한 채보가 없습니다.":"아직 열어본 채보가 없습니다.")+'</div>';
  };
  renderList($("rankedFavorites"),[...favoriteMaps.values()],"favorite");
  renderList($("rankedRecentViews"),recentViewedMaps,"recent");
}
function rememberViewedMap(map) {
  const clean=compactStoredMap(map); if(!clean?.beatmap_id)return;
  recentViewedMaps=[clean,...recentViewedMaps.filter(m=>String(m.beatmap_id)!==String(clean.beatmap_id))].slice(0,20);
  saveDiscoveryState(); renderSavedShelves();
}
function toggleFavoriteMap(map) {
  const clean=compactStoredMap(map); if(!clean?.beatmap_id)return;
  const id=String(clean.beatmap_id);
  if(favoriteMaps.has(id)) favoriteMaps.delete(id); else favoriteMaps.set(id,clean);
  saveDiscoveryState(); renderSavedShelves(); renderIndexed();
}
function shareMapUrl(map) {
  const url=new URL(location.href);
  url.searchParams.set("map",String(map.beatmap_id));
  const year=String(map.ranked_date||"").slice(0,4);
  if(/^\d{4}$/.test(year))url.searchParams.set("year",year);
  url.hash="ranked";
  return url.toString();
}
async function copyMapShareLink(map) {
  const url=shareMapUrl(map);
  try{await navigator.clipboard.writeText(url);alert("채보 링크를 복사했습니다.");}
  catch(_){prompt("채보 링크를 복사하세요.",url);}
}
function rankedLengthMatch(seconds, mode) {
  const n=Number(seconds||0);
  if(mode==="lt60") return n<60;
  if(mode==="60-120") return n>=60&&n<120;
  if(mode==="120-180") return n>=120&&n<180;
  if(mode==="180-300") return n>=180&&n<300;
  if(mode==="gte300") return n>=300;
  return true;
}
function getRankedFilterState(){
  return {
    minSr:Number($("indexedMinSr")?.value||0), maxSr:Number($("indexedMaxSr")?.value||0),
    minBpm:Number($("indexedMinBpm")?.value||0), maxBpm:Number($("indexedMaxBpm")?.value||0),
    minAr:Number($("indexedMinAr")?.value||0), minOd:Number($("indexedMinOd")?.value||0),
    lengthMode:$("indexedLength")?.value||"all", status:$("indexedStatus")?.value||"all",
    dnaOnly:Boolean($("dnaOnly")?.checked)
  };
}
function getRankedSearchState(){
  const filters=getRankedFilterState();
  return {
    scope:globalSearchActive?"global":($("indexedYear")?.value||"recent"),
    q:($("indexedQuery")?.value||"").trim(),
    sort:$("indexedSort")?.value||"sr_desc",
    ...filters
  };
}
function searchStateSignature(state){
  const s={...state};delete s.saved_at;delete s.name;delete s.result_count;
  return JSON.stringify(s);
}
function persistSearchWorkspace(){
  try{localStorage.setItem("osl-ranked-saved-searches",JSON.stringify(savedSearches.slice(0,20)));}catch(_){}
  try{localStorage.setItem("osl-ranked-search-history",JSON.stringify(rankedSearchHistory.slice(0,12)));}catch(_){}
}
function searchStateLabel(state){
  const parts=[];
  if(state.q)parts.push("“"+state.q+"”");
  if(state.scope==="global")parts.push("전체 DB");
  else if(state.scope?.startsWith("year:"))parts.push(state.scope.slice(5)+"년");
  else if(state.scope?.startsWith("month:"))parts.push(state.scope.slice(6));
  if(Number(state.minSr))parts.push(state.minSr+"★+");
  if(Number(state.maxSr))parts.push("≤"+state.maxSr+"★");
  if(Number(state.minBpm))parts.push(state.minBpm+" BPM+");
  if(Number(state.maxBpm))parts.push("≤"+state.maxBpm+" BPM");
  if(Number(state.minAr))parts.push("AR"+state.minAr+"+");
  if(Number(state.minOd))parts.push("OD"+state.minOd+"+");
  if(state.lengthMode&&state.lengthMode!=="all")parts.push("길이 "+state.lengthMode);
  if(state.status&&state.status!=="all")parts.push(state.status);
  if(state.dnaOnly)parts.push("DNA only");
  return parts.join(" · ")||"전체 조건 없음";
}
function renderSearchWorkspace(){
  const select=$("savedSearchSelect");
  if(select){
    const current=select.value;
    select.innerHTML='<option value="">'+(savedSearches.length?"저장된 검색 조건 선택":"저장된 검색 조건 없음")+'</option>'+
      savedSearches.map((x,i)=>'<option value="'+i+'">'+cx(x.name||("조건 "+(i+1)))+' · '+cx(searchStateLabel(x.state||{}))+'</option>').join("");
    if([...select.options].some(o=>o.value===current))select.value=current;
  }
  const history=$("rankedSearchHistory");
  if(history)history.innerHTML=rankedSearchHistory.length?rankedSearchHistory.map((x,i)=>
    '<button type="button" class="search-history-chip" data-search-history="'+i+'"><b>'+cx(searchStateLabel(x.state||{}))+'</b><small>'+ct(x.result_count||0)+'개 결과</small></button>'
  ).join(""):'<span class="muted">아직 기록 없음</span>';
  const active=$("activeFilterChips");
  if(active){
    const state=getRankedSearchState(),chips=[];
    if(state.q)chips.push("검색 "+state.q);
    if(state.scope==="global")chips.push("전체 DB");
    else if(state.scope&&state.scope!=="recent")chips.push(state.scope.replace("year:","").replace("month:",""));
    if(state.minSr)chips.push(state.minSr+"★+");if(state.maxSr)chips.push("≤"+state.maxSr+"★");
    if(state.minBpm)chips.push(state.minBpm+" BPM+");if(state.maxBpm)chips.push("≤"+state.maxBpm+" BPM");
    if(state.minAr)chips.push("AR"+state.minAr+"+");if(state.minOd)chips.push("OD"+state.minOd+"+");
    if(state.lengthMode!=="all")chips.push("길이 "+state.lengthMode);
    if(state.status!=="all")chips.push(state.status);
    if(state.dnaOnly)chips.push("DNA only");
    if(state.sort!=="sr_desc")chips.push("정렬 "+state.sort);
    active.innerHTML=chips.length?chips.map(x=>'<span>'+cx(x)+'</span>').join(""):'<span class="muted">기본 조건</span>';
  }
}
function applySearchStateToControls(state){
  const set=(id,value)=>{const el=$(id);if(el&&Array.from(el.options||[]).some(o=>o.value===String(value)))el.value=String(value);};
  if($("indexedQuery"))$("indexedQuery").value=state.q||"";
  set("indexedMinSr",state.minSr??0);set("indexedMaxSr",state.maxSr??0);
  set("indexedMinBpm",state.minBpm??0);set("indexedMaxBpm",state.maxBpm??0);
  set("indexedMinAr",state.minAr??0);set("indexedMinOd",state.minOd??0);
  set("indexedLength",state.lengthMode||"all");set("indexedStatus",state.status||"all");
  set("indexedSort",state.sort||"sr_desc");
  if($("dnaOnly"))$("dnaOnly").checked=Boolean(state.dnaOnly);
  if(state.scope!=="global"){
    const scope=state.scope||"recent",range=$("indexedYear");
    if(range&&[...range.options].some(o=>o.value===scope))range.value=scope;
  }
  renderSearchWorkspace();
}
async function executeSearchState(state){
  applySearchStateToControls(state);
  indexedLimit=20;
  if(state.scope==="global"){globalSearchActive=true;await globalRankedSearch();}
  else{globalSearchActive=false;indexedLoadedKey="";await loadRankedSearch();renderIndexed();}
}
function recordSearchHistory(state,resultCount){
  const entry={state:{...state},result_count:Number(resultCount||0),saved_at:new Date().toISOString()};
  const sig=searchStateSignature(entry.state);
  rankedSearchHistory=[entry,...rankedSearchHistory.filter(x=>searchStateSignature(x.state||{})!==sig)].slice(0,12);
  persistSearchWorkspace();renderSearchWorkspace();
}
function buildSearchShareUrl(){
  const state=getRankedSearchState(),url=new URL(location.href);
  for(const key of [...url.searchParams.keys()])url.searchParams.delete(key);
  url.searchParams.set("search","1");
  url.searchParams.set("rscope",state.scope||"recent");
  if(state.q)url.searchParams.set("rq",state.q);
  const pairs={minsr:state.minSr,maxsr:state.maxSr,minbpm:state.minBpm,maxbpm:state.maxBpm,minar:state.minAr,minod:state.minOd,len:state.lengthMode,status:state.status,sort:state.sort,dna:state.dnaOnly?"1":"0"};
  for(const [k,v] of Object.entries(pairs))if(v!=null&&v!==""&&v!==0&&v!=="0"&&v!=="all"&&v!=="sr_desc")url.searchParams.set(k,String(v));
  url.hash="ranked";return url.toString();
}
async function copySearchShareLink(){
  const url=buildSearchShareUrl();
  try{await navigator.clipboard.writeText(url);alert("현재 검색 조건 링크를 복사했습니다.");}
  catch(_){prompt("검색 조건 링크를 복사하세요.",url);}
}
async function restoreSearchStateFromUrl(){
  if(sharedSearchHandled||!catalogSummary)return false;
  const p=new URLSearchParams(location.search);if(p.get("search")!=="1")return false;
  sharedSearchHandled=true;
  const num=k=>Number(p.get(k)||0);
  const state={scope:p.get("rscope")||"recent",q:p.get("rq")||"",minSr:num("minsr"),maxSr:num("maxsr"),minBpm:num("minbpm"),maxBpm:num("maxbpm"),minAr:num("minar"),minOd:num("minod"),lengthMode:p.get("len")||"all",status:p.get("status")||"all",sort:p.get("sort")||"sr_desc",dnaOnly:p.get("dna")==="1"};
  await executeSearchState(state);return true;
}
function csvCell(value){const s=String(value??"");return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
function exportRankedRows(){
  const rows=lastFilteredRows,format=$("rankedExportFormat")?.value||"csv";
  if(!rows.length){alert("내보낼 검색 결과가 없습니다.");return;}
  let data,type,ext;
  if(format==="json"){
    const payload={format:"osu-skill-lab-ranked-results",exported_at:new Date().toISOString(),search:getRankedSearchState(),count:rows.length,maps:rows.map(compactStoredMap)};
    data=JSON.stringify(payload,null,rows.length>5000?0:2);
    type="application/json;charset=utf-8";ext="json";
  }else{
    const fields=["beatmap_id","beatmapset_id","artist","title","version","creator","official_sr","bpm","ar","od","cs","hp","total_length","playcount","status","ranked_date"];
    data="\uFEFF"+fields.join(",")+"\n"+rows.map(m=>fields.map(k=>csvCell(m[k])).join(",")).join("\n");
    type="text/csv;charset=utf-8";ext="csv";
  }
  const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="osu-skill-lab-results-"+new Date().toISOString().slice(0,10)+"."+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function rankedMapMatches(m,filters,q=""){
  const sr=Number(m.official_sr||0), bpm=Number(m.bpm||0), ar=Number(m.ar||0), od=Number(m.od||0);
  if(filters.dnaOnly&&!m.dna?.skills)return false;
  if(sr<filters.minSr||(filters.maxSr&&sr>filters.maxSr)||bpm<filters.minBpm||(filters.maxBpm&&bpm>filters.maxBpm)||ar<filters.minAr||od<filters.minOd)return false;
  if(filters.status!=="all"&&String(m.status||"").toLowerCase()!==filters.status)return false;
  if(!rankedLengthMatch(m.total_length,filters.lengthMode))return false;
  return !q || matchesGlobalQuery(m,q);
}
function renderIndexed() {
  const q = ($("indexedQuery")?.value || "").trim().toLocaleLowerCase();
  const filters=getRankedFilterState();
  const rows = rankedIndex.filter(m => rankedMapMatches(m,filters,q));
  const sort = $("indexedSort")?.value || "sr_desc";
  const numeric=(m,field)=>Number(m?.[field])||0;
  rows.sort((a,b)=>{
    if(sort.startsWith("dna_")){const k=sort.slice(4);return numeric(b.dna?.skills||{},k)-numeric(a.dna?.skills||{},k);}
    if(sort==="sr_asc")return numeric(a,"official_sr")-numeric(b,"official_sr");
    if(sort==="recent")return String(b.ranked_date||"").localeCompare(String(a.ranked_date||""));
    if(sort==="bpm_desc")return numeric(b,"bpm")-numeric(a,"bpm");
    if(sort==="plays")return numeric(b,"playcount")-numeric(a,"playcount");
    if(sort==="length_desc")return numeric(b,"total_length")-numeric(a,"total_length");
    if(sort==="ar_desc")return numeric(b,"ar")-numeric(a,"ar");
    if(sort==="od_desc")return numeric(b,"od")-numeric(a,"od");
    return numeric(b,"official_sr")-numeric(a,"official_sr");
  });
  lastFilteredRows=rows;
  const countEl=$("indexedCount");
  if(countEl) countEl.textContent=ct(rows.length)+" / "+ct(rankedIndex.length)+"채보 · 현재 로드 범위";
  const rs=$("rankedResultSummary");
  if(rs){
    const avg=(field)=>rows.length?rows.reduce((n,m)=>n+Number(m[field]||0),0)/rows.length:0;
    let minResultSr=Infinity,maxResultSr=-Infinity;
    for(const m of rows){const v=Number(m.official_sr);if(Number.isFinite(v)){if(v<minResultSr)minResultSr=v;if(v>maxResultSr)maxResultSr=v;}}
    rs.innerHTML='<span><b>'+ct(rows.length)+'</b> 결과</span><span>평균 <b>★'+avg("official_sr").toFixed(2)+'</b></span>'+
      '<span>평균 <b>'+avg("bpm").toFixed(0)+' BPM</b></span>'+
      (Number.isFinite(minResultSr)?'<span>범위 <b>★'+minResultSr.toFixed(2)+'–'+maxResultSr.toFixed(2)+'</b></span>':'');
  }
  const list=$("indexedList");
  if(list) list.innerHTML=rows.slice(0,indexedLimit).map(m=>{
    const id=String(m.beatmap_id), selected=compareMaps.has(id);
    return '<div class="dbitem ranked-result-card"><b>'+officialMapLink(m)+'</b><div class="muted">'+
      cx(m.creator)+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM · AR'+cx(m.ar)+' OD'+cx(m.od)+
      ' · '+Math.floor(Number(m.total_length||0)/60)+':'+String(Math.round(Number(m.total_length||0)%60)).padStart(2,"0")+
      ' · '+cx((m.ranked_date||"").slice(0,10))+'</div><div class="ranked-result-actions">'+
      '<button type="button" class="ghost-btn" data-ranked-detail="'+encodeURIComponent(id)+'">상세 분석 ↗</button>'+
      (m.dna?.skills?'<button type="button" class="ghost-btn" data-dna-id="'+encodeURIComponent(id)+'">Chart DNA ↗</button>':'<span class="chip">공식 메타데이터</span>')+
      '<button type="button" class="ghost-btn" data-similarity-seed="'+encodeURIComponent(id)+'">유사 채보</button>'+
      '<button type="button" class="ghost-btn favorite-toggle '+(favoriteMaps.has(id)?"active":"")+'" data-favorite-map="'+encodeURIComponent(id)+'">'+(favoriteMaps.has(id)?"★ 저장됨":"☆ 즐겨찾기")+'</button>'+
      '<button type="button" class="ghost-btn compare-toggle '+(selected?"active":"")+'" data-compare-map="'+encodeURIComponent(id)+'">'+(selected?"비교함 ✓":"비교 +")+'</button></div></div>';
  }).join("")||'<div class="empty">검색 결과 없음 · 필터를 완화해 보세요.</div>';
  const more=$("indexedMore"); if(more) more.style.display=rows.length>indexedLimit?"block":"none";
  renderCompareTray();
  renderSearchWorkspace();
}
function scheduleIndexedRender() {
  clearTimeout(indexedSearchTimer);
  indexedSearchTimer = setTimeout(() => {
    indexedLimit = 20;
    renderIndexed();
  }, 130);
}
$("indexedQuery")?.addEventListener("input", scheduleIndexedRender);
$("indexedSort")?.addEventListener("change", async () => {
  indexedLimit = 20;
  if(String($("indexedSort")?.value||"").startsWith("dna_")) await ensureDnaForCurrentSelection();
  renderIndexed();
});
$("indexedMinSr")?.addEventListener("change", () => {indexedLimit = 20; renderIndexed();});
$("indexedMinBpm")?.addEventListener("change", () => {indexedLimit = 20; renderIndexed();});
document.querySelectorAll("[data-ranked-jump]").forEach(b => b.addEventListener("click", () => {
  const sort=$("indexedSort"); if(sort) sort.value=b.dataset.rankedJump;
  indexedLimit = 20; renderIndexed();
  document.querySelector(".filter-toolbar")?.scrollIntoView({behavior:"smooth",block:"start"});
}));
document.querySelectorAll("[data-ranked-preset]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[data-ranked-preset]").forEach(x=>x.classList.toggle("active",x===b));
  const p=b.dataset.rankedPreset, sr=$("indexedMinSr"), bpm=$("indexedMinBpm"), sort=$("indexedSort");
  for(const id of ["indexedMaxSr","indexedMaxBpm","indexedMinAr","indexedMinOd"]){const el=$(id);if(el)el.value="0";}
  if($("indexedLength"))$("indexedLength").value="all";if($("indexedStatus"))$("indexedStatus").value="all";
  if(sr) sr.value = p==="hard" ? "6" : "0";
  if(bpm) bpm.value = p==="fast" ? "200" : "0";
  if(sort) sort.value = p==="popular" ? "plays" : p==="recent" ? "recent" : p==="fast" ? "bpm_desc" : "sr_desc";
  indexedLimit=20; renderIndexed();
}));
$("dnaOnly")?.addEventListener("change", async () => {
  indexedLimit = 20;
  if($("dnaOnly")?.checked) await ensureDnaForCurrentSelection();
  renderIndexed();
});
$("indexedMore")?.addEventListener("click", () => {indexedLimit += 20; renderIndexed();});
$("indexedYear")?.addEventListener("change", () => {globalSearchGeneration++;globalSearchActive=false;indexedLoadedKey = ""; loadRankedSearch();});

function matchesGlobalQuery(m,q){
  return [m.artist,m.title,m.creator,m.version,m.beatmap_id,m.beatmapset_id].some(v=>String(v??"").toLocaleLowerCase().includes(q));
}
async function globalRankedSearch(){
  if(!catalogSummary)return;
  const input=$("indexedQuery"), q=(input?.value||"").trim().toLocaleLowerCase();
  if(q&&q.length<2&&!/^\d+$/.test(q)){alert("검색어는 2글자 이상 입력해 주세요. 숫자 ID는 그대로 검색할 수 있습니다. 검색어 없이 필터만으로도 전체 DB 검색이 가능합니다.");input?.focus();return;}
  const token=++globalSearchGeneration;
  const cancel=$("cancelGlobalSearch"); if(cancel)cancel.hidden=false;
  const button=$("globalRankedSearch"); if(button)button.disabled=true;
  globalSearchActive=true;
  const filters=getRankedFilterState();
  const matches=new Map(), shards=(catalogSummary.search_shards||[]).slice().sort((a,b)=>String(b.month||"").localeCompare(String(a.month||"")));
  let scanned=0, failed=0, totalHits=0;
  try{
    // DNA-only is a real filter too: hydrate one year at a time before evaluating it.
    const dnaManifest=new Map((catalogSummary.chart_dna?.shards||[]).map(sh=>[String(sh.year),sh]));
    for(let i=0;i<shards.length;i+=8){
      if(token!==globalSearchGeneration)return;
      const group=shards.slice(i,i+8);
      const batch=await Promise.allSettled(group.map(async sh=>{
        const rows=await fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
        if(filters.dnaOnly){
          const year=String(sh.year), dnaSh=dnaManifest.get(year);
          if(dnaSh){
            let overlay=dnaOverlayCache.get(year);
            if(!overlay){
              const dnaRows=await fetchCatalogJson(dnaSh.path,dnaSh.version||catalogSummary.updated_at);
              overlay=new Map();
              for(const row of dnaRows){const dna=compactOverlayDna(row);if(row?.beatmap_id&&dna)overlay.set(String(row.beatmap_id),dna);}
              dnaOverlayCache.set(year,overlay);
            }
            for(const m of rows){const dna=overlay.get(String(m.beatmap_id));if(dna)m.dna=dna;}
          }
        }
        return rows;
      }));
      for(const result of batch){
        scanned++;
        if(result.status!=="fulfilled"){failed++;continue;}
        for(const m of result.value){
          if(!m?.beatmap_id||!rankedMapMatches(m,filters,q))continue;
          totalHits++;
          matches.set(String(m.beatmap_id),m);
        }
      }
      rankedIndex=mergeCachedDna([...matches.values()]);
      indexedLimit=20;renderIndexed();
      const pct=shards.length?scanned/shards.length*100:100;
      setRankedLoadState(q?"전체 DB 검색":"전체 DB 필터 검색",ct(totalHits)+"건 일치 · "+scanned+"/"+shards.length+" 월 파일 · 일치 채보 전체 유지",pct);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(token!==globalSearchGeneration)return;
    indexedLoadedKey="global:"+(q||"<filters>")+"@"+(catalogSummary.updated_at||"1");
    const state=$("hostedSyncState");
    if(state)state.textContent=(q?"전체 DB 검색 완료":"검색어 없이 필터 검색 완료")+" · "+ct(totalHits)+"건 · 조건에 맞는 채보 전체 표시 · "+scanned+"파일"+(failed?" · 실패 "+failed:"");
    recordSearchHistory(getRankedSearchState(),totalHits);
    const years=dnaYearsForSelection("global");
    if(years.length&&years.length<=4&&!filters.dnaOnly)loadDnaOverlayYears(years,indexedGeneration,false).catch(()=>{});
  } finally {
    if(token===globalSearchGeneration){
      if(cancel)cancel.hidden=true;
      if(button)button.disabled=false;
    }
  }
}

function cancelGlobalRankedSearch(){
  globalSearchGeneration++;
  const cancel=$("cancelGlobalSearch");if(cancel)cancel.hidden=true;
  const button=$("globalRankedSearch");if(button)button.disabled=false;
  const state=$("hostedSyncState");if(state)state.textContent="전체 DB 검색 취소됨 · 현재까지 찾은 결과는 유지됩니다.";
}
$("globalRankedSearch")?.addEventListener("click",globalRankedSearch);
$("cancelGlobalSearch")?.addEventListener("click",cancelGlobalRankedSearch);

$("saveSearchPreset")?.addEventListener("click",()=>{
  const name=(prompt("이 검색 조건의 이름을 입력하세요.","내 검색 조건")||"").trim();if(!name)return;
  const state=getRankedSearchState(),existing=savedSearches.findIndex(x=>x.name===name);
  const entry={name,state,saved_at:new Date().toISOString()};
  if(existing>=0)savedSearches.splice(existing,1,entry);else savedSearches.unshift(entry);
  savedSearches=savedSearches.slice(0,20);persistSearchWorkspace();renderSearchWorkspace();
});
$("applySavedSearch")?.addEventListener("click",()=>{const raw=$("savedSearchSelect")?.value;if(raw==null||raw==="")return;const i=Number(raw);if(Number.isInteger(i)&&savedSearches[i])executeSearchState(savedSearches[i].state);});
$("deleteSavedSearch")?.addEventListener("click",()=>{const raw=$("savedSearchSelect")?.value;if(raw==null||raw==="")return;const i=Number(raw);if(!Number.isInteger(i)||!savedSearches[i])return;savedSearches.splice(i,1);persistSearchWorkspace();renderSearchWorkspace();});
$("copySearchLink")?.addEventListener("click",copySearchShareLink);
$("exportRankedResults")?.addEventListener("click",exportRankedRows);
document.addEventListener("click",event=>{const b=event.target.closest("[data-search-history]");if(!b)return;const i=Number(b.dataset.searchHistory);if(Number.isInteger(i)&&rankedSearchHistory[i])executeSearchState(rankedSearchHistory[i].state);});
renderSearchWorkspace();

function resetRankedFilters() {
  const defaults={indexedMinSr:"0",indexedMaxSr:"0",indexedMinBpm:"0",indexedMaxBpm:"0",indexedMinAr:"0",indexedMinOd:"0",indexedLength:"all",indexedStatus:"all",indexedSort:"sr_desc"};
  for(const [id,value] of Object.entries(defaults)){const el=$(id);if(el)el.value=value;}
  const dna=$("dnaOnly");if(dna)dna.checked=false;
  const q=$("indexedQuery");if(q)q.value="";
  document.querySelectorAll("[data-ranked-preset]").forEach(x=>x.classList.toggle("active",x.dataset.rankedPreset==="all"));
  indexedLimit=20;renderIndexed();
}
function similarityDnaDistance(a,b){
  if(!a?.dna?.skills||!b?.dna?.skills)return null;
  const keys=["aim","stream","speed","stamina","tech","reading","flow"];
  let sum=0;
  for(const k of keys)sum+=Math.pow((Number(a.dna.skills[k]||0)-Number(b.dna.skills[k]||0))/25,2);
  return Math.sqrt(sum/keys.length);
}
function similarityMetaDistance(a,b){
  const defs=[["official_sr",1.2,1.25],["bpm",75,1],["ar",1.7,.8],["od",1.7,.8],["cs",1.2,.5],["total_length",150,.65]];
  let sum=0,weights=0;
  for(const [key,scale,weight] of defs){
    if(a?.[key]==null||b?.[key]==null)continue;
    sum+=Math.pow((Number(a[key])-Number(b[key]))/scale,2)*weight;weights+=weight;
  }
  return weights?Math.sqrt(sum/weights):999;
}
function similarityScore(seed,map,mode){
  if(!seed||!map||String(seed.beatmap_id)===String(map.beatmap_id))return Infinity;
  const meta=similarityMetaDistance(seed,map);
  if(mode==="mapper")return String(seed.creator||"")===String(map.creator||"")?meta:Infinity;
  if(mode==="era"){
    const ya=Number(String(seed.ranked_date||"").slice(0,4)), yb=Number(String(map.ranked_date||"").slice(0,4));
    if(!Number.isFinite(ya)||!Number.isFinite(yb))return meta+2;
    return meta*.55+Math.abs(ya-yb)/2*.45;
  }
  const dna=similarityDnaDistance(seed,map);
  if(mode==="dna")return dna==null?Infinity:dna;
  if(mode==="metadata")return meta;
  return dna==null?meta+.06:meta*.58+dna*.42;
}
function keepSimilarityBest(best,map,score,cap){
  if(!Number.isFinite(score)||score===Infinity)return;
  best.push({map,score});
  if(best.length>cap*2){best.sort((a,b)=>a.score-b.score);best.length=cap;}
}
function renderSimilaritySeed(){
  const host=$("similaritySeed");if(!host)return;
  const m=similaritySeedMap;
  host.innerHTML=m?'<div class="similarity-seed-card"><div><span>기준 채보</span><b>'+cx(m.artist||"?")+' — '+cx(m.title||"?")+' ['+cx(m.version||"?")+']</b><small>'+cx(m.creator||"?")+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM · '+cx(String(m.ranked_date||"").slice(0,10))+'</small></div><div class="similarity-seed-badges"><span>'+ (m.dna?.skills?"DNA 분석 완료":"메타데이터") +'</span><button type="button" class="ghost-btn" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id))+'">상세</button></div></div>':
    '<div class="empty">검색 결과나 상세창에서 ‘유사 채보’ 버튼을 눌러 기준 채보를 선택하세요.</div>';
}
function setSimilaritySeed(map,autoRun=false){
  if(!map?.beatmap_id)return;
  similaritySeedMap=map;
  renderSimilaritySeed();
  const panel=$("similaritySeed")?.closest(".similarity-explorer");
  panel?.scrollIntoView({behavior:"smooth",block:"start"});
  const status=$("similarityStatus");if(status)status.textContent="기준 채보 선택됨 · 유사 기준과 범위를 선택하세요.";
  if($("relationGraphStatus"))$("relationGraphStatus").textContent="새 기준 채보 선택됨 · 관계망 만들기를 누르면 다시 계산합니다.";
  if(autoRun)runSimilarityExplorer();
}
function similarityResultHtml(rows,mode){
  const host=$("similarityResults");if(!host)return;
  similarityResultMaps.clear();
  for(const row of rows)if(row?.map?.beatmap_id)similarityResultMaps.set(String(row.map.beatmap_id),row.map);
  host.innerHTML=rows.length?rows.map((x,i)=>{
    const m=x.map,id=String(m.beatmap_id),dna=similarityDnaDistance(similaritySeedMap,m);
    const year=String(m.ranked_date||"").slice(0,4);
    return '<div class="similarity-row"><b class="similarity-rank">#'+(i+1)+'</b><div class="similarity-copy"><button type="button" data-ranked-detail="'+encodeURIComponent(id)+'"><strong>'+cx(m.artist||"?")+' — '+cx(m.title||"?")+' ['+cx(m.version||"?")+']</strong></button><small>'+cx(m.creator||"?")+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM · '+cx(year)+'</small><div class="similarity-delta"><span>거리 '+Number(x.score).toFixed(3)+'</span><span>ΔSR '+Math.abs(Number(m.official_sr||0)-Number(similaritySeedMap?.official_sr||0)).toFixed(2)+'</span><span>ΔBPM '+Math.abs(Number(m.bpm||0)-Number(similaritySeedMap?.bpm||0)).toFixed(0)+'</span>'+(dna==null?'':'<span>DNA '+dna.toFixed(3)+'</span>')+'</div></div><div class="similarity-actions"><button type="button" class="ghost-btn" data-similarity-seed="'+encodeURIComponent(id)+'">이걸 기준</button><button type="button" class="ghost-btn" data-compare-map="'+encodeURIComponent(id)+'">비교 +</button></div></div>';
  }).join(""):'<div class="empty">조건에 맞는 유사 채보를 찾지 못했습니다.</div>';
}
async function resolveSimilarityIds(idRows,token,generationKind="similarity"){
  const wanted=new Set(idRows.map(x=>String(x.id))), found=new Map();
  if(!wanted.size)return [];
  const generationNow=()=>generationKind==="relation"?relationGeneration:similarityGeneration;
  for(const m of rankedIndex)if(wanted.has(String(m.beatmap_id)))found.set(String(m.beatmap_id),m);
  for(const m of [...favoriteMaps.values(),...recentViewedMaps])if(wanted.has(String(m.beatmap_id)))found.set(String(m.beatmap_id),m);
  const years=new Set(idRows.map(x=>String(x.year||"")).filter(y=>/^\d{4}$/.test(y)));
  const shards=(catalogSummary?.search_shards||[]).filter(sh=>!years.size||years.has(String(sh.year)));
  for(let i=0;i<shards.length&&found.size<wanted.size;i+=6){
    if(token!==generationNow())return [];
    const batch=await Promise.allSettled(shards.slice(i,i+6).map(async sh=>{
      const key=sh.path+"@"+(sh.version||catalogSummary.updated_at||"1");
      if(indexedYearCache.has(key))return indexedYearCache.get(key);
      return fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
    }));
    for(const r of batch)if(r.status==="fulfilled")for(const m of r.value)if(wanted.has(String(m.beatmap_id)))found.set(String(m.beatmap_id),m);
  }
  return idRows.map(x=>({map:found.get(String(x.id)),score:x.score})).filter(x=>x.map);
}
async function hydrateSimilarityCandidateDna(rows,token){
  const byYear=new Map();
  for(const row of rows){
    const year=String(row.map?.ranked_date||"").slice(0,4),id=String(row.map?.beatmap_id||"");
    if(!/^\d{4}$/.test(year)||!id)continue;
    if(!byYear.has(year))byYear.set(year,new Map());
    byYear.get(year).set(id,row.map);
  }
  const manifest=new Map((catalogSummary?.chart_dna?.shards||[]).map(sh=>[String(sh.year),sh]));
  let done=0;
  for(const [year,wanted] of byYear){
    if(token!==similarityGeneration)return;
    const cached=dnaOverlayCache.get(year);
    if(cached){
      for(const [id,map] of wanted){const dna=cached.get(id);if(dna)map.dna=dna;}
    }else{
      const sh=manifest.get(year);if(!sh){done++;continue;}
      const records=await fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
      for(const record of records){
        const id=String(record?.beatmap_id||"");
        if(!wanted.has(id))continue;
        const dna=compactOverlayDna(record);if(dna)wanted.get(id).dna=dna;
      }
    }
    done++;
    const status=$("similarityStatus");if(status)status.textContent="상위 후보 DNA 보강 · "+done+"/"+byYear.size+" 연도";
    await new Promise(r=>setTimeout(r,0));
  }
}
async function runGlobalDnaSimilarity(seed,limit,token){
  if(!seed?.dna?.skills)throw Error("기준 채보의 Chart DNA 분석이 아직 없습니다.");
  const shards=catalogSummary?.chart_dna?.shards||[], best=[], cap=Math.max(limit*5,80);
  for(let i=0;i<shards.length;i++){
    if(token!==similarityGeneration)return [];
    const sh=shards[i],year=String(sh.year),cached=dnaOverlayCache.get(year);
    if(cached){
      for(const [id,dna] of cached){
        if(id===String(seed.beatmap_id))continue;
        const candidate={beatmap_id:id,dna,ranked_date:year+"-01-01"};
        const score=similarityDnaDistance(seed,candidate);
        if(score!=null)keepSimilarityBest(best,candidate,score,cap);
      }
    }else{
      const records=await fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
      for(const record of records){
        const id=String(record?.beatmap_id||"");if(!id||id===String(seed.beatmap_id))continue;
        const dna=compactOverlayDna(record);if(!dna)continue;
        const candidate={beatmap_id:id,dna,ranked_date:String(record.ranked_date||year+"-01-01")};
        const score=similarityDnaDistance(seed,candidate);
        if(score!=null)keepSimilarityBest(best,candidate,score,cap);
      }
    }
    best.sort((a,b)=>a.score-b.score);if(best.length>cap)best.length=cap;
    const status=$("similarityStatus");if(status)status.textContent="DNA overlay 탐색 · "+(i+1)+"/"+shards.length+" 연도 · 상위 후보 "+ct(best.length)+" · 전체 overlay는 메모리에 보관하지 않음";
    await new Promise(r=>setTimeout(r,0));
  }
  const top=best.slice(0,Math.max(limit*3,40)), dnaById=new Map(top.map(x=>[String(x.map.beatmap_id),x.map.dna]));
  const ids=top.map(x=>({id:x.map.beatmap_id,year:String(x.map.ranked_date||"").slice(0,4),score:x.score}));
  const resolved=await resolveSimilarityIds(ids,token);
  for(const row of resolved){
    const dna=dnaById.get(String(row.map.beatmap_id));if(dna)row.map.dna=dna;
    row.score=similarityDnaDistance(seed,row.map)??row.score;
  }
  return resolved.sort((a,b)=>a.score-b.score).slice(0,limit);
}
async function runGlobalMetaSimilarity(seed,mode,limit,token){
  if(mode==="balanced"){
    const pre=catalogSummary?.research?.similarity_index?.[String(seed.beatmap_id)];
    if(Array.isArray(pre)&&pre.length){
      const rows=await resolveSimilarityIds(pre.map(x=>({id:x.beatmap_id,year:x.year,score:Number(x.distance)})),token);
      if(token!==similarityGeneration)return [];
      const hydrated=rows.map(row=>{mergeCachedDna([row.map]);if(row.map.dna?.skills&&seed.dna?.skills)row.score=similarityScore(seed,row.map,"balanced");return row;})
        .sort((a,b)=>a.score-b.score).slice(0,limit);
      const status=$("similarityStatus");if(status)status.textContent="사전 계산 유사도 인덱스 사용 · 전역 스캔 없이 즉시 후보 확인";
      return hydrated;
    }
  }
  let shards=(catalogSummary?.search_shards||[]).slice();
  if(mode==="era"){
    const y=Number(String(seed.ranked_date||"").slice(0,4));
    if(Number.isFinite(y))shards=shards.filter(sh=>Math.abs(Number(sh.year)-y)<=2);
  }
  const best=[],cap=Math.max(limit*6,100);
  let scanned=0;
  for(let i=0;i<shards.length;i+=8){
    if(token!==similarityGeneration)return [];
    const batch=await Promise.allSettled(shards.slice(i,i+8).map(async sh=>{
      const key=sh.path+"@"+(sh.version||catalogSummary.updated_at||"1");
      if(indexedYearCache.has(key))return indexedYearCache.get(key);
      return fetchCatalogJson(sh.path,sh.version||catalogSummary.updated_at);
    }));
    for(const r of batch){
      scanned++;
      if(r.status!=="fulfilled")continue;
      for(const m of r.value)keepSimilarityBest(best,m,similarityScore(seed,m,mode==="balanced"?"metadata":mode),cap);
    }
    best.sort((a,b)=>a.score-b.score);if(best.length>cap)best.length=cap;
    const status=$("similarityStatus");if(status)status.textContent="전체 DB 유사도 계산 · "+scanned+"/"+shards.length+" 파일 · 상위 후보 "+ct(best.length);
    await new Promise(r=>setTimeout(r,0));
  }
  if(mode==="balanced"&&seed.dna?.skills){
    await hydrateSimilarityCandidateDna(best.slice(0,cap),token);
    if(token!==similarityGeneration)return [];
    for(const row of best)row.score=similarityScore(seed,row.map,"balanced");
  }
  return best.sort((a,b)=>a.score-b.score).slice(0,limit);
}
async function runSimilarityExplorer(){
  const seed=similaritySeedMap,host=$("similarityResults"),status=$("similarityStatus");
  if(!seed){alert("먼저 기준 채보를 선택해 주세요.");return;}
  const mode=$("similarityMode")?.value||"balanced",scope=$("similarityScope")?.value||"loaded",limit=Number($("similarityLimit")?.value||20);
  const token=++similarityGeneration,run=$("runSimilarity"),cancel=$("cancelSimilarity");
  if(run)run.disabled=true;if(cancel)cancel.hidden=false;
  if(host)host.innerHTML='<div class="empty">유사 채보 계산 중…</div>';
  try{
    if((mode==="dna"||mode==="balanced")&&!seed.dna?.skills){
      const year=String(seed.ranked_date||"").slice(0,4);
      if(/^\d{4}$/.test(year)){
        await loadDnaOverlayYears([year],indexedGeneration,false);
        mergeCachedDna([seed]);renderSimilaritySeed();
      }
      if(mode==="dna"&&!seed.dna?.skills)throw Error("기준 채보의 Chart DNA 분석이 아직 없습니다.");
    }
    let rows=[];
    if(scope==="loaded"){
      rows=rankedIndex.map(m=>({map:m,score:similarityScore(seed,m,mode)})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>a.score-b.score).slice(0,limit);
    }else if(mode==="dna"){
      rows=await runGlobalDnaSimilarity(seed,limit,token);
    }else{
      rows=await runGlobalMetaSimilarity(seed,mode,limit,token);
    }
    if(token!==similarityGeneration)return;
    similarityResultHtml(rows,mode);
    if(status)status.textContent=(scope==="global"?"전체 Ranked DB":"현재 로드 범위")+" · "+({balanced:"종합",metadata:"메타데이터",dna:"Chart DNA",mapper:"같은 맵퍼",era:"같은 시대"}[mode]||mode)+" 기준 · "+ct(rows.length)+"개 결과";
  }catch(err){
    if(token!==similarityGeneration)return;
    if(host)host.innerHTML='<div class="empty">유사 채보 탐색 실패 · '+cx(err.message)+'</div>';
    if(status)status.textContent=err.message;
  }finally{
    if(token===similarityGeneration){if(run)run.disabled=false;if(cancel)cancel.hidden=true;}
  }
}
$("runSimilarity")?.addEventListener("click",runSimilarityExplorer);
$("cancelSimilarity")?.addEventListener("click",()=>{similarityGeneration++;if($("cancelSimilarity"))$("cancelSimilarity").hidden=true;if($("runSimilarity"))$("runSimilarity").disabled=false;if($("similarityStatus"))$("similarityStatus").textContent="유사 채보 탐색 취소됨";});

function relationKinds(a,b){
  const kinds=[];
  if(a?.beatmapset_id&&String(a.beatmapset_id)===String(b?.beatmapset_id))kinds.push("set");
  if(a?.creator&&String(a.creator)===String(b?.creator))kinds.push("mapper");
  const dna=similarityDnaDistance(a,b);if(dna!=null&&dna<1.05)kinds.push("dna");
  const meta=similarityMetaDistance(a,b);if(meta<.72)kinds.push("meta");
  const ya=Number(String(a?.ranked_date||"").slice(0,4)),yb=Number(String(b?.ranked_date||"").slice(0,4));
  if(Number.isFinite(ya)&&Number.isFinite(yb)&&Math.abs(ya-yb)<=1)kinds.push("era");
  return kinds;
}
function relationStrength(a,b){
  const kinds=relationKinds(a,b), meta=similarityMetaDistance(a,b), dna=similarityDnaDistance(a,b);
  let score=1/(.18+meta);
  if(dna!=null)score+=1/(.3+dna)*.7;
  if(kinds.includes("set"))score+=5;
  if(kinds.includes("mapper"))score+=2.4;
  if(kinds.includes("era"))score+=.35;
  return score;
}
function relationNodePool(){
  const all=new Map();
  for(const m of rankedIndex)if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  for(const m of similarityResultMaps.values())if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  for(const m of favoriteMaps.values())if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  for(const m of recentViewedMaps)if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  for(const m of trainingRouteMaps.values())if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  for(const m of relationGraphMaps.values())if(m?.beatmap_id)all.set(String(m.beatmap_id),m);
  return [...all.values()];
}
async function relationCandidates(focus,limit,token){
  const pool=relationNodePool().filter(m=>String(m.beatmap_id)!==String(focus.beatmap_id));
  const pre=catalogSummary?.research?.similarity_index?.[String(focus.beatmap_id)]||[];
  if(pre.length){
    const resolved=await resolveSimilarityIds(pre.slice(0,Math.max(limit*2,24)).map(x=>({id:x.beatmap_id,year:x.year,score:x.distance})),token,"relation");
    for(const row of resolved)if(row.map?.beatmap_id&&!pool.some(m=>String(m.beatmap_id)===String(row.map.beatmap_id)))pool.push(row.map);
  }
  return pool.map(m=>({map:m,strength:relationStrength(focus,m),kinds:relationKinds(focus,m)}))
    .filter(x=>x.kinds.length||x.strength>.62)
    .sort((a,b)=>b.strength-a.strength).slice(0,limit);
}
function relationEdgeKind(kinds){
  for(const k of ["set","mapper","dna","meta","era"])if(kinds.includes(k))return k;
  return "meta";
}
function renderRelationGraph(nodes,edges,focus){
  const edgeHost=$("relationGraphEdges"),nodeHost=$("relationGraphNodes"),svg=$("relationGraph");
  if(!edgeHost||!nodeHost||!svg)return;
  relationGraphMaps.clear();for(const n of nodes)relationGraphMaps.set(String(n.map.beatmap_id),n.map);
  const W=1000,H=560,cx0=500,cy0=280;
  const others=nodes.filter(n=>!n.root),count=Math.max(1,others.length);
  const positions=new Map([[String(focus.beatmap_id),{x:cx0,y:cy0}]]);
  others.forEach((n,i)=>{
    const ring=i<8?1:2, ringIndex=ring===1?i:i-8, ringCount=ring===1?Math.min(8,count):Math.max(1,count-8);
    const angle=-Math.PI/2+(ringIndex/ringCount)*Math.PI*2+(ring===2?.2:0);
    const radius=ring===1?155:235;
    positions.set(String(n.map.beatmap_id),{x:cx0+Math.cos(angle)*radius,y:cy0+Math.sin(angle)*radius});
  });
  edgeHost.innerHTML=edges.map(e=>{
    const a=positions.get(String(e.a)),b=positions.get(String(e.b));if(!a||!b)return"";
    return '<line class="relation-edge kind-'+cx(e.kind)+'" x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'"><title>'+cx(e.label)+'</title></line>';
  }).join("");
  nodeHost.innerHTML=nodes.map(n=>{
    const id=String(n.map.beatmap_id),p=positions.get(id),root=n.root,selected=relationSelectedMap&&String(relationSelectedMap.beatmap_id)===id;
    const title=(n.map.title||"?").slice(0,22),sub="★"+Number(n.map.official_sr||0).toFixed(2)+" · "+Number(n.map.bpm||0).toFixed(0)+" BPM";
    return '<g class="relation-node '+(root?"root ":"")+(selected?"selected":"")+'" data-relation-node="'+encodeURIComponent(id)+'" transform="translate('+p.x.toFixed(1)+' '+p.y.toFixed(1)+')" tabindex="0" role="button"><circle r="'+(root?46:34)+'"></circle><text class="relation-title" text-anchor="middle" y="'+(root?62:50)+'">'+cx(title)+'</text><text class="relation-sub" text-anchor="middle" y="'+(root?76:63)+'">'+cx(sub)+'</text><title>'+cx(n.map.artist||"?")+' — '+cx(n.map.title||"?")+' ['+cx(n.map.version||"?")+']</title></g>';
  }).join("");
}
function renderRelationInspector(map,focus){
  const host=$("relationNodeInspector"),expand=$("expandRelationNode");if(!host)return;
  if(!map){host.innerHTML='<div class="empty">그래프에서 노드를 선택하면 관계와 상세 정보가 표시됩니다.</div>';if(expand)expand.disabled=true;return;}
  relationSelectedMap=map;if(expand)expand.disabled=false;
  const kinds=focus&&String(map.beatmap_id)!==String(focus.beatmap_id)?relationKinds(focus,map):[];
  host.innerHTML='<div class="relation-inspector-card"><div><span>선택 노드</span><b>'+cx(map.artist||"?")+' — '+cx(map.title||"?")+' ['+cx(map.version||"?")+']</b><small>'+cx(map.creator||"?")+' · ★'+Number(map.official_sr||0).toFixed(2)+' · '+Number(map.bpm||0).toFixed(0)+' BPM · '+cx(String(map.ranked_date||"").slice(0,10))+'</small></div><div class="relation-kind-badges">'+(kinds.length?kinds.map(k=>'<span data-rel-kind="'+cx(k)+'">'+cx({set:"같은 세트",mapper:"같은 맵퍼",dna:"DNA 유사",meta:"구조 유사",era:"같은 시대"}[k]||k)+'</span>').join(""):'<span>중심 노드</span>')+'</div><div class="relation-inspector-actions"><button type="button" class="ghost-btn" data-ranked-detail="'+encodeURIComponent(String(map.beatmap_id))+'">상세</button><button type="button" class="ghost-btn" data-similarity-seed="'+encodeURIComponent(String(map.beatmap_id))+'">유사도 기준</button><button type="button" class="ghost-btn" data-compare-map="'+encodeURIComponent(String(map.beatmap_id))+'">비교 +</button></div></div>';
}
async function buildRelationGraph(focus=similaritySeedMap){
  if(!focus){alert("먼저 Similarity Explorer의 기준 채보를 선택해 주세요.");return;}
  const token=++relationGeneration,limit=Number($("relationNodeLimit")?.value||16),density=$("relationDensity")?.value||"normal",status=$("relationGraphStatus");
  relationFocusMap=focus;relationSelectedMap=focus;if(status)status.textContent="관계 후보 수집 중…";
  const candidates=await relationCandidates(focus,Math.max(1,limit-1),token);if(token!==relationGeneration)return;
  const nodes=[{map:focus,root:true},...candidates.map(x=>({map:x.map,root:false}))],edges=[];
  for(const item of candidates){
    const kinds=item.kinds.length?item.kinds:["meta"],kind=relationEdgeKind(kinds);
    edges.push({a:focus.beatmap_id,b:item.map.beatmap_id,kind,label:kinds.join(" · ")});
  }
  if(density!=="light"){
    const maxCross=density==="dense"?Math.max(12,limit*2):Math.max(5,Math.floor(limit*.7));
    const cross=[];
    for(let i=1;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const kinds=relationKinds(nodes[i].map,nodes[j].map);
      if(!kinds.length)continue;
      cross.push({a:nodes[i].map.beatmap_id,b:nodes[j].map.beatmap_id,kind:relationEdgeKind(kinds),label:kinds.join(" · "),score:relationStrength(nodes[i].map,nodes[j].map)});
    }
    cross.sort((a,b)=>b.score-a.score);edges.push(...cross.slice(0,maxCross));
  }
  renderRelationGraph(nodes,edges,focus);renderRelationInspector(focus,focus);
  if(status)status.textContent=ct(nodes.length)+"개 노드 · "+ct(edges.length)+"개 관계 · 중심: "+(focus.title||"?");
}
$("buildRelationGraph")?.addEventListener("click",()=>buildRelationGraph());
$("expandRelationNode")?.addEventListener("click",()=>{if(relationSelectedMap)buildRelationGraph(relationSelectedMap);});
$("resetRelationGraph")?.addEventListener("click",()=>{relationGeneration++;relationGraphMaps.clear();relationSelectedMap=null;relationFocusMap=null;if($("relationGraphEdges"))$("relationGraphEdges").innerHTML="";if($("relationGraphNodes"))$("relationGraphNodes").innerHTML="";renderRelationInspector(null,null);if($("relationGraphStatus"))$("relationGraphStatus").textContent="Similarity Explorer의 기준 채보를 선택하면 관계망을 만들 수 있습니다.";});
document.addEventListener("click",event=>{
  const node=event.target.closest("[data-relation-node]");if(!node)return;
  const id=decodeURIComponent(node.dataset.relationNode||""),map=relationGraphMaps.get(id);if(!map)return;
  document.querySelectorAll(".relation-node.selected").forEach(x=>x.classList.remove("selected"));node.classList.add("selected");
  renderRelationInspector(map,relationFocusMap);
});
document.addEventListener("keydown",event=>{
  if(event.key!=="Enter"&&event.key!==" ")return;
  const node=event.target.closest?.("[data-relation-node]");if(!node)return;
  event.preventDefault();node.dispatchEvent(new MouseEvent("click",{bubbles:true}));
});

function saveCompareMaps(){
  try{localStorage.setItem("osl-ranked-compare",JSON.stringify([...compareMaps.values()].slice(0,4)));}catch(_){}
}
function renderCompareTray(){
  const tray=$("compareTray"), items=$("compareTrayItems"), count=$("compareCount");
  if(count)count.textContent=String(compareMaps.size);
  if(!tray||!items)return;
  tray.hidden=compareMaps.size===0;
  items.innerHTML=[...compareMaps.values()].map(m=>'<button type="button" class="compare-chip" data-compare-remove="'+encodeURIComponent(String(m.beatmap_id))+'"><span>'+cx(m.title||"?")+'</span><small>★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM</small><b>×</b></button>').join("");
}
function toggleCompareMap(map){
  if(!map?.beatmap_id)return;
  const id=String(map.beatmap_id);
  if(compareMaps.has(id))compareMaps.delete(id);
  else{
    if(compareMaps.size>=4){alert("채보 비교는 최대 4개까지 가능합니다.");return;}
    compareMaps.set(id,{...map});
  }
  saveCompareMaps();renderCompareTray();renderIndexed();
}
function showCompareMaps(){
  const maps=[...compareMaps.values()];
  if(!maps.length){alert("비교할 채보를 먼저 추가해 주세요.");return;}
  const body=$("chartModalBody"), dialog=$("chartModal");if(!body||!dialog)return;
  const fields=[
    ["공식 SR",m=>"★"+Number(m.official_sr||0).toFixed(2)],
    ["BPM",m=>Number(m.bpm||0).toFixed(1)],
    ["AR",m=>m.ar??"—"],["OD",m=>m.od??"—"],["CS",m=>m.cs??"—"],["HP",m=>m.hp??"—"],
    ["길이",m=>Math.floor(Number(m.total_length||0)/60)+"m "+Math.round(Number(m.total_length||0)%60)+"s"],
    ["플레이",m=>ct(m.playcount)],["Ranked",m=>String(m.ranked_date||"—").slice(0,10)]
  ];
  const headers=maps.map((m,i)=>'<th><span>#'+(i+1)+'</span>'+cx(m.title||"?")+'<small>['+cx(m.version||"?")+'] · '+cx(m.creator||"?")+'</small></th>').join("");
  const rows=fields.map(([name,get])=>'<tr><th>'+cx(name)+'</th>'+maps.map(m=>'<td>'+cx(get(m))+'</td>').join("")+'</tr>').join("");
  const skillKeys=["aim","stream","speed","stamina","tech","reading","flow","overall"];
  const dnaRows=skillKeys.map(k=>'<tr><th>DNA '+k.toUpperCase()+'</th>'+maps.map(m=>'<td>'+(m.dna?.skills?.[k]==null?"—":Number(m.dna.skills[k]).toFixed(1))+'</td>').join("")+'</tr>').join("");
  body.innerHTML='<span class="chart-dna-badge">Ranked Compare · 최대 4채보</span><h2>채보 직접 비교</h2>'+
    '<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>항목</th>'+headers+'</tr></thead><tbody>'+rows+dnaRows+'</tbody></table></div>'+
    '<p class="hint-text">공식 메타데이터는 osu! 수집 DB 기준입니다. DNA 행은 실제 .osu 분석이 완료된 채보에만 표시되며 공식 난이도/pp가 아닙니다.</p>';
  if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();else dialog.setAttribute("open","");
}
for(const id of ["indexedMaxSr","indexedMaxBpm","indexedMinAr","indexedMinOd","indexedLength","indexedStatus"]){
  $(id)?.addEventListener("change",()=>{indexedLimit=20;renderIndexed();});
}
$("resetRankedFilters")?.addEventListener("click",resetRankedFilters);
$("randomRanked")?.addEventListener("click",()=>{
  if(!lastFilteredRows.length){alert("현재 필터에 맞는 채보가 없습니다.");return;}
  showRankedDetails(lastFilteredRows[Math.floor(Math.random()*lastFilteredRows.length)]);
});
$("openCompare")?.addEventListener("click",()=>{if(compareMaps.size)showCompareMaps();else $("compareTray")?.scrollIntoView({behavior:"smooth",block:"center"});});
$("compareNow")?.addEventListener("click",showCompareMaps);
$("clearCompare")?.addEventListener("click",()=>{compareMaps.clear();saveCompareMaps();renderCompareTray();renderIndexed();});
document.addEventListener("click",event=>{
  const add=event.target.closest("[data-compare-map]");
  if(add){event.preventDefault();const id=decodeURIComponent(add.dataset.compareMap||"");const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);toggleCompareMap(map);return;}
  const remove=event.target.closest("[data-compare-remove]");
  if(remove){event.preventDefault();compareMaps.delete(decodeURIComponent(remove.dataset.compareRemove||""));saveCompareMaps();renderCompareTray();renderIndexed();}
});
renderCompareTray();

async function loadLegacyRanked() {
  if (legacyLoaded) return;
  $("hostedSyncState").textContent = "구버전 예비 색인 다운로드 중…";
  try {
    const legacy = await fetchCatalogJson("data/ranked-index.json", "seed1");
    if (!Array.isArray(legacy.maps)) throw Error("예비 색인 형식 오류");
    rankedIndex = legacy.maps.filter(m => m?.beatmap_id && m.source === "osu! API v2");
    legacyLoaded = true;
    indexedLimit = 20;
    renderIndexed();
    $("hostedSyncState").textContent = "예비 검색 " + ct(rankedIndex.length) +
      "채보 준비 완료 · 새 통계 파일 배포를 기다리는 중";
  } catch (e) {
    $("hostedSyncState").textContent = "예비 색인 로딩 실패 · " + e.message;
  }
}
async function loadRankedSearch() {
  if (!catalogSummary) return loadLegacyRanked();
  globalSearchActive=false;
  const selection = $("indexedYear").value || "recent";
  if (selection === "recent") {
    indexedGeneration++;
    indexedLoadedKey = "";
    renderRecentPreview();
    $("hostedSyncState").textContent = "최근 Ranked 30개 · 추가 다운로드 없음 (전체 검색은 월/연도 선택)";
    return;
  }
  const version = catalogSummary.updated_at || "1";
  const key = selection + "@" + version;
  if (key === indexedLoadedKey) return;
  if (indexedLoadPromise?.key === key) return indexedLoadPromise.promise;
  const shards = selection === "all" ? catalogSummary.search_shards :
    selection.startsWith("month:") ? catalogSummary.search_shards.filter(sh => sh.month === selection.slice(6)) :
    selection.startsWith("year:") ? catalogSummary.search_shards.filter(sh => sh.year === selection.slice(5)) :
    catalogSummary.search_shards.filter(sh => sh.year === selection); // v1 compatibility
  if (!shards.length) {
    $("hostedSyncState").textContent = "선택한 범위의 공개 검색 파일이 없습니다.";
    return;
  }
  const generation = ++indexedGeneration;
  const task = (async () => {
    const gathered = new Map();
    let loaded = 0, failed = 0;
    $("hostedSyncState").textContent = "검색 데이터 준비 중… " + shards.length + "개 월별 파일";
    const range = selection === "all" ? "전체 연도" : selection.replace("month:", "").replace("year:", "");
    for (let i = 0; i < shards.length; i += 3) {
      const batch = await Promise.allSettled(shards.slice(i, i+3).map(async sh => {
        const cacheKey = sh.path + "@" + (sh.version || version);
        if (indexedYearCache.has(cacheKey)) return indexedYearCache.get(cacheKey);
        const rows = await fetchCatalogJson(sh.path, sh.version || version);
        if (!Array.isArray(rows)) throw Error("손상된 검색 파일 · " + sh.path);
        indexedYearCache.set(cacheKey, rows);
        return rows;
      }));
      if (generation !== indexedGeneration) return;
      for (const item of batch) {
        if (item.status === "fulfilled") {
          loaded += item.value.length;
          for (const m of item.value) if(m?.beatmap_id) gathered.set(String(m.beatmap_id),m);
        } else {
          failed++;
          console.warn("Partial Ranked index unavailable",item.reason);
        }
      }
      // Progressively show results: the visitor doesn't wait for all years.
      rankedIndex = mergeCachedDna([...gathered.values()]);
      indexedLimit = 20;
      renderIndexed();
      $("hostedSyncState").textContent = "검색 데이터 " + ct(loaded) + "개 로드 · " +
        Math.min(i+3,shards.length) + "/" + shards.length + "파일" +
        (failed ? " · 실패 " + failed : "");
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if (generation !== indexedGeneration) return;
    for (const m of indexedImported.values()) {
      const date = String(m.ranked_date || "");
      if (selection === "all" ||
          (selection.startsWith("year:") && date.startsWith(selection.slice(5))) ||
          (selection.startsWith("month:") && date.startsWith(selection.slice(6))))
        gathered.set(String(m.beatmap_id),m);
    }
    rankedIndex = mergeCachedDna([...gathered.values()]);
    indexedLoadedKey = failed ? "" : key;
    indexedLimit = 20;
    renderIndexed();
    $("hostedSyncState").textContent = range + " · " + ct(rankedIndex.length) +
      "채보 검색 가능" + (failed ? " · 일부 파일 실패 (범위를 바꿔 다시 시도)" : "") +
      " · 메타데이터 준비 완료";
    if(selection!=="all"){
      const years=dnaYearsForSelection(selection);
      loadDnaOverlayYears(years,generation,false).catch(err=>console.warn("Optional DNA overlay failed",err));
    }
  })();
  indexedLoadPromise = {key,promise:task};
  try {await task;} finally {
    if (indexedLoadPromise?.promise === task) indexedLoadPromise = null;
  }
}

async function openSharedMapFromUrl(){
  if(sharedMapHandled||!catalogSummary)return;
  const params=new URLSearchParams(location.search), id=params.get("map"), year=params.get("year");
  if(!id)return;
  sharedMapHandled=true;
  openTab("ranked");
  const select=$("indexedYear");
  if(select&&year&&/^\d{4}$/.test(year)){
    const value="year:"+year;
    if([...select.options].some(o=>o.value===value)){select.value=value;indexedLoadedKey="";await loadRankedSearch();}
  }
  let map=rankedIndex.find(m=>String(m.beatmap_id)===String(id))||findSummaryMap(id);
  if(!map){
    const q=$("indexedQuery");if(q)q.value=String(id);
    await globalRankedSearch();
    map=rankedIndex.find(m=>String(m.beatmap_id)===String(id));
  }
  if(map)showRankedDetails(map);
}
window.loadRankedSearch = loadRankedSearch;

$("importRanked")?.addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format !== "osu-skill-lab-ranked-index" || !Array.isArray(data.maps))
      throw Error("Ranked 색인 형식이 아닙니다.");
    for (const m of data.maps)
      if (m?.beatmap_id && m.source === "osu! API v2")
        indexedImported.set(String(m.beatmap_id), m);
    try {localStorage.setItem("osl-ranked-index", JSON.stringify([...indexedImported.values()]));}
    catch (_) {console.info("Optional local index exceeds browser storage");}
    indexedLoadedKey = "";
    if (catalogSummary) await loadRankedSearch();
    else {rankedIndex = mergeCachedDna([...indexedImported.values()]); renderIndexed();}
    alert("개인 색인 " + ct(data.maps.length) + "개 가져옴");
  } catch (err) {alert("가져오기 실패: " + err.message);}
  e.target.value = "";
});


function findSummaryMap(id) {
  id=String(id||"");
  const s=catalogSummary||{}, r=s.research||{}, candidates=[
    ...(s.recent||[]), ...(s.top_sr||[]), ...(s.top_bpm||[]), ...(s.top_playcount||[]),
    ...(s.extremes?.highest_sr||[]), ...(s.extremes?.highest_bpm||[]), ...(s.extremes?.longest||[]),
    ...(r.oddities||[]), ...Object.values(r.dna_rankings||{}).flat(),
    ...(r.difficulty_twins||[]).flatMap(x=>[x.a,x.b])
  ];
  return candidates.find(m=>String(m?.beatmap_id||"")===id) || null;
}
function persistReplaySignals(){
  try{localStorage.setItem("osl-replay-signals",JSON.stringify(replaySignalHistory.slice(0,200)));}catch(_){}
}
function replayHits(raw){
  const h=raw?.hits||{};
  return {
    great:Number(h.great??h["300"]??0)||0,
    good:Number(h.good??h["100"]??0)||0,
    meh:Number(h.meh??h["50"]??0)||0,
    miss:Number(h.miss??0)||0,
  };
}
function replayLocalMap(raw,hash){
  if(!raw)return null;
  const official=raw.official||{},meta=raw.meta||{},id=official.beatmap_id??official.id??raw.beatmap_id;
  const map={
    beatmap_id:id,beatmapset_id:official.beatmapset_id??official.beatmapset?.id,
    artist:meta.Artist||official.artist||official.beatmapset?.artist,
    title:meta.Title||raw.filename||official.title||official.beatmapset?.title,
    creator:meta.Creator||official.creator||official.beatmapset?.creator,
    version:meta.Version||official.version,
    official_sr:official.official_sr??official.difficulty_rating,
    bpm:raw.bpm??official.bpm,ar:official.ar,od:official.od,cs:official.cs,hp:official.hp,
    total_length:raw.duration_s??official.total_length,status:official.status,
    checksum:hash||raw.md5,
  };
  if(raw.skills)map.dna={skills:{...raw.skills}};
  return map;
}
async function resolveCatalogMapById(id,year){
  id=String(id||"");if(!id)return null;
  const known=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);
  if(known)return known;
  const shards=(catalogSummary?.search_shards||[]).filter(sh=>!year||String(sh.year)===String(year));
  for(let i=0;i<shards.length;i+=4){
    const batch=await Promise.allSettled(shards.slice(i,i+4).map(async sh=>{
      const key=sh.path+"@"+(sh.version||catalogSummary?.updated_at||"1");
      if(indexedYearCache.has(key))return indexedYearCache.get(key);
      return fetchCatalogJson(sh.path,sh.version||catalogSummary?.updated_at);
    }));
    for(const result of batch){
      if(result.status!=="fulfilled")continue;
      const map=result.value.find(m=>String(m?.beatmap_id)===id);
      if(map)return mergeCachedDna([map])[0];
    }
  }
  return null;
}
async function resolveReplayMapHash(hash,selectedLocal=null){
  hash=String(hash||"").toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(hash))return {map:null,link_type:"unresolved"};
  const locals=readLocalDnaRows(),local=selectedLocal?.md5?.toLowerCase()===hash?selectedLocal:locals.find(m=>String(m?.md5||"").toLowerCase()===hash);
  const localMap=local?replayLocalMap(local,hash):null;
  for(const candidate of [...trainingRouteMaps.values(),...favoriteMaps.values(),...recentViewedMaps]){
    if(String(candidate?.checksum||"").toLowerCase()===hash)return {map:{...candidate,checksum:hash},link_type:"saved-checksum"};
  }
  const lookup=catalogSummary?.replay_lookup;
  if(lookup?.versions&&lookup?.path_template){
    const prefix=hash.slice(0,Number(lookup.prefix_length||2)),version=lookup.versions[prefix];
    if(version){
      let rows=replayChecksumShardCache.get(prefix);
      if(!rows){
        const path=String(lookup.path_template).replace("{prefix}",prefix);
        rows=await fetchCatalogJson(path,version);
        if(Array.isArray(rows))replayChecksumShardCache.set(prefix,rows);
      }
      const hit=Array.isArray(rows)?rows.find(x=>x?.h===hash):null;
      if(hit){
        const publicMap=await resolveCatalogMapById(hit.id,hit.y);
        if(publicMap){
          publicMap.checksum=hash;
          if(localMap?.dna?.skills&&!publicMap.dna?.skills)publicMap.dna=localMap.dna;
          return {map:publicMap,link_type:local?"local+ranked-checksum":"ranked-checksum"};
        }
        return {map:{beatmap_id:hit.id,ranked_date:String(hit.y||"")+"-01-01",checksum:hash},link_type:"ranked-checksum-id"};
      }
    }
  }
  return {map:localMap,link_type:localMap?"local-md5":"unresolved"};
}
function replayRecordId(raw){
  const hits=replayHits(raw);
  return String(raw?.replay_hash||"")||[
    String(raw?.map_hash||"").toLowerCase(),String(raw?.replay_timestamp||""),
    Number(raw?.score||0),Number(raw?.combo||0),hits.great,hits.good,hits.meh,hits.miss
  ].join(":");
}
function replayCompactMap(map){
  if(!map)return null;
  const compact=compactStoredMap(map)||{};
  for(const key of ["artist","title","creator","version","bpm","total_length","checksum"])if(map[key]!=null)compact[key]=map[key];
  if(map.dna?.skills)compact.dna={skills:{...map.dna.skills}};
  return Object.keys(compact).length?compact:null;
}
async function recordReplaySignal(raw,selectedLocal=null){
  if(!raw)return;
  const hits=replayHits(raw),judged=hits.great+hits.good+hits.meh+hits.miss;
  const accuracy=raw.accuracy==null?(judged?(300*hits.great+100*hits.good+50*hits.meh)/(300*judged)*100:null):Number(raw.accuracy);
  let resolved={map:null,link_type:"unresolved"};
  try{resolved=await resolveReplayMapHash(raw.map_hash,selectedLocal);}catch(err){console.warn("Replay map link failed",err);}
  const selectedHash=String(selectedLocal?.md5||"").toLowerCase(), replayHash=String(raw.map_hash||"").toLowerCase();
  const localFallback=selectedLocal&&selectedHash===replayHash?replayLocalMap(selectedLocal,replayHash):null;
  const map=resolved.map||localFallback;
  const id=replayRecordId(raw),importedAt=new Date().toISOString(),playedAt=raw.replay_timestamp||importedAt;
  const burstStd=raw.burst_std_median!=null?Number(raw.burst_std_median):
    (Array.isArray(raw.bursts)&&raw.bursts.length?(()=>{
      const vals=raw.bursts.map(x=>Number(x?.std)).filter(Number.isFinite).sort((a,b)=>a-b);
      return vals.length?vals[Math.floor(vals.length/2)]:null;
    })():null);
  const record={
    id,imported_at:importedAt,played_at:playedAt,played_at_source:raw.replay_timestamp?"replay_timestamp":"imported_at_fallback",filename:String(raw.filename||""),
    player:String(raw.player||""),map_hash:String(raw.map_hash||"").toLowerCase(),
    replay_hash:String(raw.replay_hash||""),score:Number(raw.score||0),combo:Number(raw.combo||0),
    mods:Number(raw.mods||0),perfect:Boolean(raw.perfect),accuracy:Number.isFinite(accuracy)?Math.round(accuracy*100)/100:null,
    hits,judged,miss_rate:judged?Math.round(hits.miss/judged*10000)/100:null,
    non300_rate:judged?Math.round((hits.good+hits.meh+hits.miss)/judged*10000)/100:null,
    header_only:Boolean(raw.header_only),replay_data_analyzed:Boolean(raw.replay_data_analyzed),
    taps:raw.taps==null?null:Number(raw.taps),median_gap:raw.median_gap==null?null:Number(raw.median_gap),
    burst_count:Number(raw.burst_count??raw.bursts?.length??0),burst_std_median:Number.isFinite(burstStd)?burstStd:null,
    link_type:resolved.map?resolved.link_type:(localFallback?"selected-local-unverified":"unresolved"),
    map:replayCompactMap(map),
  };
  replaySignalHistory=[record,...replaySignalHistory.filter(x=>String(x.id)!==String(id))].slice(0,200);
  persistReplaySignals();renderReplaySignals();
  return record;
}
function replayDisplayMap(record){
  const map=record?.map;if(!map)return null;
  const id=String(map.beatmap_id||"");
  const live=id?(rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)):null;
  return live?{...map,...live}:map;
}
function replayNumeric(value){
  if(value==null||value==="")return NaN;
  const n=Number(value);return Number.isFinite(n)?n:NaN;
}
function replayMedian(values){
  const xs=values.map(replayNumeric).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const i=Math.floor(xs.length/2);return xs.length%2?xs[i]:(xs[i-1]+xs[i])/2;
}
function replayTrueTimestamp(record){
  if(record?.played_at_source==="replay_timestamp")return true;
  const played=Date.parse(record?.played_at||""),imported=Date.parse(record?.imported_at||"");
  return Number.isFinite(played)&&Number.isFinite(imported)&&Math.abs(played-imported)>5000;
}
function replayGroupKey(record){
  const map=replayDisplayMap(record),id=String(map?.beatmap_id||"");
  return id?"id:"+id:"hash:"+String(record?.map_hash||"unknown");
}
function replayGroupLabel(group){
  const map=group.map;
  if(map?.title)return (map.artist||"?")+" — "+map.title+" ["+(map.version||"?")+"]";
  const hash=String(group.records?.[0]?.map_hash||"unknown");
  return "MD5 "+hash.slice(0,10)+"…";
}
function replayGroups(){
  const groups=new Map();
  for(const record of replaySignalHistory){
    const key=replayGroupKey(record),map=replayDisplayMap(record);
    if(!groups.has(key))groups.set(key,{key,map,records:[]});
    const group=groups.get(key);group.records.push(record);if(!group.map&&map)group.map=map;
    if(map?.beatmap_id)replaySignalMaps.set(String(map.beatmap_id),map);
  }
  for(const group of groups.values())group.records.sort((a,b)=>Date.parse(a.played_at||a.imported_at||0)-Date.parse(b.played_at||b.imported_at||0));
  return [...groups.values()].sort((a,b)=>{
    const ta=Date.parse(a.records.at(-1)?.played_at||a.records.at(-1)?.imported_at||0),tb=Date.parse(b.records.at(-1)?.played_at||b.records.at(-1)?.imported_at||0);
    return tb-ta;
  });
}
function replayMetricValue(record,metric){
  if(metric==="accuracy")return replayNumeric(record?.accuracy);
  if(metric==="miss")return replayNumeric(record?.hits?.miss);
  if(metric==="non300_rate")return replayNumeric(record?.non300_rate);
  if(metric==="combo")return replayNumeric(record?.combo);
  return NaN;
}
function replayMetricName(metric){
  return ({accuracy:"정확도 %",miss:"Miss 수",non300_rate:"Non-300 비율",combo:"Max Combo"})[metric]||metric;
}
function replayModsLabel(mods){
  const value=Number(mods||0);if(!value)return "NM";
  const defs=[[1,"NF"],[2,"EZ"],[8,"HD"],[16,"HR"],[32,"SD"],[64,"DT"],[128,"RX"],[256,"HT"],[512,"NC"],[1024,"FL"],[2048,"AT"],[4096,"SO"],[8192,"AP"],[16384,"PF"]];
  const labels=[];
  for(const [bit,name] of defs)if(value&bit)labels.push(name);
  if(value&512){const i=labels.indexOf("DT");if(i>=0)labels.splice(i,1);}
  if(value&16384){const i=labels.indexOf("SD");if(i>=0)labels.splice(i,1);}
  return labels.join("")||("Mods "+value);
}
function replayAverage(records,getter){
  const values=records.map(getter).map(replayNumeric).filter(Number.isFinite);
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
}
function firstTrainingCompletionByMap(){
  const out=new Map(),sessions=[...trainingHistory];
  if(trainingRouteState.maps?.length)sessions.push(trainingRouteState);
  for(const session of sessions){
    const ids=new Set((session.done||[]).map(String));
    for(const id of ids){
      const t=Date.parse(session.done_at?.[id]||"");if(!Number.isFinite(t))continue;
      if(!out.has(id)||t<out.get(id))out.set(id,t);
    }
  }
  return out;
}
function renderReplayTrendChart(records,metric,map){
  const host=$("replayTrendChart");if(!host)return;
  const valid=records.map(r=>({r,t:Date.parse(r.played_at||r.imported_at||""),v:replayMetricValue(r,metric)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.v));
  if(valid.length<2){host.innerHTML='<div class="empty">선택 지표에 유효한 표본이 2개 이상 필요합니다.</div>';return;}
  const W=920,H=250,padX=52,padY=34,values=valid.map(x=>x.v),minRaw=Math.min(...values),maxRaw=Math.max(...values);
  let minY,maxY;
  if(metric==="accuracy"){minY=Math.max(0,Math.floor((minRaw-.5)*10)/10);maxY=Math.min(100,Math.ceil((maxRaw+.5)*10)/10);}
  else{minY=Math.min(0,minRaw);maxY=Math.max(1,maxRaw*1.12);}
  if(maxY<=minY)maxY=minY+1;
  const minT=valid[0].t,maxT=valid.at(-1).t,spanT=Math.max(1,maxT-minT);
  const point=(x,i)=>{
    const px=valid.length===1?W/2:padX+(x.t-minT)/spanT*(W-padX*2);
    const py=H-padY-(x.v-minY)/(maxY-minY)*(H-padY*2);
    return {x:px,y:py,i,...x};
  };
  const points=valid.map(point),poly=points.map(p=>p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ");
  const completion=String(map?.beatmap_id||""),completionT=firstTrainingCompletionByMap().get(completion);
  let marker="";
  if(Number.isFinite(completionT)&&completionT>=minT&&completionT<=maxT){
    const x=padX+(completionT-minT)/spanT*(W-padX*2);
    marker='<line class="replay-practice-marker" x1="'+x.toFixed(1)+'" y1="'+padY+'" x2="'+x.toFixed(1)+'" y2="'+(H-padY)+'"></line><text class="replay-marker-label" x="'+(x+5).toFixed(1)+'" y="'+(padY+12)+'">Practice 완료</text>';
  }
  const yTop=metric==="accuracy"?maxY.toFixed(1):maxY.toFixed(metric==="non300_rate"?1:0),yBottom=metric==="accuracy"?minY.toFixed(1):minY.toFixed(metric==="non300_rate"?1:0);
  host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+cx(replayMetricName(metric))+' 리플레이 추이">'+
    '<line class="replay-chart-axis" x1="'+padX+'" y1="'+padY+'" x2="'+padX+'" y2="'+(H-padY)+'"></line>'+
    '<line class="replay-chart-axis" x1="'+padX+'" y1="'+(H-padY)+'" x2="'+(W-padX)+'" y2="'+(H-padY)+'"></line>'+
    '<text class="replay-axis-label" x="8" y="'+(padY+4)+'">'+cx(yTop)+'</text><text class="replay-axis-label" x="8" y="'+(H-padY+4)+'">'+cx(yBottom)+'</text>'+
    marker+'<polyline class="replay-trend-line" points="'+poly+'"></polyline>'+
    points.map((p,i)=>'<circle class="replay-trend-point" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="5"><title>#'+(i+1)+' · '+cx(new Date(p.t).toLocaleString())+' · '+cx(p.v.toFixed(metric==="accuracy"||metric==="non300_rate"?2:0))+'</title></circle>').join("")+
    '<text class="replay-axis-label" x="'+padX+'" y="'+(H-8)+'">'+cx(new Date(minT).toLocaleDateString())+'</text><text class="replay-axis-label end" x="'+(W-padX)+'" y="'+(H-8)+'">'+cx(new Date(maxT).toLocaleDateString())+'</text></svg>';
}
function renderReplayPracticeCompare(){
  const host=$("replayPracticeCompare");if(!host)return;
  const completion=firstTrainingCompletionByMap(),groups=replayGroups(),rows=[];
  for(const group of groups){
    const id=String(group.map?.beatmap_id||""),cut=completion.get(id);if(!id||!Number.isFinite(cut))continue;
    const byMods=new Map();
    for(const r of group.records.filter(replayTrueTimestamp)){
      const t=Date.parse(r.played_at||"");if(!Number.isFinite(t))continue;
      const key=String(Number(r.mods||0));if(!byMods.has(key))byMods.set(key,[]);
      byMods.get(key).push({r,t});
    }
    for(const [mods,stamped] of byMods){
      const before=stamped.filter(x=>x.t<cut).map(x=>x.r),after=stamped.filter(x=>x.t>=cut).map(x=>x.r);
      if(!before.length||!after.length)continue;
      rows.push({group,before,after,cut,mods:Number(mods)});
    }
  }
  if(!rows.length){host.innerHTML='<div class="empty">같은 채보에서 Practice Route 완료 이전·이후의 실제 replay timestamp 표본이 각각 1개 이상 필요합니다.</div>';return;}
  const allBefore=rows.flatMap(x=>x.before),allAfter=rows.flatMap(x=>x.after);
  const ba=replayAverage(allBefore,r=>r.accuracy),aa=replayAverage(allAfter,r=>r.accuracy),bm=replayAverage(allBefore,r=>r.hits?.miss),am=replayAverage(allAfter,r=>r.hits?.miss),bn=replayAverage(allBefore,r=>r.non300_rate),an=replayAverage(allAfter,r=>r.non300_rate);
  const delta=(a,b,d=2)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a)>=0?"+":"")+(b-a).toFixed(d):"—";
  host.innerHTML='<div class="replay-before-after-kpis"><div><span>비교 가능 채보</span><b>'+rows.length+'</b><small>전/후 표본 모두 존재</small></div>'+
    '<div><span>ACC 전 → 후</span><b>'+(ba==null?"—":ba.toFixed(2))+' → '+(aa==null?"—":aa.toFixed(2))+'%</b><small>Δ '+delta(ba,aa,2)+'pp</small></div>'+
    '<div><span>Miss 전 → 후</span><b>'+(bm==null?"—":bm.toFixed(2))+' → '+(am==null?"—":am.toFixed(2))+'</b><small>Δ '+delta(bm,am,2)+'</small></div>'+
    '<div><span>Non-300 전 → 후</span><b>'+(bn==null?"—":bn.toFixed(2))+' → '+(an==null?"—":an.toFixed(2))+'%</b><small>Δ '+delta(bn,an,2)+'pp</small></div></div>'+
    '<div class="replay-before-after-list">'+rows.slice(0,8).map(x=>{
      const bacc=replayAverage(x.before,r=>r.accuracy),aacc=replayAverage(x.after,r=>r.accuracy),bmiss=replayAverage(x.before,r=>r.hits?.miss),amiss=replayAverage(x.after,r=>r.hits?.miss),id=String(x.group.map?.beatmap_id||"");
      return '<button type="button" class="replay-compare-map" data-ranked-detail="'+encodeURIComponent(id)+'"><b>'+cx(replayGroupLabel(x.group))+' · '+cx(replayModsLabel(x.mods))+'</b><small>전 '+x.before.length+' / 후 '+x.after.length+' · ACC '+(bacc==null?"—":bacc.toFixed(2))+' → '+(aacc==null?"—":aacc.toFixed(2))+'% · Miss '+(bmiss==null?"—":bmiss.toFixed(2))+' → '+(amiss==null?"—":amiss.toFixed(2))+'</small></button>';
    }).join("")+'</div><p class="hint-text">기준선은 각 채보의 첫 Practice Route 완료 시각입니다. 같은 Mods 조합 안에서만 전/후를 묶지만 플레이 컨디션·세션 선택·Mod 세부 효과 등은 통제되지 않은 단순 시간 전후 비교입니다.</p>';
}
function renderReplayRepeatedSignals(){
  const host=$("replayRepeatedSignals");if(!host)return;
  const skills=["aim","stream","speed","stamina","tech","reading","flow"],groups=new Map(),all=[];
  for(const r of replaySignalHistory){
    const map=replayDisplayMap(r),sv=map?.dna?.skills;if(!sv)continue;
    const dominant=skills.map(k=>[k,Number(sv[k])]).filter(x=>Number.isFinite(x[1])).sort((a,b)=>b[1]-a[1])[0]?.[0];if(!dominant)continue;
    if(!groups.has(dominant))groups.set(dominant,[]);
    groups.get(dominant).push(r);all.push(r);
  }
  const baseAcc=replayAverage(all,r=>r.accuracy),baseMiss=replayAverage(all,r=>r.miss_rate),baseNon=replayAverage(all,r=>r.non300_rate);
  const rows=[...groups.entries()].filter(([,rs])=>rs.length>=2).map(([skill,rs])=>{
    const sorted=[...rs].sort((a,b)=>Date.parse(a.played_at||a.imported_at||0)-Date.parse(b.played_at||b.imported_at||0)),half=Math.max(1,Math.floor(sorted.length/2));
    const older=sorted.slice(0,half),recent=sorted.slice(half);
    const acc=replayAverage(rs,r=>r.accuracy),miss=replayAverage(rs,r=>r.miss_rate),non=replayAverage(rs,r=>r.non300_rate),oldAcc=replayAverage(older,r=>r.accuracy),recentAcc=replayAverage(recent,r=>r.accuracy),modCount=new Set(rs.map(r=>Number(r.mods||0))).size;
    return {skill,rs,acc,miss,non,modCount,trend:Number.isFinite(oldAcc)&&Number.isFinite(recentAcc)?recentAcc-oldAcc:null};
  }).sort((a,b)=>b.rs.length-a.rs.length);
  if(!rows.length){host.innerHTML='<div class="empty">같은 DNA 주축에 연결된 리플레이가 2개 이상인 표본이 아직 없습니다.</div>';return;}
  const diff=(v,b,d=2)=>Number.isFinite(v)&&Number.isFinite(b)?((v-b)>=0?"+":"")+(v-b).toFixed(d):"—";
  host.innerHTML=rows.map(x=>{
    const sample=x.rs.length<4?"표본 적음":x.rs.length<8?"표본 보통":"표본 많음";
    return '<div class="replay-repeat-row"><div><span>'+x.skill.toUpperCase()+'</span><b>'+x.rs.length+'회 · '+sample+'</b><small>Mods 조합 '+x.modCount+'종</small></div><div><small>ACC</small><b>'+(x.acc==null?"—":x.acc.toFixed(2)+"%")+'</b><span>전체 DNA표본 대비 '+diff(x.acc,baseAcc,2)+'pp</span></div><div><small>Miss rate</small><b>'+(x.miss==null?"—":x.miss.toFixed(2)+"%")+'</b><span>전체 대비 '+diff(x.miss,baseMiss,2)+'pp</span></div><div><small>Non-300</small><b>'+(x.non==null?"—":x.non.toFixed(2)+"%")+'</b><span>전체 대비 '+diff(x.non,baseNon,2)+'pp</span></div><div><small>최근 절반 ACC</small><b>'+(x.trend==null?"—":(x.trend>=0?"+":"")+x.trend.toFixed(2)+"pp")+'</b><span>동일 축 내 시간순 비교</span></div></div>';
  }).join("")+'<p class="hint-text">DNA 주축은 기본 채보에서 가장 큰 자체 휴리스틱 축입니다. Mod 적용 난이도는 별도 보정하지 않으며, 결과 차이는 요구축과 성과의 인과관계나 개인 약점을 의미하지 않습니다.</p>';
}
function renderReplayTrendLab(){
  const select=$("replayTrendMap"),summary=$("replayTrendSummary"),chart=$("replayTrendChart");
  if(!select||!summary||!chart)return;
  const groups=replayGroups().filter(g=>g.records.length>=2),current=select.value;
  select.innerHTML=groups.length?groups.map(g=>'<option value="'+cx(g.key)+'">'+cx(replayGroupLabel(g))+' · '+g.records.length+'회</option>').join(""):'<option value="">2개 이상 기록된 채보 없음</option>';
  if(groups.some(g=>g.key===current))select.value=current;
  const group=groups.find(g=>g.key===select.value)||groups[0];
  if(group&&select.value!==group.key)select.value=group.key;
  if(!group){
    summary.innerHTML='<div class="empty">같은 채보 리플레이가 2개 이상 쌓이면 추이를 볼 수 있습니다.</div>';
    chart.innerHTML='<div class="empty">추이 그래프 대기 중</div>';
    renderReplayPracticeCompare();renderReplayRepeatedSignals();return;
  }
  const modsSelect=$("replayTrendMods"),previousMods=modsSelect?.value||"all",modValues=[...new Set(group.records.map(r=>Number(r.mods||0)))].sort((a,b)=>a-b);
  if(modsSelect){
    modsSelect.innerHTML='<option value="all">모든 Mods · '+group.records.length+'회</option>'+modValues.map(v=>'<option value="'+v+'">'+cx(replayModsLabel(v))+' · '+group.records.filter(r=>Number(r.mods||0)===v).length+'회</option>').join("");
    if([...modsSelect.options].some(o=>o.value===previousMods))modsSelect.value=previousMods;
  }
  const selectedMods=modsSelect?.value||"all",scopedRecords=selectedMods==="all"?group.records:group.records.filter(r=>String(Number(r.mods||0))===selectedMods);
  const metric=$("replayTrendMetric")?.value||"accuracy",windowValue=$("replayTrendWindow")?.value||"10",limit=windowValue==="all"?scopedRecords.length:Number(windowValue),records=scopedRecords.slice(-Math.max(2,limit));
  const first=records[0],last=records.at(-1),fa=Number(first.accuracy),la=Number(last.accuracy),fm=Number(first.hits?.miss),lm=Number(last.hits?.miss),fn=Number(first.non300_rate),ln=Number(last.non300_rate);
  const delta=(a,b,d=2)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a)>=0?"+":"")+(b-a).toFixed(d):"—";
  const trueTimes=records.filter(replayTrueTimestamp).length;
  summary.innerHTML='<div class="replay-trend-kpis"><div><span>표시 표본</span><b>'+records.length+'</b><small>전체 '+group.records.length+'개</small></div>'+
    '<div><span>ACC 첫 → 최근</span><b>'+(Number.isFinite(fa)?fa.toFixed(2):"—")+' → '+(Number.isFinite(la)?la.toFixed(2):"—")+'%</b><small>Δ '+delta(fa,la,2)+'pp</small></div>'+
    '<div><span>Miss 첫 → 최근</span><b>'+(Number.isFinite(fm)?fm:"—")+' → '+(Number.isFinite(lm)?lm:"—")+'</b><small>Δ '+delta(fm,lm,0)+'</small></div>'+
    '<div><span>Non-300 첫 → 최근</span><b>'+(Number.isFinite(fn)?fn.toFixed(2):"—")+' → '+(Number.isFinite(ln)?ln.toFixed(2):"—")+'%</b><small>Δ '+delta(fn,ln,2)+'pp</small></div>'+
    '<div><span>실제 replay 시각</span><b>'+trueTimes+'/'+records.length+'</b><small>나머지는 가져온 시각</small></div></div>';
  renderReplayTrendChart(records,metric,group.map);
  renderReplayPracticeCompare();renderReplayRepeatedSignals();
}
$("replayTrendMap")?.addEventListener("change",renderReplayTrendLab);
$("replayTrendMods")?.addEventListener("change",renderReplayTrendLab);
$("replayTrendMetric")?.addEventListener("change",renderReplayTrendLab);
$("replayTrendWindow")?.addEventListener("change",renderReplayTrendLab);

function renderReplaySignals(){
  const kpis=$("replaySignalKpis"),judgements=$("replayJudgementMix"),bands=$("replayAccuracyBands"),timing=$("replayTimingSignals"),dnaHost=$("replayDnaSignals"),list=$("replaySignalList"),summary=$("replaySignalSummary");
  if(!kpis||!judgements||!bands||!timing||!dnaHost||!list)return;
  replaySignalMaps.clear();
  const rows=replaySignalHistory,linked=rows.filter(r=>r.map),acc=rows.map(r=>replayNumeric(r.accuracy)).filter(Number.isFinite),avgAcc=acc.length?acc.reduce((a,b)=>a+b,0)/acc.length:null;
  for(const r of rows){const map=replayDisplayMap(r),id=String(map?.beatmap_id||"");if(id)replaySignalMaps.set(id,map);}
  const totals={great:0,good:0,meh:0,miss:0};for(const r of rows)for(const k of Object.keys(totals))totals[k]+=Number(r.hits?.[k]||0);
  kpis.innerHTML='<div class="dash-kpi"><span>저장 리플레이</span><b>'+ct(rows.length)+'</b><small>이 브라우저</small></div>'+
    '<div class="dash-kpi"><span>Ranked/로컬 연결</span><b>'+ct(linked.length)+'</b><small>checksum/MD5</small></div>'+
    '<div class="dash-kpi"><span>평균 정확도</span><b>'+(avgAcc==null?"—":avgAcc.toFixed(2)+"%")+'</b><small>'+ct(acc.length)+' 표본</small></div>'+
    '<div class="dash-kpi"><span>총 Miss</span><b>'+ct(totals.miss)+'</b><small>판정 헤더 합</small></div>';
  const judgeMax=Math.max(1,...Object.values(totals));
  judgements.innerHTML=rows.length?[["300","great"],["100","good"],["50","meh"],["Miss","miss"]].map(([label,key])=>
    '<div class="training-dist-row"><span>'+label+'</span><div><i style="width:'+(totals[key]/judgeMax*100)+'%"></i></div><b>'+ct(totals[key])+'</b></div>'
  ).join(""):'<div class="empty">리플레이 기록이 없습니다.</div>';
  const accBands={"99%+":0,"97–99%":0,"95–97%":0,"<95%":0};
  for(const a of acc){if(a>=99)accBands["99%+"]++;else if(a>=97)accBands["97–99%"]++;else if(a>=95)accBands["95–97%"]++;else accBands["<95%"]++;}
  const accMax=Math.max(1,...Object.values(accBands));
  bands.innerHTML=acc.length?Object.entries(accBands).map(([label,count])=>
    '<div class="training-dist-row"><span>'+cx(label)+'</span><div><i style="width:'+(count/accMax*100)+'%"></i></div><b>'+ct(count)+'</b></div>'
  ).join(""):'<div class="empty">정확도 표본이 없습니다.</div>';
  const detailed=rows.filter(r=>!r.header_only&&(Number.isFinite(replayNumeric(r.median_gap))||Number.isFinite(replayNumeric(r.burst_std_median))));
  const medianGap=replayMedian(detailed.map(r=>r.median_gap)),burstStd=replayMedian(detailed.map(r=>r.burst_std_median)),tapMedian=replayMedian(detailed.map(r=>r.taps));
  timing.innerHTML=detailed.length?'<b>PC 상세 '+ct(detailed.length)+'개</b><span>키 입력 중앙 간격 '+(medianGap==null?"—":medianGap.toFixed(1)+"ms")+' · burst 간격 변동 중앙값 '+(burstStd==null?"—":burstStd.toFixed(1)+"ms")+' · 입력 수 중앙값 '+(tapMedian==null?"—":ct(Math.round(tapMedian)))+'</span><p class="hint-text">입력 프레임 기반 요약이며 100/50/Miss가 발생한 정확한 시점은 아닙니다.</p>':
    '<b>상세 표본 없음</b><span>웹 단독 .osr은 판정 헤더만 읽습니다. PC 서버에서 가져온 리플레이만 키 입력 간격 프록시가 추가됩니다.</span>';
  const skillGroups=new Map(),skills=["aim","stream","speed","stamina","tech","reading","flow"];
  for(const r of rows){
    const map=replayDisplayMap(r),sv=map?.dna?.skills;if(!sv)continue;
    const dominant=skills.map(k=>[k,Number(sv[k])]).filter(x=>Number.isFinite(x[1])).sort((a,b)=>b[1]-a[1])[0]?.[0];if(!dominant)continue;
    if(!skillGroups.has(dominant))skillGroups.set(dominant,[]);
    skillGroups.get(dominant).push(r);
  }
  dnaHost.innerHTML=skillGroups.size?[...skillGroups.entries()].sort((a,b)=>b[1].length-a[1].length).map(([skill,group])=>{
    const ga=group.map(r=>Number(r.accuracy)).filter(Number.isFinite),gm=group.map(r=>Number(r.hits?.miss||0));
    const a=ga.length?ga.reduce((x,y)=>x+y,0)/ga.length:null,m=gm.length?gm.reduce((x,y)=>x+y,0)/gm.length:0;
    return '<div class="replay-dna-row"><span>'+skill.toUpperCase()+'</span><b>'+group.length+'회</b><small>평균 ACC '+(a==null?"—":a.toFixed(2)+"%")+' · 평균 Miss '+m.toFixed(2)+'</small></div>';
  }).join(""):'<div class="empty">DNA가 연결된 리플레이가 없습니다.</div>';
  if(summary)summary.textContent=rows.length?ct(rows.length)+"개 · 연결 "+ct(linked.length)+"개 · PC 상세 "+ct(detailed.length)+"개":"기록 없음";
  list.innerHTML=rows.length?rows.slice(0,30).map(r=>{
    const map=replayDisplayMap(r),id=String(map?.beatmap_id||"");if(id)replaySignalMaps.set(id,map);
    const title=map?.title?cx(map.artist||"?")+' — '+cx(map.title):"MD5 "+cx(String(r.map_hash||"미상").slice(0,10))+"…";
    const when=new Date(r.played_at||r.imported_at||Date.now()),routeMatch=id&&trainingRouteMaps.has(id);
    return '<div class="replay-signal-row"><div><span>'+cx(when.toLocaleString())+' · '+(r.header_only?"헤더":"PC 상세")+' · '+cx(r.link_type||"unresolved")+'</span><b>'+title+'</b><small>ACC '+(r.accuracy==null?"—":Number(r.accuracy).toFixed(2)+"%")+' · Miss '+ct(r.hits?.miss||0)+' · Combo '+ct(r.combo||0)+(r.player?' · '+cx(r.player):'')+'</small></div><div class="replay-signal-actions">'+
      (id?'<button type="button" class="ghost-btn" data-ranked-detail="'+encodeURIComponent(id)+'">채보 상세</button>':'')+
      (routeMatch?'<button type="button" class="ghost-btn" data-replay-route-complete="'+encodeURIComponent(id)+'">현재 세션 완료 반영</button>':'')+
      '<button type="button" class="ghost-btn" data-replay-signal-remove="'+encodeURIComponent(String(r.id))+'">삭제</button></div></div>';
  }).join(""):'<div class="empty">Replay Lab에서 .osr을 가져오면 자동 기록됩니다.</div>';
  renderReplayTrendLab();
}
async function relinkReplaySignals(silent=false){
  if(!replaySignalHistory.length)return 0;
  const button=$("retryReplayLinks");if(button)button.disabled=true;
  let changed=0;
  try{
    for(let i=0;i<replaySignalHistory.length;i++){
      const r=replaySignalHistory[i];if(r.map?.beatmap_id&&r.link_type!=="ranked-checksum-id")continue;
      try{
        const resolved=await resolveReplayMapHash(r.map_hash,null);
        if(resolved.map){
          r.map=replayCompactMap(resolved.map);r.link_type=resolved.link_type;changed++;
        }
      }catch(err){console.warn("Replay relink failed",err);}
    }
    if(changed)persistReplaySignals();renderReplaySignals();
    if(!silent)alert(changed?"리플레이 "+changed+"개 맵 연결을 갱신했습니다.":"새로 연결된 리플레이가 없습니다.");
    return changed;
  }finally{if(button)button.disabled=false;}
}
$("retryReplayLinks")?.addEventListener("click",relinkReplaySignals);
$("importReplaySignals")?.addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data?.format!=="osu-skill-lab-replay-signals"||!Array.isArray(data.replays))throw Error("지원하지 않는 Replay Signals 파일");
    const clean=data.replays.slice(0,400).map((r,i)=>{
      const hits=replayHits(r),judged=hits.great+hits.good+hits.meh+hits.miss,map=replayCompactMap(r.map);
      const accuracy=replayNumeric(r.accuracy),missRate=replayNumeric(r.miss_rate),non300=replayNumeric(r.non300_rate);
      return {
        id:String(r.id||("import-replay-"+Date.now()+"-"+i)).slice(0,180),imported_at:r.imported_at||new Date().toISOString(),played_at:r.played_at||r.imported_at||new Date().toISOString(),
        played_at_source:(r.played_at_source==="replay_timestamp"||(r.played_at&&r.imported_at&&Math.abs(Date.parse(r.played_at)-Date.parse(r.imported_at))>5000))?"replay_timestamp":"imported_at_fallback",
        filename:String(r.filename||"").slice(0,180),player:String(r.player||"").slice(0,120),map_hash:String(r.map_hash||"").toLowerCase().slice(0,32),
        replay_hash:String(r.replay_hash||"").slice(0,80),score:Number(r.score||0),combo:Number(r.combo||0),mods:Number(r.mods||0),perfect:Boolean(r.perfect),
        accuracy:Number.isFinite(accuracy)?accuracy:null,hits,judged:judged||Number(r.judged||0),
        miss_rate:Number.isFinite(missRate)?missRate:(judged?hits.miss/judged*100:null),
        non300_rate:Number.isFinite(non300)?non300:(judged?(hits.good+hits.meh+hits.miss)/judged*100:null),
        header_only:r.header_only!==false,replay_data_analyzed:Boolean(r.replay_data_analyzed),
        taps:r.taps==null?null:Number(r.taps),median_gap:r.median_gap==null?null:Number(r.median_gap),
        burst_count:Number(r.burst_count||0),burst_std_median:r.burst_std_median==null?null:Number(r.burst_std_median),
        link_type:String(r.link_type||"imported"),map
      };
    }).filter(r=>r.id);
    const merged=new Map(replaySignalHistory.map(r=>[String(r.id),r]));for(const r of clean)merged.set(String(r.id),r);
    replaySignalHistory=[...merged.values()].sort((a,b)=>Date.parse(b.played_at||b.imported_at||0)-Date.parse(a.played_at||a.imported_at||0)).slice(0,200);
    persistReplaySignals();renderReplaySignals();await relinkReplaySignals(true);alert("Replay Signals "+clean.length+"개를 가져왔습니다.");
  }catch(err){alert("Replay Signals 가져오기 실패: "+err.message);}
  event.target.value="";
});
$("exportReplaySignals")?.addEventListener("click",()=>{
  const payload={format:"osu-skill-lab-replay-signals",version:2,exported_at:new Date().toISOString(),note:"Judgement outcomes, timestamp provenance, and optional PC key-timing proxies; no exact miss-location or causal training claims.",replays:replaySignalHistory};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="osu-skill-lab-replay-signals-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$("clearReplaySignals")?.addEventListener("click",()=>{
  if(!replaySignalHistory.length)return;
  if(!confirm("이 브라우저의 Replay Failure Signals 기록을 모두 지울까요?"))return;
  replaySignalHistory=[];persistReplaySignals();renderReplaySignals();
});
document.addEventListener("click",event=>{
  const remove=event.target.closest("[data-replay-signal-remove]");
  if(remove){
    const id=decodeURIComponent(remove.dataset.replaySignalRemove||"");
    replaySignalHistory=replaySignalHistory.filter(x=>String(x.id)!==id);persistReplaySignals();renderReplaySignals();return;
  }
  const complete=event.target.closest("[data-replay-route-complete]");
  if(complete){
    const id=decodeURIComponent(complete.dataset.replayRouteComplete||"");
    if(!trainingRouteMaps.has(id))return;
    const done=new Set((trainingRouteState.done||[]).map(String)),times={...(trainingRouteState.done_at||{})};
    done.add(id);if(!times[id])times[id]=new Date().toISOString();
    trainingRouteState.done=[...done];trainingRouteState.done_at=times;persistTrainingRoute();renderTrainingRoute();renderTrainingJournal();
  }
});
window.OSLReplayBridge={record:recordReplaySignal,relink:relinkReplaySignals};
renderReplaySignals();

function trainingRouteSkill(){
  const selected=$("trainingRouteSkill")?.value||"auto";
  if(selected!=="auto")return {skill:selected,auto:false};
  const rows=readLocalDnaRows().filter(m=>m?.skills);
  const keys=["aim","stream","speed","stamina","tech","reading","flow"];
  if(!rows.length)return {skill:"overall",auto:true};
  const avg=Object.fromEntries(keys.map(k=>[k,rows.reduce((n,m)=>n+Number(m.skills?.[k]||0),0)/rows.length]));
  const skill=keys.sort((a,b)=>avg[a]-avg[b])[0]||"overall";
  return {skill,auto:true,exposure:avg[skill]};
}
function persistTrainingRoute(){
  try{localStorage.setItem("osl-training-route",JSON.stringify(trainingRouteState));}catch(_){}
}
function persistTrainingHistory(){
  try{localStorage.setItem("osl-training-history",JSON.stringify(trainingHistory.slice(0,80)));}catch(_){}
}
function trainingRouteEmptyState(){
  return {skill:null,requested_band:null,band:null,mode:null,scope:null,maps:[],done:[],done_at:{},feel:"",note:"",created_at:null};
}
function trainingSessionFeelLabel(value){
  return ({easy:"여유",good:"적당",hard:"도전적",too_hard:"너무 어려움"})[value]||"미기록";
}
function trainingSessionStatus(session){
  const total=session?.maps?.length||0,done=(session?.done||[]).length;
  return done>=total&&total?"완료":done?"부분 완료":"미완료";
}
function trainingSessionEvents(includeActive=true){
  const sessions=[...trainingHistory];
  if(includeActive&&trainingRouteState.maps?.length&&trainingRouteState.done?.length){
    sessions.unshift({...trainingRouteState,id:"active",ended_at:null,status:"active"});
  }
  const out=[];
  for(const session of sessions){
    const done=new Set((session.done||[]).map(String)),byId=new Map((session.maps||[]).map(m=>[String(m.beatmap_id),m]));
    for(const id of done){
      const map=byId.get(id);if(!map)continue;
      const ts=session.done_at?.[id]||session.ended_at||session.created_at;
      const time=Date.parse(ts||"");
      if(!Number.isFinite(time))continue;
      out.push({time,map,skill:session.skill||"overall",session_id:session.id||"",active:session.id==="active"});
    }
  }
  return out;
}
function renderTrainingJournal(){
  const kpis=$("trainingJournalKpis"),activity=$("trainingActivity14"),exposure=$("trainingExposure28"),list=$("trainingJournalList"),summary=$("trainingJournalSummary");
  if(!kpis||!activity||!exposure||!list)return;
  const now=Date.now(),day=86400000,events=trainingSessionEvents(true),last7=events.filter(e=>e.time>=now-day*7),last28=events.filter(e=>e.time>=now-day*28);
  const activeDays=new Set(last28.map(e=>{const d=new Date(e.time);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")})).size;
  const minutes=Math.round(last7.reduce((n,e)=>n+Number(e.map.total_length||0),0)/60);
  kpis.innerHTML='<div class="dash-kpi"><span>최근 7일 완료</span><b>'+ct(last7.length)+'</b><small>채보</small></div>'+
    '<div class="dash-kpi"><span>활동일</span><b>'+ct(activeDays)+'</b><small>최근 28일</small></div>'+
    '<div class="dash-kpi"><span>기록 세션</span><b>'+ct(trainingHistory.length)+'</b><small>이 브라우저</small></div>'+
    '<div class="dash-kpi"><span>채보 길이 합</span><b>'+ct(minutes)+'m</b><small>최근 7일 완료분</small></div>';

  const days=[];let maxCount=1;
  for(let i=13;i>=0;i--){
    const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-i);
    const end=start.getTime()+day,count=events.filter(e=>e.time>=start.getTime()&&e.time<end).length;
    maxCount=Math.max(maxCount,count);days.push({start,count});
  }
  activity.innerHTML=days.map(x=>'<div class="activity-day" title="'+cx(x.start.toLocaleDateString())+' · '+x.count+'개"><i style="height:'+Math.max(x.count?8:2,x.count/maxCount*56)+'px"></i><b>'+x.count+'</b><small>'+String(x.start.getMonth()+1)+'/'+String(x.start.getDate())+'</small></div>').join("");

  const skills=["aim","stream","speed","stamina","tech","reading","flow"],avgs={};
  for(const skill of skills){
    const vals=last28.map(e=>Number(e.map?.dna?.skills?.[skill])).filter(Number.isFinite);
    avgs[skill]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }
  const anySkill=Object.values(avgs).some(Number.isFinite);
  exposure.innerHTML=anySkill?skills.map(skill=>{
    const v=avgs[skill];return '<div class="skill"><span>'+skill.toUpperCase()+'</span><div class="bar"><i style="width:'+(Number.isFinite(v)?Math.max(2,Math.min(100,v)):0)+'%"></i></div><b>'+(Number.isFinite(v)?v.toFixed(1):"—")+'</b></div>';
  }).join(""):'<div class="empty">최근 28일 완료 기록에 Chart DNA가 없습니다.</div>';

  if(summary)summary.textContent=trainingHistory.length?trainingHistory.length+"세션 · 완료 처리 "+events.filter(e=>!e.active).length+"채보":"기록 없음";
  list.innerHTML=trainingHistory.length?trainingHistory.slice(0,20).map(session=>{
    const total=session.maps?.length||0,done=session.done?.length||0,date=new Date(session.ended_at||session.created_at||Date.now());
    const id=encodeURIComponent(String(session.id||""));
    return '<div class="training-journal-row"><div><span>'+cx(date.toLocaleDateString())+' · '+cx(trainingSessionStatus(session))+'</span><b>'+cx(String(session.skill||"overall").toUpperCase())+' · '+cx(session.band||"all")+' · '+cx(session.mode||"—")+'</b><small>'+done+'/'+total+' 완료 · 체감 '+cx(trainingSessionFeelLabel(session.feel))+(session.note?' · '+cx(session.note):'')+'</small></div><div class="training-journal-actions"><button type="button" class="ghost-btn" data-training-history-replay="'+id+'">조건 다시 사용</button><button type="button" class="ghost-btn" data-training-history-remove="'+id+'">삭제</button></div></div>';
  }).join(""):'<div class="empty">종료한 세션 기록이 없습니다.</div>';
  renderTrainingInsights();
  renderReplayTrendLab();
}
function trainingPeriodMetrics(days,offset=0){
  const now=Date.now(),span=Math.max(1,Number(days)||28)*86400000,end=now-span*offset,start=end-span;
  const events=trainingSessionEvents(true).filter(e=>e.time>=start&&e.time<end);
  const sessions=trainingHistory.filter(session=>{
    const t=Date.parse(session.ended_at||session.created_at||"");return Number.isFinite(t)&&t>=start&&t<end;
  });
  const localDayKey=time=>{const d=new Date(time);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
  const activeDays=new Set(events.map(e=>localDayKey(e.time))).size;
  const minutes=Math.round(events.reduce((n,e)=>n+Number(e.map?.total_length||0),0)/60);
  const srValues=events.map(e=>Number(e.map?.official_sr)).filter(Number.isFinite);
  const avgSr=srValues.length?srValues.reduce((a,b)=>a+b,0)/srValues.length:null;
  const skills=["aim","stream","speed","stamina","tech","reading","flow"],exposure={};
  for(const skill of skills){
    const values=events.map(e=>Number(e.map?.dna?.skills?.[skill])).filter(Number.isFinite);
    exposure[skill]=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  }
  const srBands={"<3":0,"3–4":0,"4–5":0,"5–6":0,"6–7":0,"7–8":0,"8+":0};
  for(const e of events){
    const sr=Number(e.map?.official_sr);if(!Number.isFinite(sr))continue;
    if(sr<3)srBands["<3"]++;else if(sr<4)srBands["3–4"]++;else if(sr<5)srBands["4–5"]++;else if(sr<6)srBands["5–6"]++;else if(sr<7)srBands["6–7"]++;else if(sr<8)srBands["7–8"]++;else srBands["8+"]++;
  }
  const targets={},feels={};
  for(const session of sessions){
    const skill=String(session.skill||"overall").toUpperCase();targets[skill]=(targets[skill]||0)+1;
    if(session.feel){const label=trainingSessionFeelLabel(session.feel);feels[label]=(feels[label]||0)+1;}
  }
  return {days,start,end,events,sessions,activeDays,minutes,avgSr,exposure,srBands,targets,feels};
}
function trainingMetricDelta(current,previous,digits=0,suffix=""){
  if(current==null||!Number.isFinite(Number(current)))return "데이터 없음";
  if(previous==null||!Number.isFinite(Number(previous)))return "이전 기간 기록 없음";
  const diff=Number(current)-Number(previous),sign=diff>0?"+":"";
  return sign+diff.toFixed(digits)+suffix+" vs 이전";
}
function renderTrainingInsights(){
  const kpis=$("trainingInsightsKpis"),exposureHost=$("trainingExposureCompare"),bandsHost=$("trainingSrBands"),targetHost=$("trainingTargetMix"),feelHost=$("trainingFeelMix"),summary=$("trainingInsightsSummary");
  if(!kpis||!exposureHost||!bandsHost||!targetHost||!feelHost||!summary)return;
  const days=Number($("trainingInsightsPeriod")?.value||28),current=trainingPeriodMetrics(days,0),previous=trainingPeriodMetrics(days,1);
  kpis.innerHTML=
    '<div class="dash-kpi"><span>완료 채보</span><b>'+ct(current.events.length)+'</b><small>'+cx(trainingMetricDelta(current.events.length,previous.events.length,0,""))+'</small></div>'+
    '<div class="dash-kpi"><span>활동일</span><b>'+ct(current.activeDays)+'</b><small>'+cx(trainingMetricDelta(current.activeDays,previous.activeDays,0,"일"))+'</small></div>'+
    '<div class="dash-kpi"><span>기록 세션</span><b>'+ct(current.sessions.length)+'</b><small>'+cx(trainingMetricDelta(current.sessions.length,previous.sessions.length,0,""))+'</small></div>'+
    '<div class="dash-kpi"><span>평균 공식 SR</span><b>'+(current.avgSr==null?"—":"★"+current.avgSr.toFixed(2))+'</b><small>'+(current.avgSr==null?"완료 처리 채보 없음":cx(trainingMetricDelta(current.avgSr,previous.avgSr,2,"★")))+'</small></div>';

  const skills=["aim","stream","speed","stamina","tech","reading","flow"];
  const hasExposure=skills.some(k=>Number.isFinite(current.exposure[k]));
  exposureHost.innerHTML=hasExposure?skills.map(skill=>{
    const now=current.exposure[skill],prev=previous.exposure[skill],delta=Number.isFinite(now)&&Number.isFinite(prev)?now-prev:null;
    return '<div class="exposure-compare-row"><span>'+skill.toUpperCase()+'</span><div class="exposure-compare-bars"><i class="now" style="width:'+(Number.isFinite(now)?Math.max(1,Math.min(100,now)):0)+'%"></i><i class="prev" style="width:'+(Number.isFinite(prev)?Math.max(1,Math.min(100,prev)):0)+'%"></i></div><b>'+(Number.isFinite(now)?now.toFixed(1):"—")+'</b><small>'+(delta==null?"이전 없음":(delta>=0?"+":"")+delta.toFixed(1))+'</small></div>';
  }).join(""):'<div class="empty">현재 기간 완료 기록에 Chart DNA가 없습니다.</div>';

  const maxBand=Math.max(1,...Object.values(current.srBands));
  bandsHost.innerHTML=current.events.length?Object.entries(current.srBands).map(([label,count])=>
    '<div class="training-dist-row"><span>'+cx(label)+'★</span><div><i style="width:'+(count/maxBand*100)+'%"></i></div><b>'+ct(count)+'</b></div>'
  ).join(""):'<div class="empty">완료 기록이 없습니다.</div>';

  const targetEntries=Object.entries(current.targets).sort((a,b)=>b[1]-a[1]),maxTarget=Math.max(1,...targetEntries.map(x=>x[1]));
  targetHost.innerHTML=targetEntries.length?targetEntries.map(([label,count])=>
    '<div class="training-dist-row"><span>'+cx(label)+'</span><div><i style="width:'+(count/maxTarget*100)+'%"></i></div><b>'+ct(count)+'</b></div>'
  ).join(""):'<div class="empty">현재 기간에 종료된 세션이 없습니다.</div>';

  const feelEntries=Object.entries(current.feels).sort((a,b)=>b[1]-a[1]),maxFeel=Math.max(1,...feelEntries.map(x=>x[1]));
  feelHost.innerHTML=feelEntries.length?feelEntries.map(([label,count])=>
    '<div class="training-dist-row"><span>'+cx(label)+'</span><div><i style="width:'+(count/maxFeel*100)+'%"></i></div><b>'+ct(count)+'</b></div>'
  ).join(""):'<div class="empty">현재 기간 체감 기록이 없습니다.</div>';

  if(!current.events.length&&!current.sessions.length){
    summary.innerHTML='<div class="empty">'+days+'일 기간에 비교할 훈련 기록이 없습니다.</div>';return;
  }
  const exposurePairs=skills.map(k=>[k,current.exposure[k]]).filter(x=>Number.isFinite(x[1])).sort((a,b)=>b[1]-a[1]);
  const topExposure=exposurePairs[0],lowExposure=exposurePairs.at(-1),dominant=targetEntries[0];
  const completionDelta=current.events.length-previous.events.length,minuteDelta=current.minutes-previous.minutes;
  summary.innerHTML='<div class="training-insight-callouts">'+
    '<div><span>노출량 변화</span><b>'+(completionDelta>=0?"+":"")+completionDelta+'채보</b><small>이전 '+days+'일 대비 · 실력 변화 의미 아님</small></div>'+
    '<div><span>채보 길이 합 변화</span><b>'+(minuteDelta>=0?"+":"")+minuteDelta+'m</b><small>완료 처리 채보 길이의 합</small></div>'+
    (topExposure?'<div><span>높은 DNA 요구 노출</span><b>'+topExposure[0].toUpperCase()+' '+topExposure[1].toFixed(1)+'</b><small>'+(lowExposure?'낮은 쪽 '+lowExposure[0].toUpperCase()+' '+lowExposure[1].toFixed(1):'')+'</small></div>':'')+
    (dominant?'<div><span>가장 자주 고른 목표</span><b>'+cx(dominant[0])+'</b><small>'+dominant[1]+'세션 · 선택 빈도</small></div>':'')+
    '</div><p class="hint-text">모든 변화값은 사용자가 완료 처리한 Practice Route 기록의 구성 차이입니다. 플레이 성과·실력 향상·실제 연습 시간을 추정하지 않습니다.</p>';
}
function trainingInsightsReportText(){
  const days=Number($("trainingInsightsPeriod")?.value||28),current=trainingPeriodMetrics(days,0),previous=trainingPeriodMetrics(days,1),skills=["aim","stream","speed","stamina","tech","reading","flow"];
  const exp=skills.filter(k=>Number.isFinite(current.exposure[k])).map(k=>k.toUpperCase()+" "+current.exposure[k].toFixed(1)).join(", ")||"없음";
  const target=Object.entries(current.targets).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" "+v+"회").join(", ")||"없음";
  return [
    "osu! Skill Lab Training Insights · 최근 "+days+"일",
    "완료 채보: "+current.events.length+" (이전 "+previous.events.length+")",
    "활동일: "+current.activeDays+"일 (이전 "+previous.activeDays+"일)",
    "기록 세션: "+current.sessions.length+" (이전 "+previous.sessions.length+")",
    "완료 채보 길이 합: "+current.minutes+"분 (이전 "+previous.minutes+"분)",
    "평균 공식 SR: "+(current.avgSr==null?"—":"★"+current.avgSr.toFixed(2))+(previous.avgSr==null?"":" (이전 ★"+previous.avgSr.toFixed(2)+")"),
    "DNA 요구 노출 평균: "+exp,
    "세션 목표 구성: "+target,
    "",
    "※ 완료 처리한 Practice Route 기록의 노출 구성 요약이며 실력/성과 추정이 아닙니다."
  ].join("\n");
}
$("trainingInsightsPeriod")?.addEventListener("change",renderTrainingInsights);
$("copyTrainingInsights")?.addEventListener("click",async()=>{
  const report=trainingInsightsReportText();
  try{await navigator.clipboard.writeText(report);alert("기간 훈련 리포트를 복사했습니다.");}
  catch(_){prompt("훈련 리포트를 복사하세요.",report);}
});

function archiveTrainingRoute(reason="finished",clear=true){
  if(!trainingRouteState.maps?.length)return false;
  const feel=$("trainingSessionFeel")?.value||trainingRouteState.feel||"",note=($("trainingSessionNote")?.value||trainingRouteState.note||"").trim().slice(0,120);
  const session={...trainingRouteState,id:"session-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),maps:trainingRouteState.maps.map(compactStoredMap),done:[...(trainingRouteState.done||[])],done_at:{...(trainingRouteState.done_at||{})},feel,note,ended_at:new Date().toISOString(),reason};
  trainingHistory=[session,...trainingHistory].slice(0,80);persistTrainingHistory();
  if(clear){trainingRouteGeneration++;trainingRouteState=trainingRouteEmptyState();persistTrainingRoute();renderTrainingRoute();}
  renderTrainingJournal();return true;
}
function suggestTrainingBand(skill){
  const bands=["3-4","4-5","5-6","6-7","7-8","8-99"];
  const session=trainingHistory.find(x=>bands.includes(String(x.band))&&String(x.skill||"overall")===String(skill))||
    trainingHistory.find(x=>bands.includes(String(x.band)));
  if(!session)return "5-6";
  let index=Math.max(0,bands.indexOf(String(session.band)));
  const ratio=(session.maps?.length?Number(session.done?.length||0)/session.maps.length:0);
  if(session.feel==="easy"&&ratio>=.75)index=Math.min(bands.length-1,index+1);
  if(session.feel==="too_hard"||(session.feel==="hard"&&ratio<.5))index=Math.max(0,index-1);
  return bands[index];
}
function trainingBandBounds(band){
  if(!band||band==="all")return [0,99];
  const [lo,hi]=band.split("-").map(Number);return [Number.isFinite(lo)?lo:0,Number.isFinite(hi)?hi:99];
}
function trainingRouteScore(map,skill,band,mode){
  const v=Number(map?.dna?.skills?.[skill]??map?.dna_focus??0);
  const overall=Number(map?.dna?.skills?.overall||0);
  const sr=Number(map?.official_sr||0),[lo,hi]=trainingBandBounds(band),mid=band==="all"?sr:(lo+Math.min(hi,12))/2;
  const closeness=band==="all"?0:Math.max(0,1-Math.abs(sr-mid)/Math.max(.5,(hi-lo)/2));
  if(mode==="focus")return v*1.15+overall*.08+closeness*8;
  if(mode==="balanced")return v*.72+overall*.26+closeness*10;
  return v*.62+overall*.18+closeness*18;
}
function diversifyTrainingRows(rows,count,mode){
  const picked=[],sets=new Set(),mapperCount=new Map();
  for(const item of rows){
    const m=item.map,sid=String(m.beatmapset_id||""),mapper=String(m.creator||"Unknown");
    if(sid&&sets.has(sid))continue;
    if((mapperCount.get(mapper)||0)>=2)continue;
    picked.push(item);if(sid)sets.add(sid);mapperCount.set(mapper,(mapperCount.get(mapper)||0)+1);
    if(picked.length>=count)break;
  }
  if(mode==="ramp")picked.sort((a,b)=>Number(a.map.official_sr||0)-Number(b.map.official_sr||0)||a.score-b.score);
  else if(mode==="balanced")picked.sort((a,b)=>Number(a.map.official_sr||0)-Number(b.map.official_sr||0));
  return picked;
}
async function loadTrainingPools(){
  if(trainingPoolCache)return trainingPoolCache;
  const d=catalogSummary?.training_pool;
  if(!d?.path)throw Error("훈련 후보 풀이 아직 배포되지 않았습니다.");
  const data=await fetchCatalogJson(d.path,d.version||catalogSummary.updated_at);
  if(data?.format!=="osu-skill-lab-training-pools"||!data.pools)throw Error("훈련 후보 풀 형식 오류");
  trainingPoolCache=data;return data;
}
function renderTrainingRoute(){
  const host=$("trainingRouteList"),status=$("trainingRouteStatus"),text=$("trainingRouteProgressText"),bar=$("trainingRouteProgressBar");
  if(!host)return;
  trainingRouteMaps.clear();
  for(const m of trainingRouteState.maps||[])if(m?.beatmap_id)trainingRouteMaps.set(String(m.beatmap_id),m);
  const done=new Set((trainingRouteState.done||[]).map(String)),total=trainingRouteState.maps?.length||0,completed=[...done].filter(id=>trainingRouteMaps.has(id)).length;
  if(text)text.textContent=completed+" / "+total;
  if(bar)bar.style.width=(total?completed/total*100:0)+"%";
  const feel=$("trainingSessionFeel"),note=$("trainingSessionNote");
  if(feel&&feel.value!==String(trainingRouteState.feel||""))feel.value=trainingRouteState.feel||"";
  if(note&&note.value!==String(trainingRouteState.note||""))note.value=trainingRouteState.note||"";
  if(!total){
    host.innerHTML='<div class="empty">아직 만든 연습 세션이 없습니다.</div>';
    if(status)status.textContent="현재 Ranked 결과 또는 분석 완료 DNA 전체에서 후보를 만들 수 있습니다.";
    if(feel)feel.value="";if(note)note.value="";
    return;
  }
  const skill=(trainingRouteState.skill||"overall").toUpperCase();
  host.innerHTML=trainingRouteState.maps.map((m,i)=>{
    const id=String(m.beatmap_id),isDone=done.has(id),focus=Number(m.dna?.skills?.[trainingRouteState.skill]||m.dna?.skills?.overall||0);
    return '<div class="training-route-row '+(isDone?"done":"")+'"><b class="training-route-order">'+(i+1)+'</b><div class="training-route-copy"><button type="button" data-ranked-detail="'+encodeURIComponent(id)+'"><strong>'+cx(m.artist||"?")+' — '+cx(m.title||"?")+' ['+cx(m.version||"?")+']</strong></button><small>'+cx(m.creator||"?")+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM · '+skill+' '+focus.toFixed(1)+'</small></div><div class="training-route-actions"><button type="button" class="ghost-btn" data-training-toggle="'+encodeURIComponent(id)+'">'+(isDone?"완료 취소":"연습 완료")+'</button><button type="button" class="ghost-btn" data-similarity-seed="'+encodeURIComponent(id)+'">유사 채보</button><button type="button" class="ghost-btn" data-compare-map="'+encodeURIComponent(id)+'">비교 +</button><button type="button" class="ghost-btn favorite-toggle '+(favoriteMaps.has(id)?"active":"")+'" data-favorite-map="'+encodeURIComponent(id)+'">'+(favoriteMaps.has(id)?"★":"☆")+'</button></div></div>';
  }).join("");
  if(status){const bandText=trainingRouteState.requested_band==="adaptive"?"기록 기반 → "+trainingRouteState.band:trainingRouteState.band;status.textContent=(trainingRouteState.auto_skill?"자동 낮은 노출 영역 → ":"")+"목표 "+skill+" · "+bandText+" · "+trainingRouteState.mode+" · "+trainingRouteState.scope+" · Chart DNA 분석 완료 채보만 사용";}
}
async function buildTrainingRoute(){
  if(!catalogSummary){alert("Ranked DB 준비 후 다시 시도해 주세요.");return;}
  if(trainingRouteState.maps?.length&&trainingRouteState.done?.length){
    if(!confirm("진행 중인 세션에 완료 기록이 있습니다. 현재 세션을 기록하고 새 세션을 만들까요?"))return;
    archiveTrainingRoute("replaced",true);
  }
  const token=++trainingRouteGeneration,skillInfo=trainingRouteSkill(),skill=skillInfo.skill,requestedBand=$("trainingRouteStars")?.value||"5-6",band=requestedBand==="adaptive"?suggestTrainingBand(skill):requestedBand,mode=$("trainingRouteMode")?.value||"ramp",scope=$("trainingRouteScope")?.value||"loaded",count=Number($("trainingRouteCount")?.value||8),status=$("trainingRouteStatus"),button=$("buildTrainingRoute");
  if(button)button.disabled=true;if(status)status.textContent="훈련 후보 계산 중…";
  try{
    let source=[];
    if(scope==="global"){
      const pools=await loadTrainingPools();if(token!==trainingRouteGeneration)return;
      source=(pools.pools?.[skill]?.[band]||pools.pools?.[skill]?.all||[]).map(m=>({...m}));
    }else{
      const [lo,hi]=trainingBandBounds(band);
      source=lastFilteredRows.filter(m=>m?.dna?.skills&&(band==="all"||(Number(m.official_sr||0)>=lo&&Number(m.official_sr||0)<hi)));
      if(source.length<count&&status)status.textContent="현재 결과의 DNA 후보가 적습니다 · 전체 DNA 분석분 범위를 쓰면 더 많은 후보를 찾을 수 있습니다.";
    }
    const ranked=source.map(map=>({map,score:trainingRouteScore(map,skill,band,mode)})).sort((a,b)=>b.score-a.score);
    const picked=diversifyTrainingRows(ranked,count,mode).map(x=>x.map);
    if(!picked.length)throw Error("조건에 맞는 Chart DNA 분석 채보가 없습니다.");
    trainingRouteState={skill,auto_skill:skillInfo.auto,requested_band:requestedBand,band,mode,scope,maps:picked,done:[],done_at:{},feel:"",note:"",created_at:new Date().toISOString()};
    persistTrainingRoute();renderTrainingRoute();
  }catch(err){if(status)status.textContent="세션 생성 실패 · "+err.message;}
  finally{if(token===trainingRouteGeneration&&button)button.disabled=false;}
}
$("buildTrainingRoute")?.addEventListener("click",buildTrainingRoute);
$("clearTrainingRoute")?.addEventListener("click",()=>{
  if(trainingRouteState.done?.length&&!confirm("완료 처리한 기록이 있습니다. 기록하지 않고 현재 세션을 비울까요?"))return;
  trainingRouteGeneration++;trainingRouteState=trainingRouteEmptyState();persistTrainingRoute();renderTrainingRoute();renderTrainingJournal();
});
$("finishTrainingRoute")?.addEventListener("click",()=>{if(!trainingRouteState.maps?.length){alert("기록할 현재 세션이 없습니다.");return;}archiveTrainingRoute("finished",true);});
$("trainingSessionFeel")?.addEventListener("change",e=>{trainingRouteState.feel=e.target.value||"";persistTrainingRoute();});
$("trainingSessionNote")?.addEventListener("input",e=>{trainingRouteState.note=String(e.target.value||"").slice(0,120);persistTrainingRoute();});
$("importTrainingJournal")?.addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data?.format!=="osu-skill-lab-training-journal"||!Array.isArray(data.sessions))throw Error("지원하지 않는 훈련 기록 파일");
    const clean=data.sessions.slice(0,120).map((session,i)=>({
      id:String(session.id||("import-"+Date.now()+"-"+i)),
      skill:String(session.skill||"overall"),auto_skill:Boolean(session.auto_skill),requested_band:session.requested_band?String(session.requested_band):undefined,
      band:String(session.band||"all"),mode:String(session.mode||"ramp"),scope:String(session.scope||"global"),
      maps:Array.isArray(session.maps)?session.maps.slice(0,20).map(compactStoredMap).filter(Boolean):[],
      done:Array.isArray(session.done)?session.done.slice(0,20).map(String):[],
      done_at:session.done_at&&typeof session.done_at==="object"?session.done_at:{},
      feel:["easy","good","hard","too_hard"].includes(session.feel)?session.feel:"",
      note:String(session.note||"").slice(0,120),created_at:session.created_at||null,ended_at:session.ended_at||null,reason:String(session.reason||"imported")
    })).filter(x=>x.maps.length);
    const merged=new Map(trainingHistory.map(x=>[String(x.id),x]));for(const session of clean)merged.set(String(session.id),session);
    trainingHistory=[...merged.values()].sort((a,b)=>Date.parse(b.ended_at||b.created_at||0)-Date.parse(a.ended_at||a.created_at||0)).slice(0,80);
    persistTrainingHistory();renderTrainingJournal();alert("훈련 기록 "+clean.length+"세션을 가져왔습니다.");
  }catch(err){alert("훈련 기록 가져오기 실패: "+err.message);}
  event.target.value="";
});
$("exportTrainingJournal")?.addEventListener("click",()=>{
  const payload={format:"osu-skill-lab-training-journal",version:1,exported_at:new Date().toISOString(),note:"Local completion/exposure records only; not a skill model.",sessions:trainingHistory};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="osu-skill-lab-training-journal-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$("clearTrainingJournal")?.addEventListener("click",()=>{if(!trainingHistory.length)return;if(!confirm("이 브라우저의 종료된 훈련 세션 기록을 모두 지울까요? 현재 진행 중 세션은 유지됩니다."))return;trainingHistory=[];persistTrainingHistory();renderTrainingJournal();});
document.addEventListener("click",event=>{
  const toggle=event.target.closest("[data-training-toggle]");
  if(toggle){
    const id=decodeURIComponent(toggle.dataset.trainingToggle||""),done=new Set((trainingRouteState.done||[]).map(String)),times={...(trainingRouteState.done_at||{})};
    if(done.has(id)){done.delete(id);delete times[id];}else{done.add(id);times[id]=new Date().toISOString();}
    trainingRouteState.done=[...done];trainingRouteState.done_at=times;persistTrainingRoute();renderTrainingRoute();renderTrainingJournal();return;
  }
  const replay=event.target.closest("[data-training-history-replay]");
  if(replay){
    const id=decodeURIComponent(replay.dataset.trainingHistoryReplay||""),session=trainingHistory.find(x=>String(x.id)===id);if(!session)return;
    const skill=$("trainingRouteSkill");if(skill)skill.value=session.auto_skill?"auto":(session.skill||"overall");
    if($("trainingRouteStars"))$("trainingRouteStars").value=session.requested_band==="adaptive"?"adaptive":(session.band||"all");
    if($("trainingRouteMode"))$("trainingRouteMode").value=session.mode||"ramp";
    if($("trainingRouteScope"))$("trainingRouteScope").value=session.scope||"global";
    if($("trainingRouteCount")){const n=session.maps?.length||8;$("trainingRouteCount").value=n<=5?"5":n<=8?"8":"12";}
    $("buildTrainingRoute")?.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  const remove=event.target.closest("[data-training-history-remove]");
  if(remove){
    const id=decodeURIComponent(remove.dataset.trainingHistoryRemove||"");trainingHistory=trainingHistory.filter(x=>String(x.id)!==id);persistTrainingHistory();renderTrainingJournal();
  }
});
renderTrainingRoute();
renderTrainingJournal();
renderTrainingInsights();

function readLocalDnaRows() {
  try {
    const rows=JSON.parse(localStorage.getItem("osl-db")||"[]");
    return Array.isArray(rows)?rows:[];
  } catch (_) { return []; }
}
function renderDnaRanking() {
  const host=$("dnaGlobalRanking"); if(!host) return;
  const metric=$("dnaMetric")?.value||"overall", scope=$("dnaScope")?.value||"all";
  if(scope==="local"){
    const rows=readLocalDnaRows().filter(m=>m?.skills && Number.isFinite(Number(m.skills[metric])))
      .sort((a,b)=>Number(b.skills[metric])-Number(a.skills[metric])).slice(0,30);
    host.innerHTML=rows.length?rows.map((m,i)=>'<button type="button" class="dna-rank-row" data-local-chart="'+encodeURIComponent(String(m.md5||""))+'"><b>#'+(i+1)+'</b><span><strong>'+cx(m.meta?.Title||m.filename||"로컬 채보")+'</strong><small>'+cx(m.meta?.Artist||"?")+' · '+metric.toUpperCase()+' '+Number(m.skills[metric]||0).toFixed(1)+' · '+Number(m.bpm||0).toFixed(0)+' BPM</small></span></button>').join(""):'<div class="collection-state"><b>내 로컬 DNA가 없습니다</b><span>.osu 파일을 분석하면 이 기기 안에서 스킬별 랭킹을 바로 만들 수 있습니다.</span></div>';
    return;
  }
  const rows=catalogSummary?.research?.dna_rankings?.[metric]||[];
  host.innerHTML=rows.length?rows.slice(0,30).map((m,i)=>'<button type="button" class="dna-rank-row" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id||""))+'"><b>#'+(i+1)+'</b><span><strong>'+cx(m.artist||"?")+' — '+cx(m.title||"?")+'</strong><small>'+cx(m.creator||"?")+' · '+metric.toUpperCase()+' '+Number(m.dna?.skills?.[metric]||0).toFixed(1)+' · ★'+Number(m.official_sr||0).toFixed(2)+'</small></span></button>').join(""):'<div class="collection-state"><b>'+metric.toUpperCase()+' 랭킹 수집 중</b><span>실제 .osu Chart DNA 분석분이 쌓이면 자동으로 채워집니다.</span></div>';
}
$("dnaMetric")?.addEventListener("change",renderDnaRanking);
$("dnaScope")?.addEventListener("change",renderDnaRanking);

/* Actual-chart experimental DNA viewer; never label the scores as official SR/pp. */
function mapDistance(a,b){
  const keys=["official_sr","bpm","ar","od","cs","total_length"], scales=[1.2,80,2,2,1.5,180];
  let sum=0,n=0;keys.forEach((k,i)=>{if(a?.[k]!=null&&b?.[k]!=null){sum+=Math.pow((Number(a[k])-Number(b[k]))/scales[i],2);n++;}});
  if(a?.dna?.skills&&b?.dna?.skills){for(const k of ["aim","stream","speed","stamina","tech","reading","flow"]){sum+=Math.pow((Number(a.dna.skills[k]||0)-Number(b.dna.skills[k]||0))/25,2);n++;}}
  return n?Math.sqrt(sum/n):999;
}
function detailNeighbors(map){
  const globalIds=catalogSummary?.research?.similarity_index?.[String(map.beatmap_id)]||[];
  const local=new Map(rankedIndex.map(x=>[String(x.beatmap_id),x]));
  const global=globalIds.map(x=>({map:local.get(String(x.beatmap_id))||catalogSummary?.recent?.find(m=>String(m.beatmap_id)===String(x.beatmap_id)),d:Number(x.distance),global:true})).filter(x=>x.map);
  if(global.length)return global.slice(0,6);
  return rankedIndex.filter(x=>String(x.beatmap_id)!==String(map.beatmap_id)).map(x=>({map:x,d:mapDistance(map,x),global:false})).sort((a,b)=>a.d-b.d).slice(0,6);
}
function showRankedDetails(map) {
  if(!map) return;
  rememberViewedMap(map);
  const dna=map.dna?.skills, neighbors=detailNeighbors(map), sameMapper=rankedIndex.filter(x=>x.creator===map.creator&&String(x.beatmap_id)!==String(map.beatmap_id)).slice(0,5), fields=[
    ["공식 SR","★"+Number(map.official_sr||0).toFixed(2)],["BPM",Number(map.bpm||0).toFixed(1)],
    ["AR",map.ar??"—"],["OD",map.od??"—"],["CS",map.cs??"—"],
    ["HP",map.hp??"—"],["길이",Math.floor(Number(map.total_length||0)/60)+"분 "+Math.round(Number(map.total_length||0)%60)+"초"],
    ["플레이 수",ct(map.playcount)],["Ranked 날짜",String(map.ranked_date||"—").slice(0,10)]
  ];
  const mini=m=>'<button type="button" class="detail-neighbor" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id))+'"><b>'+cx(m.title)+' ['+cx(m.version)+']</b><small>'+cx(m.creator)+' · ★'+Number(m.official_sr||0).toFixed(2)+' · '+Number(m.bpm||0).toFixed(0)+' BPM</small></button>';
  const area=$("chartModalBody"); if(!area) return;
  area.innerHTML='<span class="chart-dna-badge">Ranked Explorer · 공식 메타데이터</span>'+
    '<h2>'+cx(map.artist||"?")+' — '+cx(map.title||"?")+'</h2>'+
    '<p class="muted">['+cx(map.version||"?")+'] · '+cx(map.creator||"?")+'</p>'+
    '<div class="ranked-detail-grid">'+fields.map(([k,v])=>'<div><small>'+cx(k)+'</small><b>'+cx(v)+'</b></div>').join("")+'</div>'+
    (dna?'<h3>Chart DNA · 자체 분석</h3><div class="dna-leaderboard">'+Object.entries(dna).map(([k,v])=>'<div class="dna-lead"><span>'+cx(k.toUpperCase())+'</span><b>'+Number(v||0).toFixed(1)+'</b></div>').join("")+'</div>':
      '<div class="collection-state"><b>Chart DNA 분석 대기 중</b><span>이 채보의 실제 노트 데이터가 아직 분석되지 않았습니다. 공식 메타데이터만 표시합니다.</span></div>')+
    '<div class="detail-discovery"><section><h3>비슷한 채보 · 현재 불러온 범위</h3><p class="muted">SR·BPM·AR·OD·CS·길이'+(dna?' + Chart DNA':'')+' 거리 기준</p><div class="detail-neighbors">'+(neighbors.length?neighbors.map(x=>mini(x.map)).join(""):'<div class="empty">비교 후보 없음</div>')+'</div></section>'+
    '<section><h3>같은 맵퍼 더 보기</h3><div class="detail-neighbors">'+(sameMapper.length?sameMapper.map(mini).join(""):'<div class="empty">현재 불러온 범위에 다른 채보 없음</div>')+'</div></section></div>'+
    '<div class="ranked-detail-actions"><button type="button" class="ghost-btn" data-similarity-seed="'+encodeURIComponent(String(map.beatmap_id))+'">Similarity Explorer</button><button type="button" class="ghost-btn favorite-toggle '+(favoriteMaps.has(String(map.beatmap_id))?"active":"")+'" data-favorite-map="'+encodeURIComponent(String(map.beatmap_id))+'">'+(favoriteMaps.has(String(map.beatmap_id))?"★ 즐겨찾기됨":"☆ 즐겨찾기")+'</button>'+
    '<button type="button" class="ghost-btn" data-share-map="'+encodeURIComponent(String(map.beatmap_id))+'">링크 복사</button>'+
    '<a class="ghost-btn" href="https://osu.ppy.sh/beatmaps/'+encodeURIComponent(map.beatmap_id)+'" target="_blank" rel="noopener noreferrer">osu! 채보 페이지 ↗</a>'+
    '<a class="ghost-btn" href="https://osu.ppy.sh/beatmapsets/'+encodeURIComponent(map.beatmapset_id)+'" target="_blank" rel="noopener noreferrer">비트맵셋 보기 ↗</a></div>';
  const dialog=$("chartModal");if(!dialog)return;if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();else dialog.setAttribute("open","");
}
function showChartDna(map) {
  if (!map?.dna?.skills) return;
  const dna = map.dna;
  const labels = {aim:"Aim",stream:"Stream",speed:"Speed",stamina:"Stamina",tech:"Tech",
                  reading:"Reading",flow:"Flow Aim"};
  const bars = Object.entries(labels).map(([key, label]) => {
    const val = Math.max(0, Math.min(100, Number(dna.skills[key]) || 0));
    return '<div class="skill"><span>' + label +
      '</span><div class="bar"><i style="width:' + val + '%"></i></div>' +
      '<b>' + val.toFixed(1) + '</b></div>';
  }).join("");
  const details = [
    ["노트 수", ct(dna.objects)], ["최대 Stream 후보", ct(dna.max_stream) + " notes"],
    ["2초 Peak 밀도", ct(dna.peak_density_2s) + " notes"],
    ["중앙 노트 간격", Number(dna.median_gap_ms || 0).toFixed(0) + "ms"],
  ];
  const body=$("chartModalBody"); if(!body) return;
  body.innerHTML =
    '<span class="chart-dna-badge">실제 .osu 채보 기반 · 시범 분석</span>' +
    '<h2>' + cx(map.artist || "?") + ' — ' + cx(map.title || "?") + '</h2>' +
    '<p class="muted">' + cx(map.version || "?") + ' · ' + cx(map.creator || "?") +
    ' · 공식 ★' + Number(map.official_sr || 0).toFixed(2) + '</p>' +
    '<div class="metric"><b>' + Number(dna.skills.overall || 0).toFixed(1) +
    ' / 100</b><span>Chart DNA 종합 (비공식 · 자체 휴리스틱)</span></div>' +
    '<div style="margin:19px 0">' + bars + '</div>' +
    '<div class="metrics">' + details.map(x => '<div class="metric"><b>' +
      cx(x[1]) + '</b><span>' + cx(x[0]) + '</span></div>').join("") + '</div>' +
    '<p class="hint-text">슬라이더 세부 처리, 연타 기술, 플레이어 실력은 온전히 반영하지 못할 수 있습니다. osu! 공식 난이도/pp와 직접 비교하는 수치가 아닙니다.</p>' +
    '<a class="ghost-btn" target="_blank" rel="noopener noreferrer" href="https://osu.ppy.sh/beatmaps/' +
    encodeURIComponent(map.beatmap_id) + '">osu! 원본 채보 페이지 ↗</a>';
  const dialog = $("chartModal"); if(!dialog) return;
  if (typeof dialog.showModal === "function"&&!dialog.open) dialog.showModal();
  else {dialog.setAttribute("open","");}
}
document.addEventListener("click", event => {
  const b=event.target.closest("[data-mapper-fp]"); if(!b)return;
  const name=decodeURIComponent(b.dataset.mapperFp||"");
  const fp=(catalogSummary?.research?.mapper_fingerprints||[]).find(x=>x.name===name); if(!fp)return;
  const skills=fp.skills||{}, area=$("chartModalBody");
  area.innerHTML='<span class="chart-dna-badge">Mapper Fingerprint</span><h2>'+cx(fp.name)+'</h2>'+
    '<div class="ranked-detail-grid"><div><small>비트맵셋</small><b>'+ct(fp.beatmapsets)+'</b></div><div><small>난이도</small><b>'+ct(fp.difficulties)+'</b></div><div><small>평균 SR</small><b>★'+Number(fp.avg_sr||0).toFixed(2)+'</b></div><div><small>평균 BPM</small><b>'+Number(fp.avg_bpm||0).toFixed(1)+'</b></div><div><small>DNA 표본</small><b>'+ct(fp.dna_sample||0)+'</b></div></div>'+
    (Object.keys(skills).length?'<h3>분석된 채보의 평균 DNA</h3><div class="dna-leaderboard">'+Object.entries(skills).map(([k,v])=>'<div class="dna-lead"><span>'+cx(k.toUpperCase())+'</span><b>'+Number(v).toFixed(1)+'</b></div>').join("")+'</div>':'<div class="collection-state"><b>DNA 표본 수집 중</b><span>맵퍼의 실제 Chart DNA가 분석되면 스타일 축이 자동으로 추가됩니다.</span></div>')+
    '<p class="muted">메타데이터 통계는 현재 수집된 Ranked/Approved 카탈로그 기준이며, DNA 값은 분석 완료된 채보 표본만 사용합니다.</p>'+
    '<div class="ranked-detail-actions"><button type="button" class="ghost-btn" data-mapper-search="'+encodeURIComponent(fp.name)+'">이 맵퍼 Ranked 검색 ↗</button></div>';
  const d=$("chartModal");if(typeof d.showModal==="function"&&!d.open)d.showModal();else d.setAttribute("open","");
});
document.addEventListener("click", event => {
  const button=event.target.closest("[data-ranked-detail]");
  if(!button)return;
  const id=decodeURIComponent(button.dataset.rankedDetail||"");
  const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);
  showRankedDetails(map);
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-dna-id]");
  if (!button) return;
  const id = decodeURIComponent(button.dataset.dnaId || "");
  const map = rankedIndex.find(m => String(m.beatmap_id) === id) || findSummaryMap(id);
  showChartDna(map);
});
$("chartModalClose")?.addEventListener("click", () => {
  const dialog = $("chartModal");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
});
$("chartModal")?.addEventListener("click", event => {
  if (event.target === $("chartModal")) $("chartModalClose")?.click();
});


// Interaction layer: delegated handlers work for dynamically rendered cards without double-firing.
function bindInteractiveCatalogueControls() {
  document.addEventListener("click", event => {
    const year=event.target.closest("[data-year-link]");
    if(year){
      event.preventDefault(); openTab("ranked");
      const select=$("indexedYear"); if(select){select.value=year.dataset.yearLink; indexedLoadedKey=""; loadRankedSearch();}
      document.querySelector(".filter-toolbar")?.scrollIntoView({behavior:"smooth",block:"start"});
      return;
    }
    const mapperSearch=event.target.closest("[data-mapper-search]");
    if(mapperSearch){
      event.preventDefault();
      const name=decodeURIComponent(mapperSearch.dataset.mapperSearch||"");
      const dialog=$("chartModal"); if(dialog?.open&&typeof dialog.close==="function") dialog.close();
      openTab("ranked");
      const q=$("indexedQuery"); if(q){q.value=name;q.dispatchEvent(new Event("input",{bubbles:true}));q.focus();}
      return;
    }
    const similar=event.target.closest("[data-similarity-seed]");
    if(similar){
      event.preventDefault();
      const id=decodeURIComponent(similar.dataset.similaritySeed||"");
      const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);
      if(map){
        const dialog=$("chartModal");if(dialog?.open&&typeof dialog.close==="function")dialog.close();
        setSimilaritySeed(map,false);
      }
      return;
    }
    const favorite=event.target.closest("[data-favorite-map]");
    if(favorite){
      event.preventDefault();
      const id=decodeURIComponent(favorite.dataset.favoriteMap||"");
      const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);
      if(map){
        toggleFavoriteMap(map);
        const dialog=$("chartModal");
        if(dialog?.open)showRankedDetails(map);
      }
      return;
    }
    const share=event.target.closest("[data-share-map]");
    if(share){
      event.preventDefault();
      const id=decodeURIComponent(share.dataset.shareMap||"");
      const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id)||similarityResultMaps.get(id)||relationGraphMaps.get(id)||trainingRouteMaps.get(id)||replaySignalMaps.get(id)||favoriteMaps.get(id)||recentViewedMaps.find(m=>String(m.beatmap_id)===id);
      if(map)copyMapShareLink(map);
      return;
    }
    const local=event.target.closest("[data-local-chart]");
    if(local){
      event.preventDefault();
      const id=decodeURIComponent(local.dataset.localChart||"");
      if(typeof window.choose==="function"){window.choose(id); openTab("skills");}
    }
  });

  document.querySelectorAll("[data-stats-view]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-stats-view]").forEach(x=>{x.classList.toggle("active",x===btn);x.setAttribute("aria-selected",String(x===btn));});
    const view=btn.dataset.statsView;
    const target=view==="history"?$("eraResearch"):view==="mapper"?$("mapperResearch"):view==="extreme"?$("oddityResearch"):view==="difficulty"?$("officialStatsArea"):$("statsHeroKpis");
    target?.closest(".card")?.scrollIntoView({behavior:"smooth",block:"start"}) || target?.scrollIntoView({behavior:"smooth",block:"start"});
  }));
  document.querySelectorAll("[data-research-target]").forEach(btn=>btn.addEventListener("click",()=>{
    const target=btn.dataset.researchTarget;
    const box=target==="era"?$("eraResearch"):target==="mapper"?$("mapperResearch"):target==="odd"?$("oddityResearch"):$("twinResearch");
    document.querySelectorAll("[data-research-target]").forEach(x=>{x.classList.toggle("active",x===btn);x.setAttribute("aria-pressed",String(x===btn));});
    box?.closest(".card")?.scrollIntoView({behavior:"smooth",block:"center"});
  }));
  document.querySelectorAll("[data-dna-view]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-dna-view]").forEach(x=>{x.classList.toggle("active",x===btn);x.setAttribute("aria-selected",String(x===btn));});
    const view=btn.dataset.dnaView, scope=$("dnaScope");
    if(view==="local"&&scope){scope.value="local";renderDnaRanking();}
    if(view==="ranking"&&scope){scope.value="all";renderDnaRanking();}
    const target=view==="ranking"?$("dnaGlobalRanking"):view==="local"?$("skillBars"):$("dnaCoverage");
    target?.closest(".card")?.scrollIntoView({behavior:"smooth",block:"start"}) || target?.scrollIntoView({behavior:"smooth",block:"start"});
  }));
  document.querySelectorAll("[data-training-view]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-training-view]").forEach(x=>{x.classList.toggle("active",x===btn);x.setAttribute("aria-selected",String(x===btn));});
    const view=btn.dataset.trainingView;
    const target=view==="ladder"?$("skillLadder"):view==="weakness"?$("weaknessRadar"):view==="goal"?document.querySelector(".feature-roadmap"):$("trainingFocus");
    target?.closest(".card")?.scrollIntoView({behavior:"smooth",block:"center"}) || target?.scrollIntoView({behavior:"smooth",block:"center"});
  }));
}
bindInteractiveCatalogueControls();

// Optional first list paint. The summary boot was already scheduled near the top of this file.
try { renderIndexed(); } catch (err) {
  console.warn("Initial Ranked list render deferred", err);
}

renderSavedShelves();
