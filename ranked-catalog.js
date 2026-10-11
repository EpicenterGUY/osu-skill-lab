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
    if (overlay) m.dna=overlay;
  }
  return rows;
}
function dnaYearsForSelection(selection) {
  const shards=catalogSummary?.chart_dna?.shards||[];
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
    if (document.getElementById("ranked").classList.contains("active"))
      loadRankedSearch();
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
function renderIndexed() {
  const q = $("indexedQuery").value.trim().toLocaleLowerCase();
  const minSr = Number($("indexedMinSr")?.value || 0), minBpm = Number($("indexedMinBpm")?.value || 0);
  const rows = rankedIndex.filter(m => (!$('dnaOnly').checked || Boolean(m.dna?.skills)) &&
    Number(m.official_sr || 0) >= minSr && Number(m.bpm || 0) >= minBpm && (!q ||
    [m.artist, m.title, m.creator, m.version, m.beatmap_id].some(v =>
      String(v ?? "").toLocaleLowerCase().includes(q))));
  const sort = $("indexedSort").value;
  const numeric = (m, field) => Number(m[field]) || 0;
  rows.sort((a, b) => {
    if (sort.startsWith("dna_")) {const k=sort.slice(4);return numeric(b.dna?.skills||{},k)-numeric(a.dna?.skills||{},k);}
    if (sort === "sr_asc") return numeric(a, "official_sr") - numeric(b, "official_sr");
    if (sort === "recent") return String(b.ranked_date || "").localeCompare(String(a.ranked_date || ""));
    if (sort === "bpm_desc") return numeric(b, "bpm") - numeric(a, "bpm");
    if (sort === "plays") return numeric(b, "playcount") - numeric(a, "playcount");
    return numeric(b, "official_sr") - numeric(a, "official_sr");
  });
  $("indexedCount").textContent = ct(rows.length) + " / " + ct(rankedIndex.length) +
    "채보 · 현재 로드한 연도/미리보기 기준";
  const rs = $("rankedResultSummary");
  if (rs) {
    const avgSr = rows.length ? rows.reduce((n,m)=>n+Number(m.official_sr||0),0)/rows.length : 0;
    const avgBpm = rows.length ? rows.reduce((n,m)=>n+Number(m.bpm||0),0)/rows.length : 0;
    rs.innerHTML = '<span><b>' + ct(rows.length) + '</b> 결과</span><span>평균 <b>★' +
      avgSr.toFixed(2) + '</b></span><span>평균 <b>' + avgBpm.toFixed(0) + ' BPM</b></span>';
  }
  $("indexedList").innerHTML = rows.slice(0, indexedLimit).map(m =>
    '<div class="dbitem"><b>' + officialMapLink(m) + '</b><div class="muted">' +
    cx(m.creator) + ' · ★' + Number(m.official_sr || 0).toFixed(2) +
    ' · ' + Number(m.bpm || 0).toFixed(0) + ' BPM · AR' +
    cx(m.ar) + ' OD' + cx(m.od) + ' · ' +
    cx((m.ranked_date || "").slice(0, 10)) + '</div>' +
    '<button type="button" class="ghost-btn" data-ranked-detail="'+encodeURIComponent(String(m.beatmap_id))+'">상세 분석 ↗</button>' + (m.dna?.skills ? '<button type="button" class="ghost-btn" data-dna-id="' +
      encodeURIComponent(String(m.beatmap_id)) + '">Chart DNA 자세히 ↗</button>' :
      '<span class="chip">공식 메타데이터</span>') + '</div>').join("") ||
    '<div class="empty">검색 결과 없음</div>';
  $("indexedMore").style.display = rows.length > indexedLimit ? "block" : "none";
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
$("indexedYear")?.addEventListener("change", () => {indexedLoadedKey = ""; loadRankedSearch();});

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
    '<div class="ranked-detail-actions"><a class="ghost-btn" href="https://osu.ppy.sh/beatmaps/'+encodeURIComponent(map.beatmap_id)+'" target="_blank" rel="noopener noreferrer">osu! 채보 페이지 ↗</a>'+
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
  const map=rankedIndex.find(m=>String(m.beatmap_id)===id)||findSummaryMap(id);
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
