/* osu! Skill Lab — local-only profile shortcut.
 * Username is saved exclusively to this browser's localStorage.
 * No network API calls or public GitHub data files are used for the profile.
 * External osu! profile page opens only after the user clicks its link.
 */
const OSLProfile = (() => {
  const KEY = "osl-profile-username";
  const STATS_KEY = "osl-profile-local-stats";
  let localStats = null;
  try { const saved = JSON.parse(localStorage.getItem(STATS_KEY) || "null"); if (saved?.username && saved?.statistics) localStats = saved; } catch (_) {}
  const byId = id => document.getElementById(id);
  const escapeHtml = value => esc(String(value ?? ""));
  const clean = value => String(value ?? "").trim().slice(0, 60);
  const userLink = name => "https://osu.ppy.sh/users/" + encodeURIComponent(name);
  let username = "";
  try { username = clean(localStorage.getItem(KEY)); } catch (_) {}

  const format = value => Number(value).toLocaleString("ko-KR");
  function validate(raw) {
    const data = raw?.user && typeof raw.user === "object" ? raw.user : raw;
    if (!data || typeof data !== "object" || typeof data.username !== "string" || !data.username.trim() ||
        !data.statistics || typeof data.statistics !== "object")
      throw Error("osu! API의 사용자 JSON 형식이 아닙니다. username과 statistics가 필요합니다.");
    const st = data.statistics;
    const num = key => Number.isFinite(Number(st[key])) && st[key] != null ? Number(st[key]) : null;
    const safe = {
      username: clean(data.username), id: Number.isSafeInteger(Number(data.id)) ? Number(data.id) : null,
      statistics: {pp:num("pp"), global_rank:num("global_rank"), country_rank:num("country_rank"),
        hit_accuracy:num("hit_accuracy"), play_count:num("play_count"), maximum_combo:num("maximum_combo")},
      imported_at: new Date().toISOString()
    };
    if (!safe.username) throw Error("닉네임이 없습니다.");
    return safe;
  }
  function render() {
    const input = byId("profileUserInput");
    const home = byId("profileHomePreview");
    const result = byId("profileResult");
    const status = byId("profileStatus");
    if (input && document.activeElement !== input) input.value = username;

    if (!username) {
      if (status) status.textContent = "이 기기의 브라우저에만 저장합니다. GitHub나 다른 방문자에게 전송하지 않습니다.";
      if (result) result.innerHTML =
        '<div class="empty">프로필을 연결해 보세요. osu! 비밀번호나 API 키는 필요하지 않습니다.</div>';
      if (home) home.innerHTML =
        '<p class="muted">내 osu! 닉네임을 이 브라우저에만 저장하고 공식 프로필로 빠르게 이동할 수 있어요.</p>' +
        '<button type="button" class="ghost-btn" data-tab="profile">프로필 등록 ↗</button>';
      return;
    }

    const name = escapeHtml(username);
    const stats = localStats && localStats.username.toLowerCase() === username.toLowerCase() ? localStats.statistics : null;
    const avatar = '<span class="profile-avatar profile-avatar-fallback" aria-hidden="true">' +
      escapeHtml(username.charAt(0).toUpperCase()) + '</span>';
    const link = escapeHtml(userLink(username));
    if (status) status.textContent =
      "내 브라우저 전용 · 계정 정보는 외부 서버나 공개 저장소에 업로드하지 않습니다.";
    const statsHtml = stats ? '<div class="metrics profile-stats">' +
      [["PP",stats.pp == null ? "—" : format(Math.round(stats.pp))],
       ["세계 순위",stats.global_rank == null ? "—" : "#" + format(stats.global_rank)],
       ["국가 순위",stats.country_rank == null ? "—" : "#" + format(stats.country_rank)],
       ["정확도",stats.hit_accuracy == null ? "—" : stats.hit_accuracy.toFixed(2) + "%"],
       ["플레이 수",stats.play_count == null ? "—" : format(stats.play_count)],
       ["최대 콤보",stats.maximum_combo == null ? "—" : format(stats.maximum_combo)]]
       .map(([label,value])=>'<div class="metric"><b>'+escapeHtml(value)+'</b><span>'+escapeHtml(label)+'</span></div>').join("") +
      '</div><p class="hint-text">직접 가져온 JSON 기준 · 실시간 자동 갱신 아님</p>' : "";
    if (result) result.innerHTML =
      '<div class="profile-cover"><div class="profile-identity">' + avatar +
      '<div><span class="profile-kicker">LOCAL-ONLY OSU! PROFILE</span><h2>' + name +
      '</h2><p class="muted">이 기기의 브라우저에만 저장된 프로필 바로가기</p></div></div></div>' +
      statsHtml + '<div class="subtle-panel"><b>개인 프로필 모드</b><p class="hint-text">' +
      'osu! 닉네임은 이 브라우저에만 저장됩니다. 다른 방문자는 자신의 계정을 별도로 등록할 수 있고, ' +
      '공개 사이트에는 내 PP·랭크·플레이 기록을 게시하지 않습니다. ' +
      '통계는 사용자가 직접 가져온 JSON이 있을 때만 표시하며 자동 갱신은 지원하지 않습니다.' +
      '</p></div><div class="profile-actions">' +
      '<a class="hero-primary" href="' + link +
      '" target="_blank" rel="noopener noreferrer">osu! 공식 프로필 열기 ↗</a>' +
      '<button type="button" id="profileChange" class="ghost-btn">다른 계정 입력</button>' +
      '<button type="button" id="profileForget" class="ghost-btn">이 브라우저에서 삭제</button></div>';
    byId("profileChange")?.addEventListener("click", () => {
      input?.focus();
      input?.select();
    });
    byId("profileForget")?.addEventListener("click", () => {
      username = "";
      localStats = null;
      try { localStorage.removeItem(KEY); localStorage.removeItem(STATS_KEY); } catch (_) {}
      render();
    });
    if (home) home.innerHTML =
      '<div class="profile-home-compact">' + avatar + '<div><b>' + name +
      '</b><span>이 브라우저에만 저장된 계정</span></div></div>' +
      '<button type="button" data-tab="profile" class="ghost-btn">내 프로필 보기 ↗</button>';
  }

  byId("profileForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const next = clean(byId("profileUserInput")?.value);
    if (!next) return;
    username = next;
    if (localStats?.username.toLowerCase() !== next.toLowerCase()) { localStats = null; try {localStorage.removeItem(STATS_KEY);} catch (_) {} }
    try { localStorage.setItem(KEY, next); } catch (_) {}
    render();
  });

  byId("profileJsonFile")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const info = byId("profileImportStatus");
    try {
      if (file.size > 1_000_000) throw Error("1MB 이하의 JSON만 가져올 수 있습니다.");
      const parsed = validate(JSON.parse(await file.text()));
      if (username && parsed.username.toLowerCase() !== username.toLowerCase())
        throw Error("등록한 계정(" + username + ")과 JSON 계정(" + parsed.username + ")이 다릅니다.");
      username = parsed.username;
      localStats = parsed;
      localStorage.setItem(KEY, username);
      localStorage.setItem(STATS_KEY, JSON.stringify(parsed));
      render();
      if (info) info.textContent = "가져오기 완료 · 통계는 이 브라우저에만 저장됐습니다.";
    } catch (err) {
      if (info) info.textContent = "가져오기 실패: " + err.message;
    } finally { event.target.value = ""; }
  });
  render();
  return { open: render, refresh: render };
})();
window.OSLProfile = OSLProfile;
