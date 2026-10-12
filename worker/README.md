# osu! Skill Lab profile Worker

This Worker is an optional secret-backed proxy for **public osu!standard profile statistics**. The public GitHub Pages site never receives or stores the osu! OAuth Client Secret, and returned profile stats are kept in the visitor's browser localStorage.

## Cloudflare dashboard setup

1. Register an OAuth application in osu! account settings. Client Credentials only needs the Client ID and Client Secret; keep the secret private.
2. In Cloudflare, create a Worker, open its code editor, and replace the starter code with `osu-profile-worker.mjs`.
3. In **Settings → Variables and Secrets**, add:
   - `OSU_CLIENT_ID` — Secret
   - `OSU_CLIENT_SECRET` — Secret
   - `SITE_ORIGIN` — Variable, value `https://epicenterguy.github.io`
4. Deploy the Worker and copy only its HTTPS base URL, for example `https://osu-skill-lab-profile.example.workers.dev`.
5. Open osu! Skill Lab → **My osu! Profile**, save a username or numeric user ID, paste the Worker base URL, then choose **Worker 연결 · 갱신**.

Do **not** append `/profile` to the URL entered in Skill Lab. The browser adds that path itself.

Opening the Worker URL directly in a browser tab can return **403 Forbidden** because the Worker only accepts requests whose `Origin` exactly matches `SITE_ORIGIN`. Test it through the Skill Lab profile panel instead.

## Wrangler alternative

Copy `wrangler.toml.example` to `wrangler.toml`, then set secrets without writing them into the config:

```sh
npx wrangler secret put OSU_CLIENT_ID
npx wrangler secret put OSU_CLIENT_SECRET
npx wrangler deploy
```

Never commit real Client Secrets, access tokens, or profile snapshots.

## Data flow

The browser sends the requested username/ID to this Worker only during refresh. The Worker obtains a Client Credentials token, fetches the public osu!standard profile, strips the response to an allowlist of public statistics, and returns it with `Cache-Control: no-store`. No KV, Durable Object, database, or application-level profile log is used by this source code. Cloudflare and osu! may still retain infrastructure/access logs according to their own policies.
