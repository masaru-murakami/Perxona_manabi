# Repository Guidelines

The **Perxona Connect Kit — Motion Browser** is a web UI for previewing and controlling Perxona avatars
through the **Connect API** and the `<sv-presenter>` avatar Web Component (Presenter SDK). Sign in, pick an
avatar/scene/voice, browse and preview motions, and make the avatar speak and perform — then use it as a
reference client or as a starting point for your own avatar control panel.

## Architecture

### Auth model

Sign-in is fully client-side — there is no backend proxy. `components/custom/login-screen.tsx` collects
Perxona credentials; `lib/auth.ts` calls the Connect API directly from the browser and keeps the bearer
token in memory plus `sessionStorage` (cleared when the tab closes). `hooks/use-auth.ts` is the React
binding on top of that module-scoped store. `lib/api.ts` attaches the stored token as a Bearer header on
every authenticated request and automatically signs the user out on a `401`.

### Presenter lifecycle

`hooks/use-presenter.ts` loads the `<sv-presenter>` engine script from the CDN URL returned by the API's
`getConfig()` and exposes an imperative handle to it. `hooks/use-avatar-session.ts` bridges the Connect API
and the presenter:

- `launch` mints a Connect token, then calls `presenter.initialize()` with the chosen avatar/scene/voice.
- `speak` calls `presenter.present(text)` directly — the widget builds the performance (speech + motion)
  internally against the Connect API; there is no client-side presentation-building step.
- `presenter.resumeAudioPlayback()` (wrapped as `resumeAudio()`) must run from a direct user gesture (the
  Play click) to satisfy browser autoplay policy.
- This tool does not implement Connect-token refresh: on `CONNECT_TOKEN_EXPIRED` the session is simply
  cleared and the user is routed back to the login screen.

### Data fetching

Catalog and motion data go through TanStack Query. `hooks/use-catalog.ts` loads avatars, scenes, and voices
as independent queries (each caches/retries on its own); `hooks/use-motions.ts` loads the motion list for
the currently selected avatar.

### UI composition

`App.tsx` is the auth gate plus top-level layout. `components/custom/` holds the app-specific screens and
controls — avatar picker, scene/voice select, motion library, script composer, presenter stage and control
bar, app header. `components/ui/` holds shadcn/ui primitives; keep new UI on top of those rather than
introducing a different component library. `script-composer.tsx` mixes free text with motion "chips" —
the avatar performs the resulting script in sequence when you press Play.

## Project Structure

See `README.md`'s Project Structure section for the full file layout.

## Getting Started

See `README.md` for setup (`pnpm install`, `cp .env.example .env`, `pnpm dev`).

## Coding Style

TypeScript + React function components with hooks. Tailwind CSS + shadcn/ui for styling — follow the
existing component patterns rather than introducing a different styling approach. Keep the app
dependency-light; there is no backend proxy layer here to extend.

## Configuration

`VITE_PERXONA_API_BASE_URL` and `VITE_PRESENTER_URL` — see `README.md`'s Environment Variables section.
`.env` is git-ignored; never commit real values.
