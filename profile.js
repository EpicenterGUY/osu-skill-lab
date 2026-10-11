/* Local, explicitly selected public osu! profile + optional server-side snapshot.
 * No OAuth access tokens in browser, no arbitrary API-key proxy.
 */
const OSLProfile = (() => {
  const STORE = "osl-profile-username";
  const $p = id => document.getElementById(id);
  const safe = value => esc(String(value ?? ""));
  const commas = number => Number(number || 0).toLocaleString("ko-KR");
  const clean = value => String(value || "").trim().slice(0, 60);
  let chosen = "";
  try { chosen = clean(localStorage.getItem(STORE)); } catch (_) {}
  let published = null;
  let publishedChecked = false;
  let loading = null;

  const urlFor = user => {
    if (!user) return "https://osu.ppy.sh/home";
    return "https://osu.ppy.sh/users/" + encodeURIComponent(user);
  };
  function validImage(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" &&
        (parsed.hostname === "a.ppy.sh" ||
         parsed.hostname === "assets.ppy.sh" ||
         parsed.hostname === "osu.ppy.sh") ? parsed.href : "";
    } catch (_) { return ""; }
  }
  function render() {
    const field = $p("profileUserInput");
    const result = $p("profileResult");
    const home = $p("profileHomePreview");
    const status = $p("profileStatus");
    if (field && document.activeElement !== field) field.value = chosen;
    if (!chosen) {
      if (status) status.textContent = "osu! 닉네임 또는 숫자 ID를 입력하면 이 브라우저에 저장해 둘 수 있어요.";
      if (result) result.innerHTML = '<div class="empty">프로필을 연결해 보세요. 비밀번호, OAuth 비밀키, 로그인 토큰은 필요하지 않습니다.</div>';
      if (home) home.innerHTML = '<p class="muted">내 osu! 계정을 즐겨찾기에 등록하고 공식 프로필로 빠르게 이동하세요.</p><button type="button" data-tab="profile" class="ghost-btn">프로필 연결하기 ↗</button>';
      return;
    }
    const matched = published && (String(published.username || "").toLocaleLowerCase() === chosen.toLocaleLowerCase() ||
        String(published.id || "") === chosen);
    const account = matched ? published : null;
    const username = account?.username || chosen;
    const rank = account?.statistics || {};
    const avatar = validImage(account?.avatar_url || (/^\d+$/.test(chosen) ? "https://a.ppy.sh/" + chosen : ""));
    const cover = validImage(account?.cover_url);
    const link = account?.id ? urlFor(String(account.id)) : urlFor(username);
    const photo = avatar ? '<img class="profile-avatar" src="' + safe(avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' :
      '<span class="profile-avatar profile-avatar-fallback" aria-hidden="true">' + safe(username.charAt(0).toUpperCase()) + '</span>';
    const banner = cover ? ' style="background-image:linear-gradient(90deg,#121c2de0,#121c2d86),url(&quot;' +
      safe(cover) + '&quot;)"' : "";
    const subline = account ? (safe(account.country_code || "—") + " · ID " + safe(account.id) +
        " · " + safe((account.refreshed_at || "").slice(0, 10)) + " 공개 통계") :
      "이 브라우저에 계정 저장됨 · 공개 통계 연결 대기";
    let stats = "";
    if (account) {
      const items = [
        ["PP", rank.pp == null ? "—" : commas(Math.round(rank.pp))],
        ["세계 순위", rank.global_rank == null ? "—" : "#" + commas(rank.global_rank)],
        ["국가 순위", rank.country_rank == null ? "—" : "#" + commas(rank.country_rank)],
        ["정확도", rank.hit_accuracy == null ? "—" : Number(rank.hit_accuracy).toFixed(2) + "%"],
        ["플레이 수", rank.play_count == null ? "—" : commas(rank.play_count)],
        ["최대 콤보", rank.maximum_combo == null ? "—" : commas(rank.maximum_combo)]
      ];
      stats = '<div class="metrics profile-stats">' + items.map(([name, val]) =>
        '<div class="metric"><b>' + safe(val) + '</b><span>' + safe(name) + '</span></div>'
      ).join("") + '</div>';
      if (status) status.textContent = "서버가 공식 osu! API에서 가져온 공개 프로필 정보를 표시 중입니다. 최신 기록과 다를 수 있어요.";
    } else {
      stats = '<div class="subtle-panel"><p><b>공식 기록은 아직 연결되지 않았어요.</b></p>' +
        '<p class="hint-text">이 화면은 계정 링크를 저장한 상태입니다. GitHub Pages에는 실시간 osu! API 인증 서버가 없으므로 PP·순위는 임의로 표시하지 않습니다. ' +
        '사이트 운영자가 저장소 변수 <code>OSU_PROFILE_USERNAME</code>에 해당 계정을 지정하면 GitHub Actions가 공개 통계를 주기적으로 가져옵니다.</p></div>';
      if (status) status.textContent = publishedChecked ?
        "계정 즐겨찾기는 완료 · 해당 계정의 공식 공개 통계 파일은 아직 없습니다." :
        "계정 즐겨찾기 완료 · 공개 프로필 통계 확인 중…";
    }
    if (result) result.innerHTML = '<div class="profile-cover"' + banner + '>' +
      '<div class="profile-identity">' + photo + '<div><span class="profile-kicker">OSU!STANDARD PROFILE</span>' +
      '<h2>' + safe(username) + '</h2><p class="muted">' + subline + '</p></div></div></div>' +
      stats + '<div class="profile-actions">' +
      '<a class="hero-primary" href="' + safe(link) +
      '" target="_blank" rel="noopener noreferrer">osu! 공식 프로필 열기 ↗</a>' +
      '<button type="button" id="profileChange" class="ghost-btn">다른 계정 선택</button></div>';
    $p("profileChange")?.addEventListener("click", () => {
      $p("profileUserInput")?.focus();
      $p("profileUserInput")?.select();
    });
    if (home) home.innerHTML = '<div class="profile-home-compact">' + photo +
      '<div><b>' + safe(username) + '</b><span>' +
      (account?.statistics?.pp != null ? commas(Math.round(account.statistics.pp)) + 'pp · ' +
      (account.statistics.global_rank ? "#" + commas(account.statistics.global_rank) : "세계 순위 —") :
      "공식 프로필 링크 저장됨") + '</span></div></div><button type="button" data-tab="profile" class="ghost-btn">프로필 보기 ↗</button>';
  }

  async function checkPublished() {
    if (publishedChecked) return published;
    if (loading) return loading;
    loading = (async () => {
      try {
        const response = await fetch("./data/osu-profile.json", {cache:"no-store"});
        if (!response.ok) return null;
        const value = await response.json();
        if (value?.format === "osu-skill-lab-public-profile" &&
            value.mode === "osu" && value.id && value.username) published = value;
      } catch (err) {
        console.info("Optional public profile snapshot unavailable", err);
      } finally {
        publishedChecked = true;
        loading = null;
        render();
      }
      return published;
    })();
    return loading;
  }
  const form = $p("profileForm");
  form?.addEventListener("submit", event => {
    event.preventDefault();
    const text = clean($p("profileUserInput")?.value);
    if (!text) return;
    chosen = text;
    try {localStorage.setItem(STORE,chosen);} catch (_) {}
    render();
    checkPublished();
  });

  // Profile data are optional, so never block HOME or Ranked from rendering.
  render();
  if (chosen) checkPublished();
  return {open: () => { render(); checkPublished(); }, refresh: () => {
    publishedChecked = false;
    return checkPublished();
  }};
})()
window.OSLProfile = OSLProfile;
