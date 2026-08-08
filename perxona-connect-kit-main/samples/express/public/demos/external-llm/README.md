# External LLM Demo

This demo shows a safe boundary between an external LLM and `<sv-presenter>`:

1. The browser sends only `avatarId` and a user prompt to `POST /api/demo-script`.
2. Express loads the selected avatar's real motion catalog and gives only those IDs to the model.
3. The server validates the returned `{ reply, script }` before sending it to the browser.
4. The user previews the Motion Markup and explicitly clicks **Run in Presenter**.

Set `LLM_API_KEY` and choose a provider with `LLM_PROVIDER`:

- `LLM_PROVIDER=openai` (default) uses OpenAI Chat Completions. This also supports Ollama and other OpenAI-compatible APIs.
- `LLM_PROVIDER=anthropic` uses Claude's Messages API with `LLM_BASE_URL=https://api.anthropic.com`.

`LLM_BASE_URL` and `LLM_MODEL` are optional. For example, Claude can use
`LLM_MODEL=claude-sonnet-4-20250514`. With `USE_MOCK=true`, the route returns a deterministic script without an LLM key,
but the real Presenter remains disabled because it resolves against the Connect API.

The server never sends `LLM_API_KEY` to browser code. The script uses Motion Markup such as
`[MOTION motion-talking-1:1]`; unknown motion IDs are rejected before they reach `presenter.present()`.
