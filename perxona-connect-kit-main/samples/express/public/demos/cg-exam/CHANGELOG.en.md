# cg-exam — Development Summary (2026-09-11 to 2026-09-12)

*[日本語版はこちら](CHANGELOG.md)*

This document summarizes the new development and features added to the `cg-exam` demo (the CG
Creator Certification mock-exam app, live at https://perxona-manabi.netlify.app/ ) over a two-day
development session. It's organized by feature area, based on the git commit history
(`9987194`…`54b1c96`, 28 commits total).

Affected files: `samples/express/public/demos/cg-exam/` (`index.html` / `avatar.js` / `avatar.css` /
`analytics.html` / `data/*.json`), `samples/express/server.mjs`, and its mirror,
`deploy/netlify-cg-exam/` (Netlify Functions + the matching set of static files).

---

## 1. Free-text "Ask the AI" question form

- Added a free-text question input to the avatar panel, with voice input (a 🎤 button via the Web
  Speech API).
- Fixed the reply to **strictly follow the UI language toggle** regardless of what language the
  question itself was typed in (it originally could get pulled into answering in the question's
  language instead).

## 2. Learner question-log analytics

- Added backend logging for every question and hint:
  - Express: `POST /api/log-question` (appends to a local JSONL file), `GET /api/analytics`
    (password-protected)
  - Netlify: an equivalent pair of Functions backed by `@netlify/blobs`
- Built a new password-gated analytics dashboard, `analytics.html`:
  - Totals for free questions, hints, successful replies, and per-language counts
  - A by-domain bar chart and a 14-day daily-count chart
  - A searchable question-log table
  - A discreet link from the exam home screen's footer

## 3. "Hint" feature (designed to never reveal the answer)

- Added a "Hint" button that has the AI explain what a question is actually asking — **never**
  touching the correct answer, by strict prompt design.
- Iterated based on feedback into its current shape:
  - Tightened the opening explanation to roughly 200 characters
  - Evolved from a single canned reply into a **multi-turn Socratic dialogue**, reusing the same
    ask-form input
  - Explicitly nudges the learner toward process-of-elimination reasoning with a guiding question

## 4. Avatar bug fixes

- **Silent hint bug**: fixed a case where the Hint's text appeared but no audio played — a race
  condition where `speak()` could fire before the Presenter SDK reported "Ready".
- **Speech interruption**: every button action now stops the avatar's current speech before
  starting a new one, instead of queuing behind it.
- **Blank error messages**: fixed learner-facing error text that came out empty, caused by
  HTTP/2's `statusText` always being an empty string (no reason phrase in that protocol).

## 5. Generalizing the app (full refactor to a data-driven architecture)

The app was originally hardcoded for a single certification (CG Creator Certification). It was
refactored so that **adding a new certification requires only a new JSON data file** — no code
changes.

- Externalized all question content, domains, domain counts, questions-per-domain, set count, pass
  mark, and time limit into `data/<exam-id>.json`
- Added `data/manifest.json` listing available certifications, and a new picker screen on the home
  page to choose one
- Split on-screen text into two layers: app-wide strings (language-only) and exam-specific strings
  (rebuilt from that exam's own numbers)
- Updated the avatar (`avatar.js`) to never hardcode a certification name — it now reads the loaded
  exam's title from `onExamLoad()`

### Certifications added (as pure data, thanks to the refactor)

1. **World Heritage Study Certification, Level 2** — modeled on the real exam's published
   format/category breakdown, with 100% original question content written fresh. 150 questions,
   bilingual (JA/EN).
2. **CG Creator Certification, Basic** — the pre-existing question data, externalized into JSON
   (later fully rewritten — see below).
3. **CG Creator Certification, Expert** — using only the chapter/topic structure of a PDF exam-prep
   book the user provided as a non-copyrighted reference; every question written entirely fresh.
   150 questions, bilingual (JA/EN).

## 6. CG Creator Certification Basic question-bank rewrite

- In response to feedback that answer choices ("香盤表" etc.) recurred too often, analyzed the
  existing 300-question bank's distractor repetition.
- Rebalanced choices per domain using a vocabulary-based reassignment, cutting the maximum
  repetition of any single term from 11 down to 5.
- Found and fixed a few questions that tested the exact same fact twice; replaced the duplicates
  with new distinct concepts.
- Changed question order within a set from grouped-by-domain to shuffled (and fixed two bugs
  uncovered in the process: the on-screen question label still assumed block order after the
  shuffle, and `view()` was dropping the field that label needed).

## 7. Picker and navigation improvements

- Sorted the certification picker (CG Basic → CG Expert → World Heritage, grouping the two
  CG-ARTS-style exams together)
- Added a "Choose another exam" control — initially placed separately on each screen, later
  consolidated into a **single button fixed below the language toggle**, visible on every exam
  screen (confirms before leaving mid-quiz, switches immediately from the result screen)
- Added a link to the analytics dashboard at the bottom of the picker screen too, and made both
  analytics links open in a new tab
- Added a matching link from the analytics dashboard back to the picker, also opening in a new tab

## 8. Analytics dashboard enhancements

- **English localization**: added a JA/EN toggle translating every stat, chart, table header, tag,
  and timestamp format.
- **Merged by-domain counts**: logged entries store whichever language's domain name was on screen
  at log time, so the same domain was splitting into two separate bars depending on which language
  a question was asked in. Built a JA↔EN domain-name map from each certification's own data file,
  and now canonicalize entries before counting so they merge into one bar, labeled in the current
  UI language.
- **CSV export**: added a button to download the (optionally search-filtered) question log as a
  UTF-8-with-BOM CSV file, so it opens correctly in Excel.
- **User column**: added a column showing who logged each question (see section 9).

## 9. User identity and personalization

- Added an optional name field on the picker screen (saved to `localStorage`, attached to every
  question/hint this browser logs from then on).
- Added a "Get Started" button. Clicking it:
  - increments a local **visit count** for this browser
  - fetches this browser's own **question count** from the server via a new unauthenticated
    `GET /api/my-stats?sessionId=...` endpoint (scoped to just the caller's own session — no
    analytics password required)
  - computes a **five-tier user rank** (Beginner → Bronze → Silver → Gold → Platinum) from a score
    of `questionCount*2 + usageCount`
  - has the avatar deliver an encouraging greeting that references the learner's name, rank, and
    question history
- Bug found while building this: the fixed-position avatar panel (`z-index: 40` in `avatar.css`)
  visually overlaps some buttons near the bottom of a screen, and — because it sits above ordinary
  page content regardless of DOM order — a real mouse click there was silently swallowed by its
  `<iframe>` instead of reaching the button underneath (a scripted `.click()` call didn't reproduce
  it, which is why it went unnoticed at first). Fixed for every screen at once by giving the shared
  `.wrap` container `z-index: 41`.

## 10. Avatar voice and persona tuning

- Switched both the English and Japanese avatar voices to a younger-sounding "cute and fast" voice
  pair.
- Changed the default background scene to "Outdoor school" (no `.env` change or redeploy needed).
- **Changed the avatar's persona from "home tutor" to a cheering companion who studies alongside
  the learner** — rewrote every LLM prompt's persona framing consistently so the tone reads as a
  peer, not an instructor.

## 11. Picker screen visual refresh

- Integrated a CSS design pack the user provided (a gradient background plus an inline-SVG motif
  for each of the three certifications):
  - CG Creator Certification, Basic — an isometric cube
  - CG Creator Certification, Expert — a wireframe sphere
  - World Heritage Study Certification — a mountain + classical-architecture motif
- Added an "Explain" button beside each certification card; clicking it has the avatar introduce
  that certification in roughly 400 characters (60-70 words in English).
- Moved the name field above the certification grid.

---

## Technical notes

- **Copyright care**: none of the World Heritage or CG Creator Expert questions reuse actual text
  from any official site or third-party PDF/article — only publicly available structural
  information (category/chapter breakdowns) was used as reference, and every question was written
  fresh.
- **Data-driven design**: adding a certification needs no code changes — just a new
  `data/<id>.json` file and one entry in `manifest.json`.
- **Dual maintenance (Express / Netlify)**: `samples/express/` is the primary development source;
  changes are manually mirrored into `deploy/netlify-cg-exam/` after each feature (server-side
  routes are implemented separately in `server.mjs` and the matching `netlify/functions/*.mjs`
  files).
- **Verification approach**: every feature was checked against a live local server
  (`npm run dev`, port 8083) via real browser interaction, then confirmed live on Netlify before
  being considered complete.

## Commit list (chronological)

```
9987194 Add free-text "ask the AI" question form to cg-exam avatar panel
9960123 Merge feature/cg-exam-ask-question: free-text AI question form for cg-exam
99c101e Fix ask-question form answering in the wrong language after a lang toggle
b423f3e Force ask-question answers to strictly follow the UI language toggle
f021be6 Add voice input (mic button) to the ask-question form
c1c1eb7 Add learner question analytics: logging + a password-gated view
44d4319 Add a discreet analytics.html link to the cg-exam home screen footer
fc15552 Add a "Hint" button that never reveals the answer
22afea0 Fix blank error messages (requestJson's statusText fallback is always "" over HTTP/2)
b65b438 Fix silent Hint audio: speak() could fire before the presenter was Ready
6f31d4b Turn "Hint" into a multi-turn Socratic dialogue instead of a one-shot answer
af01425 Tighten the opening Hint to ~200 characters total
348d1bc Stop the avatar's current speech whenever a new action is triggered
b8f665d Nudge Hint's guiding questions toward process-of-elimination reasoning
818121e Generalize the mock-exam app: data-driven exams selected from a picker
d7911cb Add World Heritage Study Certification (世界遺産検定) Level 2 mock exam
95078eb Add CG Creator Certification Expert mock exam
1305ea8 Rewrite CG Creator Certification Basic question bank
8b999d0 Sort exam picker: group CG Creator certs before World Heritage
0edbcc4 Reduce answer repetition in CG Basic bank; randomize set order
886dbf2 Use a younger-sounding voice for the English avatar
7e633b2 Add "Choose another exam" button to the quiz and result screens
83bbb45 Add English localization to the question-log analytics dashboard
290c754 Fix analytics domain translation; move exam-switch button under lang toggle
3edde10 Add cross-links between picker/analytics, per-exam Explain button, younger JA voice
57f6151 Default outdoor scene, optional username field, CSV export
f9be44d Add "Get Started" button with personal stats and a track-record-aware greeting
54b1c96 Colorful exam banners, name form reorder, 5-tier rank, companion persona
```
