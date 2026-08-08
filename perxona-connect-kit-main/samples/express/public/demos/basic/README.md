<!-- markdownlint-disable MD013 -->

# Basic Demo

This demo shows the core `<sv-presenter>` integration: pick an avatar, launch the presenter, and make it speak. It covers the essentials that every Perxona Connect integration needs:

1. **Catalog browsing** — fetch avatars, scenes, and voices from the Connect API and populate dropdowns.
2. **Presenter initialization** — exchange server credentials for a Connect bearer token and pass it to `presenter.initialize()`.
3. **Driving speech** — send text to `presenter.present()` and the avatar speaks with matching gestures; or supply your own audio file via `presenter.presentWithAudio()`.
4. **LLM chat** _(opt-in)_ — pipe an OpenAI-compatible chat reply back through `presenter.present()` so the avatar speaks each response.

---

## File Structure

```text
demos/basic/
├── index.html   — page layout (sidebar controls + presenter stage)
├── app.js       — all client-side logic (catalog, initialization, playback, chat)
├── style.css    — dark-theme styles scoped to this demo
└── README.md    — this file
```

---

## Prerequisites

The demo runs against the Express server in `express/`. Configure `.env` first:

```sh
PERXONA_API_BASE_URL=https://...
PERXONA_CONNECT_EMAIL=your@email.com
PERXONA_CONNECT_PASSWORD=yourpassword
PRESENTER_URL=https://cdn.perxona.ai/...
```

Start the server from the `express/` directory:

```bash
npm start
# or: npm run dev  (with file-watch reload)
```

Then open: <http://localhost:8083/demos/basic/>

---

## Usage

### Step 1 — Pick Avatar, Scene, and Voice

The sidebar dropdowns are populated automatically from the catalog when the page loads.

- **Avatar** — the character model. A thumbnail preview appears next to the dropdown.
- **Scene** — the background environment. A thumbnail preview appears next to the dropdown.
- **Voice** _(optional)_ — the TTS voice used for speech. Leave blank to use the avatar's default voice.

The **Launch** button stays disabled until both an avatar and scene are selected.

### Step 2 — Launch the Presenter

Click **Launch**. The page:

1. Calls `presenter.resumeAudioPlayback()` to unlock the browser's autoplay policy (this must happen inside the click handler).
2. Fetches a Connect bearer token from `GET /api/connect-token`.
3. Calls `presenter.initialize(connectToken, { avatarId, sceneId, voiceId })` — the widget resolves the target and mints its own speech token directly against the Connect API.
4. Waits for the `PRESENTER_STATUS → Ready` event, then reveals the stage and the playback controls.

### Step 3 — Make the Avatar Speak

Once the presenter is **Ready**, the playback controls appear in the sidebar.

**Preset buttons** — click any preset to instantly play a canned line:

| Button   | Text sent to presenter       |
| -------- | ---------------------------- |
| Greet    | `Hello! Welcome to Perxona!` |
| Excited  | `I'm so excited!`            |
| Thinking | `Let me think…`              |
| Farewell | `Goodbye!`                   |

**Free text** — type any text in the input box and press **Send** (or Enter). The avatar speaks it with matching gestures.

**Present with audio** — select an audio file and type the accompanying transcript, then click **Send**. The avatar lip-syncs to the supplied audio without making a TTS call. Useful for pre-recorded lines.

**Stop** — click **Stop** to interrupt the current performance immediately and clear the playback queue.

### Step 4 — Chat _(optional)_

The Chat panel appears automatically when `LLM_API_KEY` is set in `.env`. If the key is missing, a hint is shown instead.

Type a message and press **Send** (or Enter):

1. The message is appended to the conversation history and sent to `POST /api/chat`.
2. The assistant's reply appears in the chat log.
3. The reply is also passed to `presenter.present()` — the avatar speaks it aloud.

---

## API Flow

