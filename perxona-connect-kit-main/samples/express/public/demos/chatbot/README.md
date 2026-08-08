<!-- markdownlint-disable MD013 -->

# Chatbot Demo

This demo shows how to integrate the **Perxona Connect Chatbot API** with the `<sv-presenter>` Web Component. A developer can:

1. **Manage chatbots** — create, read, update, and delete chatbots through the Connect API (full CRUD).
2. **Hold a multi-turn conversation** — each user message is sent to the chatbot; the assistant reply is displayed in the chat log.
3. **Hear every reply spoken aloud** — the assistant reply is piped directly into `sv-presenter.present()`, so the avatar speaks the response in real time.

---

## File Structure

```text
demos/chatbot/
├── index.html   — page layout (sidebar + presenter stage + chat panel)
├── app.js       — all client-side logic (CRUD, chat, presenter integration)
├── style.css    — dark-theme styles scoped to this demo
└── README.md    — this file
```

---

## Prerequisites

> For full server setup instructions, environment variable reference, and the complete route table, see the [Express sample README](../../../README.md).

The demo shares the same Express server as the Basic demo (`server.mjs`). No extra setup is needed beyond the standard `.env` configuration:

```sh
PERXONA_API_BASE_URL=https://...
PERXONA_CONNECT_EMAIL=your@email.com
PERXONA_CONNECT_PASSWORD=yourpassword
PRESENTER_URL=https://cdn.perxona.ai/...
```

Start the server from the `express/` directory:

```bash
npm start
# or: node server.mjs
```

Then open: <http://localhost:8083/demos/chatbot/>

---

## Usage

### Step 1 — Launch the Presenter

Pick an **Avatar**, **Scene**, and optionally a **Voice** from the dropdowns on the left, then click **Launch Presenter**. The avatar loads in the right-hand stage.

### Step 2 — Set Up a Chatbot

**Select an existing chatbot** from the dropdown, or click **+ New Chatbot** to create one:

1. Click **+ New Chatbot** — the editor expands.
2. Enter a **Name** (required) and optional **System Instructions** that define the chatbot's persona and knowledge scope.
3. Click **Save** — the chatbot is created via `POST /api/v1/connect/chatbots` and immediately selected.

To **edit** an existing chatbot, select it from the dropdown, then expand the **Create / Edit** section. Changes are saved via `PATCH /api/v1/connect/chatbots/:id`.

To **delete** a chatbot, click the red **✕** button next to the dropdown and confirm.

### Step 3 — Chat

Once a chatbot is selected, the chat panel appears at the bottom. Type a message and press **Send** (or Enter):

- The avatar enters **Thinking** state while the LLM processes the request.
- The assistant's reply appears in the chat log.
- If the presenter is **Ready**, the reply is automatically passed to `presenter.present(reply)` — the avatar speaks it aloud with matching gestures. If the presenter is not yet launched, the chat still works as text-only.

---

## API Flow

```text
Browser                  Express Proxy              Connect API
  │                           │                          │
  │  POST /api/chatbots        │                          │
  │  { name, instructions }   │                          │
  ├──────────────────────────►│                          │
  │                           │  POST /api/v1/connect/chatbots  (multipart/form-data)
  │                           ├─────────────────────────►│
  │                           │◄─────────────────────────┤  { id, name, status, … }
  │◄──────────────────────────┤                          │
  │                           │                          │
  │  POST /api/chatbots/:id/chat                         │
  │  { messages: [{role,parts},...] }                    │
  ├──────────────────────────►│                          │
  │                           │  POST /api/v1/connect/chatbots/:id/chat
  │                           ├─────────────────────────►│
  │                           │◄─────────────────────────┤  { status, reply_text }
  │◄──────────────────────────┤                          │
  │                           │                          │
  │  presenter.present(reply_text)  (directly via SDK)   │
  │─────────────────────────────────────────────────────►│  (Connect Presentation API)
```

---

## Message Format

The Connect chatbot API uses a **parts-based message format**, which is different from the OpenAI `content: string` format:

```js
// Correct — Connect format
{ role: "user", parts: [{ type: "text", text: "Hello!" }] }

// Not used here — OpenAI format
{ role: "user", content: "Hello!" }
```

