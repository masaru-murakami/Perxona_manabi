# cg-exam — Netlify deploy

A minimal, standalone deploy of the [CG Creator Certification mock exam demo](../../samples/express/public/demos/cg-exam/)
for Netlify: static files (`public/`) + four Netlify Functions (`netlify/functions/`) that replace
the parts of `samples/express/server.mjs` this one demo actually calls. It does **not** include the
other Express demos (Basic/Starter/External LLM/Chatbot) or `tools/motion-browser` — those are an
always-on Node process and aren't a fit for Netlify's static+functions model without more work.

`public/index.html` / `avatar.js` / `avatar.css` are plain copies of the demo's files — they already
call relative paths like `/api/config`, so nothing needed to change to point them at Netlify
Functions instead of the Express server.

## 1. Create the site (GitHub-connected)

1. In Netlify: **Add new site → Import an existing project → Deploy with GitHub**, pick this repo
   (`masaru-murakami/Perxona_manabi`).
2. Build settings are already defined by [`/netlify.toml`](../../../netlify.toml) at the repo root
   (`base`, `publish`, `functions`) — Netlify should pick them up automatically, no manual config
   needed on this screen.
3. Deploy. The first build will succeed (the static page loads), but the avatar panel will show an
   error until the environment variables below are set — that's expected.

## 2. Required environment variables

Set these under **Site configuration → Environment variables** in the Netlify dashboard, then
trigger a redeploy (**Deploys → Trigger deploy → Clear cache and deploy site** — functions pick up
env vars at cold start, so a redeploy after adding/changing them is the reliable way to apply them).

| Variable | Required | Notes |
| --- | --- | --- |
| `PERXONA_API_BASE_URL` | Yes | e.g. `https://console.perxona.ai/asia` or your region |
| `PERXONA_CONNECT_EMAIL` | Yes | Same Connect account used locally in `samples/express/.env` |
| `PERXONA_CONNECT_PASSWORD` | Yes | ″ |
| `DEMO_DEFAULT_AVATAR_ID` | Yes | No catalog picker in this demo — copy the value from your local `.env` |
| `DEMO_DEFAULT_SCENE_ID` | Yes | ″ |
| `DEMO_DEFAULT_VOICE_ID` | Recommended | ″ (blank falls back to the avatar's default voice) |
| `DEMO_DEFAULT_MOTION_ID` | Recommended | ″ (fallback motion when keyword matching finds nothing) |
| `PRESENTER_URL` | No | Defaults to the production CDN URL |
| `LLM_API_KEY` | No | Leave unset to disable "Ask the avatar more" + the result-screen summary (everything else still works) |
| `LLM_PROVIDER` | No | `openai` (default) or `anthropic` |
| `LLM_BASE_URL` | No | e.g. `https://api.anthropic.com` when `LLM_PROVIDER=anthropic` |
| `LLM_MODEL` | No | e.g. `claude-sonnet-5` |

These are never committed to the repo — set them only in Netlify's dashboard (or via `netlify env:set`
with the Netlify CLI, if you use that instead of the dashboard).

## 3. Push-to-deploy

Once the site is created, every push to `main` (e.g. from GitHub Desktop) triggers a new build and
deploy automatically — no extra step needed.

## Known limitations vs. the Express version

- **Token cache is best-effort.** `netlify/functions/_lib.mjs` caches the shared Connect login token
  in a module-level variable like `server.mjs` does, but a Netlify Function instance only stays warm
  for a limited time — expect more frequent re-logins than the always-on Express server. Fine for
  demo-level traffic; not a concern to fix unless usage grows.
- **No catalog picker.** This deploy assumes `DEMO_DEFAULT_AVATAR_ID` / `SCENE_ID` / `VOICE_ID` are
  already known (see [`../../samples/express/public/demos/cg-exam/README.md`](../../samples/express/public/demos/cg-exam/README.md)
  for how the values used locally were found via `GET /api/avatars` etc.).
