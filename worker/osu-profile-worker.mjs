/**
 * osu! Skill Lab — ephemeral public-profile proxy (Cloudflare Worker).
 * Secrets: OSU_CLIENT_ID, OSU_CLIENT_SECRET (Worker secrets, never in GitHub Pages).
 * Variables: SITE_ORIGIN=https://epicenterguy.github.io
 * No KV, Durable Objects, database, logs, or cache of user data.
 * Client username is transmitted to this Worker and to osu! only when requested.
 */
let bearer = null;
let expiry = 0;
const cors = origin => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Vary": "Origin",
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
});
const respond = (data, status, origin) =>
  new Response(JSON.stringify(data), {status, headers: {...cors(origin), "Content-Type":"application/json; charset=utf-8"}});
async function token(env) {
  if (bearer && Date.now() < expiry - 60000) return bearer;
  const body = new URLSearchParams({
    client_id:String(env.OSU_CLIENT_ID).trim(),
    client_secret:String(env.OSU_CLIENT_SECRET),
    grant_type:"client_credentials",
    scope:"public"
  });
  const response = await fetch("https://osu.ppy.sh/oauth/token", {
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",Accept:"application/json"},
    body,
    signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Error("osu! token unavailable");
  const json = await response.json();
  if (!json.access_token) throw Error("missing osu! token");
  bearer = json.access_token;
  expiry = Date.now() + Math.min(3600,Number(json.expires_in)||3600)*1000;
  return bearer;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.SITE_ORIGIN || "https://epicenterguy.github.io";
    if (origin !== allowed) return new Response("Forbidden", {status:403});
    if (request.method === "OPTIONS")
      return new Response(null, {status:204,headers:cors(origin)});
    if (request.method !== "GET") return respond({error:"Method not allowed"},405,origin);
    const url = new URL(request.url);
    if (url.pathname !== "/profile") return respond({error:"Not found"},404,origin);
    const username = (url.searchParams.get("username")||"").trim();
    if (!/^[\w \[\]{}-]{1,32}$/u.test(username)) return respond({error:"Invalid username"},400,origin);
    if (!env.OSU_CLIENT_ID || !env.OSU_CLIENT_SECRET)
      return respond({error:"Server API credentials not configured"},503,origin);
    try {
      const accessToken = await token(env);
      const key = /^\d+$/.test(username) ? "id" : "username";
      const response = await fetch("https://osu.ppy.sh/api/v2/users/" +
        encodeURIComponent(username) + "/osu?key=" + key, {
        headers:{Accept:"application/json",Authorization:"Bearer "+accessToken},
        signal:AbortSignal.timeout(12000)
      });
      if (response.status === 404) return respond({error:"osu! 계정을 찾을 수 없습니다."},404,origin);
      if (response.status === 429) return respond({error:"osu! 요청 제한. 잠시 후 다시 시도해 주세요."},429,origin);
      if (!response.ok) return respond({error:"osu! API request failed"},502,origin);
      const user = await response.json();
      const st = user.statistics || {};
      const num = value => typeof value === "number" && Number.isFinite(value) ? value : null;
      // Strictly allowlisted public stats, no full upstream response.
      return respond({
        username:String(user.username||""), id:num(user.id),
        statistics:{pp:num(st.pp),global_rank:num(st.global_rank),
          country_rank:num(st.country_rank),hit_accuracy:num(st.hit_accuracy),
          play_count:num(st.play_count),maximum_combo:num(st.maximum_combo)}
      },200,origin);
    } catch (_) {
      return respond({error:"일시적으로 프로필을 가져올 수 없습니다."},502,origin);
    }
  }
};
