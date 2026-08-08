<!-- markdownlint-disable MD013 -->

# CG Creator Certification — Mock Exam (with Perxona Avatar)

A CG-ARTS-style "CGクリエイター検定 ベーシック" mock exam (20 sets, 40 questions each, 10 subject
areas), with a floating Perxona avatar companion layered on top via the Presenter SDK.

This demo composes two independent pieces:

- **The quiz engine** (`index.html`'s inline `<script>`) — a self-contained bilingual (EN/JA) exam
  app with exam/practice modes, a radar chart score breakdown, and a review screen. It has no
  knowledge of Perxona; it only calls a handful of `window.CGExamAvatar.*` hooks if they exist.
- **`avatar.js`** — the Perxona Presenter integration. It implements those hooks and never reaches
  into the quiz engine's internals.

---

## What the avatar does

| Quiz moment                          | Avatar behavior                                                                 | LLM used? |
| ------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| Exam/practice set starts              | Speaks a canned greeting line + a "greeting"-ish motion                          | No        |
| Practice mode: answer revealed        | Speaks a canned correct/wrong reaction line + matching motion                    | No        |
| "Ask the avatar more" button          | Calls `POST /api/demo-script` for a deeper, avatar-voiced explanation            | Yes       |
| Result screen                         | Calls `POST /api/demo-script` for a spoken score summary + weak-point analysis   | Yes       |

Per-answer reactions are deliberately **not** LLM calls — they fire on every one of 40 questions, so
latency and API cost both need to be zero. The LLM is reserved for the two spots (on-demand
explanation, end-of-exam summary) where a generated response is actually worth the round trip. See
`docs/perxona_docs_summary.md.pdf` §6 in the repo root for the original design note this follows.

Motion IDs are never hard-coded: `avatar.js` fetches the selected avatar's real
`GET /api/avatars/:id/motions` catalog and picks an ID by keyword match against the motion names
(falling back to `DEMO_DEFAULT_MOTION_ID`), so this keeps working even if the catalog changes.

## Prerequisites

Same `.env` as the rest of the Express sample — see [`../../../README` env vars](../../../.env.example).
In particular this demo relies on `DEMO_DEFAULT_AVATAR_ID` / `DEMO_DEFAULT_SCENE_ID` /
`DEMO_DEFAULT_VOICE_ID` / `DEMO_DEFAULT_MOTION_ID` being set (there's no catalog picker UI here —
the avatar panel launches automatically with your account's defaults). Set `LLM_API_KEY` (and
`LLM_PROVIDER`/`LLM_MODEL`) to enable the two LLM-backed features; without it the avatar still
greets and reacts, and shows a plain-text fallback where the LLM would have spoken.

```bash
npm start
```

Open <http://localhost:8083/demos/cg-exam/>.

## Files

```text
demos/cg-exam/
├── index.html    — quiz engine (adapted from the standalone mock exam file) + avatar panel markup
├── avatar.js     — Presenter SDK integration (all window.CGExamAvatar.* hooks)
├── avatar.css    — floating avatar panel styles, scoped under .avatar-panel
└── README.md     — this file
```

## Extending

- **Change the canned reaction lines**: edit `GREETINGS` / `CORRECT_LINES` / `WRONG_LINES` in
  `avatar.js`.
- **Change what the summary/explanation prompts ask for**: edit the prompt strings inside
  `explain()` / `onResult()` in `avatar.js`.
- **Widen motion matching**: `pickMotion()` matches catalog motion *names* against a keyword list —
  add keywords there if your avatar's catalog uses different naming.
