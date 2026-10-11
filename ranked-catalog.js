/* Public osu! Skill Lab Ranked catalogue (v0.9).
 * Startup: fetch only one precomputed summary, never all raw monthly beatmap JSON.
 * Search: lazily request lightweight yearly indexes on entering RANKED.
 * "All years" is opt-in to protect phones as the catalogue grows.
 */
let catalogSummary = null;
let rankedIndex = [];
let indexedLimit = 20;
const indexedImported = new Map();
const indexedYearCache = new Map();
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
  (kind === "sr" ? "★" + Number(m.official_sr || 0).toFixed(2) : ct(m.playcount)) +
  '</td></tr>').join("");
const statsTable = (header, rows, extra = "") =>
  '<table><thead><tr><th>#</th><th>' + header + '</th><th>' +
  (extra || "기록") + '</th></tr></thead><tbody>' + rows + '</tbody></table>';

async function fetchCatalogJson(path, version, fresh = false) {
  if (path.includes("..") || !path.startsWith("data/") || !path.endsWith(".json"))
    throw Error("허용되지 않은 DB 경로");
  const url = "./" + path + "?v=" + encodeURIComponent(String(version || "1"));
  const response = await fetch(url, {cache: fresh ? "no-store" : "default"});
  if (!response.ok) throw Error("HTTP " + response.status + " · " + path);
  return response.json();
}

