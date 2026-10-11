/* osu! Skill Lab — local-only profile shortcut.
 * Username is saved exclusively to this browser's localStorage.
 * No network API calls or public GitHub data files are used for the profile.
 * External osu! profile page opens only after the user clicks its link.
 */
const OSLProfile = (() => {
  const KEY = "osl-profile-username";
  const byId = id => document.getElementById(id);
  const escapeHtml = value => esc(String(value ?? ""));
  const clean = value => String(value ?? "").trim().slice(0, 60);
  const userLink = name => "https://osu.ppy.sh/users/" + encodeURIComponent(name);
  let username = "";
  try { username = clean(localStorage.getItem(KEY)); } catch (_) {}

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
    const avatar = '<span class="profile-avatar profile-avatar-fallback" aria-hidden="true">' +
      escapeHtml(username.charAt(0).toUpperCase()) + '</span>';
    const link = escapeHtml(userLink(username));
    if (status) status.textContent =
      "내 브라우저 전용 · 계정 정보는 외부 서버나 공개 저장소에 업로드하지 않습니다.";
    if (result) result.innerHTML =
      '<div class="profile-cover"><div class="profile-identity">' + avatar +
      '<div><span class="profile-kicker">LOCAL-ONLY OSU! PROFILE</span><h2>' + name +
      '</h2><p class="muted">이 기기의 브라우저에만 저장된 프로필 바로가기</p></div></div></div>' +
      '<div class="subtle-panel"><b>개인 프로필 모드</b><p class="hint-text">' +
      'osu! 닉네임은 이 브라우저에만 저장됩니다. 다른 방문자는 자신의 계정을 별도로 등록할 수 있고, ' +
      '공개 사이트에는 내 PP·랭크·플레이 기록을 게시하지 않습니다. ' +
      'GitHub Pages만으로는 각 계정의 최신 통계를 비공개로 가져올 인증 기능이 없어 숫자를 임의로 표시하지 않습니다.' +
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
      try { localStorage.removeItem(KEY); } catch (_) {}
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
    try { localStorage.setItem(KEY, next); } catch (_) {}
    render();
  });

  render();
  return { open: render, refresh: render };
})();
window.OSLProfile = OSLProfile;