```text
Browser                  Express Proxy              Connect API / LLM
  │                           │                              │
  │  GET /api/config          │                              │
  ├──────────────────────────►│ (presenterUrl, chat flag)    │
  │◄──────────────────────────┤                              │
  │                           │                              │
  │  GET /api/avatars|scenes|voices                          │
  ├──────────────────────────►│                              │
  │                           │  GET /api/v1/connect/…       │
  │                           ├─────────────────────────────►│
  │                           │◄─────────────────────────────┤
  │◄──────────────────────────┤                              │
  │                           │                              │
  │  GET /api/connect-token   │                              │
  ├──────────────────────────►│  (validates cached token)    │
  │◄──────────────────────────┤  { connect_token }           │
  │                           │                              │
  │  presenter.initialize(connectToken, target)              │
  │─────────────────────────────────────────────────────────►│  (Connect API, internal to widget)
  │                           │                              │
  │  presenter.present(text)                                 │
  │─────────────────────────────────────────────────────────►│  (Connect Presentation API)
  │                           │                              │
  │  POST /api/chat           │                              │
  │  { messages: [...] }      │                              │
  ├──────────────────────────►│  POST /v1/chat/completions   │
  │                           ├─────────────────────────────►│  (LLM endpoint)
  │                           │◄─────────────────────────────┤
  │◄──────────────────────────┤  { choices[0].message }      │
  │                           │                              │
  │  presenter.present(reply)                                │
  │─────────────────────────────────────────────────────────►│
```

---

## Key Presenter API

| Method                                          | When to call                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `presenter.resumeAudioPlayback()`               | Inside the launch click handler — unlocks browser autoplay before audio starts |
| `presenter.initialize(token, target)`           | Once, after obtaining the Connect token — resolves avatar/scene/voice          |
| `presenter.present(text)`                       | Every time the avatar should speak a line of text                              |
| `presenter.presentWithAudio(arrayBuffer, text)` | When you supply your own audio and want lip-sync driven by the transcript      |
| `presenter.interruptPresentation()`             | To stop the current speech and clear the queue                                 |

Listen for `PRESENTER_STATUS` events on the `<sv-presenter>` element to track state transitions (`Uninitialized → Initializing → Ready`).

---

## Server-side Proxy Routes

| Method | Path                 | Upstream endpoint                                      |
| ------ | -------------------- | ------------------------------------------------------ |
| `GET`  | `/api/config`        | Static — returns `{ mock, chat, presenterUrl }`        |
| `GET`  | `/api/connect-token` | Validates cached token → `{ connect_token }`           |
| `GET`  | `/api/avatars`       | `GET /api/v1/connect/assets/avatars`                   |
| `GET`  | `/api/scenes`        | `GET /api/v1/connect/assets/scenes`                    |
| `GET`  | `/api/voices`        | `GET /api/v1/connect/voices`                           |
| `POST` | `/api/chat`          | `POST <LLM_BASE_URL>/chat/completions` (OpenAI format) |

---

## Extending the Demo

### Add more preset lines

Edit the `.btn-preset` buttons in `index.html` — change `data-text` to any line you want the avatar to speak:

```html
<button class="btn-preset" data-text="Today's weather looks great!">
  Weather
</button>
```

### Change the default avatar or scene

The dropdowns are populated from the catalog on load. To pre-select a specific item, pass its `id` to `avatarSelect.value` / `sceneSelect.value` after `loadCatalog()` resolves, then call `updateInitBtn()`.

### Enable chat

Set `LLM_API_KEY` in `.env`. Optionally set `LLM_BASE_URL` to point at an Ollama or other OpenAI-compatible endpoint, and `LLM_MODEL` to select the model:

```sh
LLM_API_KEY=sk-...
LLM_BASE_URL=http://localhost:11434/v1   # Ollama
LLM_MODEL=llama3
```

### Go further — Chatbot demo

The [Chatbot demo](../chatbot/) builds on this foundation. It adds full chatbot CRUD (create, configure, and delete chatbots via the Connect API), a persistent multi-turn conversation, and function tool support for calling external APIs during chat.