function renderCatalogSummary(s) {
  const count = s.counts || {};
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

  const yearRows = (s.years || []).filter(x => x.year !== "unknown");
  const mapperRows = (s.top_mappers || []).slice(0, 15).map((m, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + cx(m.name) + '</td><td>' +
    ct(m.beatmapsets) + '곡 / ' + ct(m.difficulties) + '채보</td></tr>').join("");
  $("officialStatsArea").innerHTML =
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
    '<div class="card half"><h2>맵퍼 TOP 15 · 비트맵셋 수</h2>' +
    statsTable("맵퍼", mapperRows, "곡 / 난이도") + '</div>' +
    '<div class="card half"><h2>공식 SR TOP 10</h2>' +
    statsTable("채보", topRows(s.top_sr, "sr"), "SR") + '</div>' +
    '<div class="card full"><h2>플레이카운트 TOP 10 · 현재 수집분</h2>' +
    statsTable("채보", topRows(s.top_playcount, "plays"), "플레이 수") + '</div>' +
    '<div class="card full"><h2>실제 채보 기반 Chart DNA · 시범 운영</h2>' +
    '<p class="muted">실제 .osu 노트 데이터를 읽어 계산한 자체 Aim / Stream / Speed 등의 점수입니다. 공식 SR 또는 pp가 아닙니다.</p>' +
    '<div class="metrics"><div class="metric"><b>' + ct(count.chart_dna_analyzed || 0) +
    '</b><span>실제 채보 분석 완료</span></div><div class="metric"><b>' + ct(count.difficulties) +
    '</b><span>전체 수집된 채보</span></div></div>' +
    '<p class="hint-text">Chart DNA는 새로운 Ranked부터 소량씩 시범 분석하며, 원본 .osu 파일을 사이트에 공개하지 않습니다. API 또는 파일 제공처 접근 제한 시 분석이 지연될 수 있습니다.</p></div>' +
    '</div>';
  $("officialStatsArea").querySelectorAll("[data-year-link]").forEach(b => {
    b.addEventListener("click", () => {
      openTab("ranked");
      $("indexedYear").value = b.dataset.yearLink;
      loadRankedSearch();
    });
  });
  $("rankedIndexStats").textContent = ct(count.beatmapsets) + "곡 · " +
    ct(count.difficulties) + "채보 · " + current +
    " · 공식 메타데이터만 집계 (채보 DNA는 별도)";
  $("rankedIndexTop").innerHTML = '<h3>수집된 공식 SR TOP 10</h3>' +
    (s.top_sr || []).slice(0, 10).map((m, i) =>
      '<div class="dbitem"><b>#' + (i + 1) + ' ' + officialMapLink(m) +
      '</b><div class="muted">★' + Number(m.official_sr || 0).toFixed(2) +
      ' · ' + ct(m.bpm) + ' BPM</div></div>').join("");
}

async function loadRankedSummary() {
  try {
    const s = await fetchCatalogJson("data/ranked-summary.json", Date.now(), true);
    if (s.format !== "osu-skill-lab-summary" || !Array.isArray(s.search_shards))
      throw Error("지원하지 않는 통계 형식");
    catalogSummary = s;
    indexedYearCache.clear();
    indexedLoadedKey = "";
    renderCatalogSummary(s);
    const select = $("indexedYear");
    const prev = select.value;
    select.innerHTML = '<option value="all">전체 연도 (전체 검색 인덱스 로드)</option>' +
      s.search_shards.map(sh => '<option value="' + cx(sh.year) + '">' +
        cx(sh.year) + '년 · ' + ct(sh.count) + '채보</option>').join("");
    select.value = s.search_shards.some(sh => sh.year === prev) || prev === "all" ? prev :
      (s.search_shards[0]?.year || "all");
    $("hostedSyncState").textContent = "연도 선택 시 해당 연도 검색 데이터를 불러옵니다. 통계는 이미 준비됐어요.";
    renderRecentPreview();
    if (document.getElementById("ranked").classList.contains("active"))
      loadRankedSearch();
  } catch (err) {
    $("catalogUpdated").textContent = "공식 Ranked 통계를 아직 불러오지 못했습니다. 배포 및 연결을 확인하세요.";
    $("hostedSyncState").textContent = "검색 인덱스 배포 대기 중 · " + err.message;
    $("officialStatsArea").innerHTML = '<p class="muted">통계 데이터 배포 또는 네트워크 연결을 기다리는 중입니다.</p>';
    console.warn("Ranked summary unavailable", err);
  }
}

function renderRecentPreview() {
  if (!catalogSummary) return;
  const recent = (catalogSummary.recent || []).slice();
  rankedIndex = recent;
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
  const rows = rankedIndex.filter(m => !q ||
    [m.artist, m.title, m.creator, m.version, m.beatmap_id].some(v =>
      String(v ?? "").toLocaleLowerCase().includes(q)));
  const sort = $("indexedSort").value;
  const numeric = (m, field) => Number(m[field]) || 0;
  rows.sort((a, b) => {
    if (sort === "sr_asc") return numeric(a, "official_sr") - numeric(b, "official_sr");
    if (sort === "recent") return String(b.ranked_date || "").localeCompare(String(a.ranked_date || ""));
    if (sort === "bpm_desc") return numeric(b, "bpm") - numeric(a, "bpm");
    if (sort === "plays") return numeric(b, "playcount") - numeric(a, "playcount");
    return numeric(b, "official_sr") - numeric(a, "official_sr");
  });
  $("indexedCount").textContent = ct(rows.length) + " / " + ct(rankedIndex.length) +
    "채보 · 현재 로드한 연도/미리보기 기준";
  $("indexedList").innerHTML = rows.slice(0, indexedLimit).map(m =>
    '<div class="dbitem"><b>' + officialMapLink(m) + '</b><div class="muted">' +
    cx(m.creator) + ' · ★' + Number(m.official_sr || 0).toFixed(2) +
    ' · ' + Number(m.bpm || 0).toFixed(0) + ' BPM · AR' +
    cx(m.ar) + ' OD' + cx(m.od) + ' · ' +
    cx((m.ranked_date || "").slice(0, 10)) + '</div>' +
    (m.dna?.skills ? '<button type="button" class="ghost-btn" data-dna-id="' +
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
$("indexedQuery").addEventListener("input", scheduleIndexedRender);
$("indexedSort").addEventListener("change", () => {indexedLimit = 20; renderIndexed();});
$("indexedMore").addEventListener("click", () => {indexedLimit += 20; renderIndexed();});
$("indexedYear").addEventListener("change", () => {indexedLoadedKey = ""; loadRankedSearch();});

async function loadRankedSearch() {
  if (!catalogSummary) return;
  const year = $("indexedYear").value;
  const version = catalogSummary.updated_at || "1";
  const key = year + "@" + version;
  if (key === indexedLoadedKey) return;
  if (indexedLoadPromise?.key === key) return indexedLoadPromise.promise;

  const generation = ++indexedGeneration;
  const shards = year === "all" ? catalogSummary.search_shards :
    catalogSummary.search_shards.filter(sh => sh.year === year);
  if (!shards.length) {
    $("hostedSyncState").textContent = "해당 연도의 공개 검색 인덱스가 없습니다.";
    return;
  }
  const task = (async () => {
    let loaded = 0, failed = 0;
    const gathered = [];
    $("hostedSyncState").textContent = year === "all" ?
      "전체 연도 검색 인덱스 로딩 중… (" + shards.length + "개 묶음)" :
      year + "년 검색 데이터 로딩 중…";
    for (let i = 0; i < shards.length; i += 3) {
      const batch = await Promise.allSettled(shards.slice(i, i + 3).map(async sh => {
        if (indexedYearCache.has(sh.year)) return indexedYearCache.get(sh.year);
        const rows = await fetchCatalogJson(sh.path, version);
        if (!Array.isArray(rows)) throw Error("손상된 인덱스 · " + sh.year);
        indexedYearCache.set(sh.year, rows);
        return rows;
      }));
      if (generation !== indexedGeneration) return;
      for (const item of batch) {
        if (item.status === "fulfilled") {loaded += item.value.length; gathered.push(...item.value);}
        else {failed++; console.warn("Ranked index load failure", item.reason);}
      }
      $("hostedSyncState").textContent = "검색 인덱스 " + ct(loaded) + "개 로드 · " +
        (Math.min(i + 3, shards.length)) + "/" + shards.length + "개 묶음" +
        (failed ? " · 실패 " + failed + "개" : "");
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (generation !== indexedGeneration) return;
    const merged = new Map();
    for (const m of indexedImported.values()) if (year === "all" || String(m.ranked_date || "").startsWith(year))
      merged.set(String(m.beatmap_id), m);
    for (const m of gathered) if (m?.beatmap_id) merged.set(String(m.beatmap_id), m);
    rankedIndex = [...merged.values()];
    indexedLoadedKey = failed ? "" : key;
    indexedLimit = 20;
    renderIndexed();
    $("hostedSyncState").textContent = (year === "all" ? "전체 연도" : year + "년") +
      " 수집된 " + ct(rankedIndex.length) + "채보 검색 준비 완료" +
      (failed ? " · 일부 실패: 연도 변경 후 다시 시도" : "") +
      " · 전체 Ranked 모집단이 아닌 확보된 DB 기준";
  })();
  indexedLoadPromise = {key, promise: task};
  try {await task;} finally {
    if (indexedLoadPromise?.promise === task) indexedLoadPromise = null;
  }
}
window.loadRankedSearch = loadRankedSearch;

$("importRanked").addEventListener("change", async e => {
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
    else {rankedIndex = [...indexedImported.values()]; renderIndexed();}
    alert("개인 색인 " + ct(data.maps.length) + "개 가져옴");
  } catch (err) {alert("가져오기 실패: " + err.message);}
  e.target.value = "";
});


/* Actual-chart experimental DNA viewer; never label the scores as official SR/pp. */
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
  $("chartModalBody").innerHTML =
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
  const dialog = $("chartModal");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else {dialog.setAttribute("open","");}
}
document.addEventListener("click", event => {
  const button = event.target.closest("[data-dna-id]");
  if (!button) return;
  const id = decodeURIComponent(button.dataset.dnaId || "");
  const map = rankedIndex.find(m => String(m.beatmap_id) === id) ||
    catalogSummary?.recent?.find(m => String(m.beatmap_id) === id);
  showChartDna(map);
});
$("chartModalClose").addEventListener("click", () => {
  const dialog = $("chartModal");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
});
$("chartModal").addEventListener("click", event => {
  if (event.target === $("chartModal")) $("chartModalClose").click();
});

renderIndexed();
loadRankedSummary();