The demo accumulates `chatHistory` in Connect format. To avoid upstream timeouts caused by long prompts (Gemini has a fixed backend deadline), the API call sends only the most recent 20 messages as a sliding window — 10 user turns and 10 assistant turns. The full history is preserved in the chat log display.

---

## Server-side Proxy Routes

The Express server adds these routes to proxy the Connect API:

| Method   | Path                          | Upstream endpoint                                       |
| -------- | ----------------------------- | ------------------------------------------------------- |
| `GET`    | `/api/chatbots`               | `GET /api/v1/connect/chatbots`                          |
| `POST`   | `/api/chatbots`               | `POST /api/v1/connect/chatbots` (multipart)             |
| `GET`    | `/api/chatbots/:id`           | `GET /api/v1/connect/chatbots/:id`                      |
| `PATCH`  | `/api/chatbots/:id`           | `PATCH /api/v1/connect/chatbots/:id` (multipart)        |
| `DELETE` | `/api/chatbots/:id`           | `DELETE /api/v1/connect/chatbots/:id`                   |
| `POST`   | `/api/chatbots/:id/knowledge` | `PATCH /api/v1/connect/chatbots/:id` (knowledge_file)   |
| `DELETE` | `/api/chatbots/:id/knowledge` | `PATCH /api/v1/connect/chatbots/:id` (remove_knowledge) |
| `POST`   | `/api/chatbots/:id/chat`      | `POST /api/v1/connect/chatbots/:id/chat`                |

> **Why multipart?** The upstream `create` and `update` endpoints use `multipart/form-data` to support optional `knowledge_file` uploads. The Express proxy accepts plain JSON from the browser and re-encodes it as `FormData` before forwarding — so the demo client stays simple.

---

## Extending the Demo

### Add Function Tools

Chatbots can call external HTTP APIs via **function tools**. Tools are defined as a JSON array and passed in the `tools` field when creating or updating a chatbot. See [`docs/connect-chat-bot-function-tools.md`](docs/connect-chat-bot-function-tools.md) for the full specification.

Example — add a weather lookup tool when creating a chatbot via `POST /api/chatbots`:

```json
{
  "name": "Weather Bot",
  "custom_instructions": "You are a weather assistant. Use the weather_lookup tool to answer questions.",
  "tools": [
    {
      "name": "weather_lookup",
      "description": "Look up current weather for a city. Use when the user asks about the weather.",
      "settings": {
        "request": {
          "method": "get",
          "url": "https://wttr.in",
          "query_params": {
            "type": "object",
            "properties": {
              "format": {
                "type": "string",
                "description": "Response format, use '3'"
              },
              "location": {
                "type": "string",
                "description": "City name in English"
              }
            },
            "required": ["location", "format"]
          }
        },
        "auth": { "secret_type": "no_auth" },
        "response": { "body_schema": {} }
      }
    }
  ]
}
```

### Add a Knowledge File

The **Knowledge File** section in the chatbot editor is already implemented. Click **Choose file…**,
select a `.txt`, `.pdf`, `.doc`, `.docx`, or `.csv` file, then click **Save** — the file is uploaded automatically.

Under the hood:

1. The browser reads the file and base64-encodes it.
2. A `POST /api/chatbots/:id/knowledge` call sends `{ filename, content_base64, mime_type }` to the
   Express server (up to ~7.5 MB).
3. The server converts the payload back to a `Buffer`, wraps it in `FormData`, and `PATCH`es the
   upstream chatbot with `knowledge_file`.
4. The status badge updates to `Processing…` and then `Ready` once the upstream finishes indexing.

To remove the knowledge file, click the **Remove** button — the server sends `PATCH` with
`remove_knowledge=true`.

### Use a Chatbot ID in `initialize()`

Not yet supported: `PresentationTarget` currently only accepts an explicit `avatarId` / `sceneId` /
`voiceId?` combination (see `@perxona/presenter-types`). Resolving a target directly from a chatbot
ID is a possible future addition, not the current contract — this demo resolves `avatarId` /
`sceneId` itself (see `app.js`) and passes those to `initialize()`.
