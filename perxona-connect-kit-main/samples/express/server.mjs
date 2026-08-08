import express from "express";

// ── Config ──────────────────────────────────────────────────

const PORT = process.env.PORT || 8083;
const PERXONA_API_BASE_URL = process.env.PERXONA_API_BASE_URL;
const USE_MOCK = process.env.USE_MOCK === "true";
const PRESENTER_URL =
  process.env.PRESENTER_URL ||
  "https://cdn.perxona.ai/prod/latest/widget/entry/presenter.js";
const DEMO_DEFAULTS = {
  avatarId: process.env.DEMO_DEFAULT_AVATAR_ID || "avatar-1",
  sceneId: process.env.DEMO_DEFAULT_SCENE_ID || "scene-1",
  voiceId: process.env.DEMO_DEFAULT_VOICE_ID || "voice-1",
  motionId: process.env.DEMO_DEFAULT_MOTION_ID || "motion-talking-1",
};
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
const LLM_API_KEY = process.env.LLM_API_KEY;
const PRESENTER_TARGET = {
  avatarId: process.env.DEMO_FIXED_AVATAR_ID,
  sceneId: process.env.DEMO_FIXED_SCENE_ID,
  voiceId: process.env.DEMO_FIXED_VOICE_ID,
};
const hasConfiguredPresenterTarget = Boolean(
  PRESENTER_TARGET.avatarId ||
    PRESENTER_TARGET.sceneId ||
    PRESENTER_TARGET.voiceId,
);
const hasCompletePresenterTarget = Boolean(
  PRESENTER_TARGET.avatarId && PRESENTER_TARGET.sceneId,
);
const fixedPresenterTarget = hasCompletePresenterTarget
  ? {
      avatarId: PRESENTER_TARGET.avatarId,
      sceneId: PRESENTER_TARGET.sceneId,
      ...(PRESENTER_TARGET.voiceId
        ? { voiceId: PRESENTER_TARGET.voiceId }
        : {}),
    }
  : null;
// Server-side credentials for the one shared Connect API identity this sample
// uses — see README "Auth model". Every browser hitting this server acts
// through the same upstream account; there is no per-user login.
const CONNECT_EMAIL = process.env.PERXONA_CONNECT_EMAIL;
const CONNECT_PASSWORD = process.env.PERXONA_CONNECT_PASSWORD;

if (hasConfiguredPresenterTarget && !hasCompletePresenterTarget) {
  console.error(
    "ERROR: DEMO_FIXED_AVATAR_ID and DEMO_FIXED_SCENE_ID must be configured together. DEMO_FIXED_VOICE_ID is optional for BYO-TTS.",
  );
  process.exit(1);
}

// Real credentials are only needed when actually calling the upstream API.
// USE_MOCK=true skips callUpstream() entirely (see api selection below), so
// don't force dummy values into these fields just to pass a startup check.
if (!USE_MOCK) {
  if (!PERXONA_API_BASE_URL) {
    console.error(
      "ERROR: PERXONA_API_BASE_URL is required. Copy .env.example to .env and fill it in.",
    );
    process.exit(1);
  }

  if (!CONNECT_EMAIL || !CONNECT_PASSWORD) {
    console.error(
      "ERROR: PERXONA_CONNECT_EMAIL and PERXONA_CONNECT_PASSWORD are required.\n" +
        "Copy .env.example to .env and fill them in with your Perxona service credentials.",
    );
    process.exit(1);
  }
}

// ── Upstream API implementation ────────────────────────────────────────────

/**
 * Send an authenticated request to the Perxona upstream API.
 * @param {string} path  - Upstream path, e.g. '/api/v1/connect/voices'
 * @param {object} opts  - fetch options (method, body, headers…)
 * @param {string} [token] - JWT access token; omit for unauthenticated calls
 */
async function callUpstream(path, opts, token) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${PERXONA_API_BASE_URL}${path}`, { ...opts, headers });
}

/**
 * Parse a callUpstream() Response as JSON, throwing a structured error
 * ({ status, payload }) on any non-2xx status. Centralising this means every
 * connectApi method — not just the ones that used to check r.ok by hand —
 * surfaces 401/403 the same way, which is what lets authedCall() (see below)
 * detect an expired bearer token and transparently re-login and retry.
 * @param {Response} r
 * @param {string} label  Used in the thrown error message, e.g. "voices".
 */
async function upstreamJson(r, label) {
  if (!r.ok) {
    const payload = await r.json().catch(() => ({}));
    throw Object.assign(new Error(`upstream ${label} failed`), {
      status: r.status,
      payload,
    });
  }
  return r.json();
}

/**
 * Send an authenticated request to the upstream API without forcing Content-Type.
 * Used for multipart/form-data endpoints (chatbot create/update) where fetch must
 * set the Content-Type + boundary automatically from the FormData body.
 * @param {string} path  - Upstream path, e.g. '/api/v1/connect/chatbots'
 * @param {"POST"|"PATCH"} method
 * @param {FormData} form
 * @param {string} [token] - JWT access token
 */
async function callUpstreamFormData(path, method, form, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${PERXONA_API_BASE_URL}${path}`, {
    method,
    headers,
    body: form,
  });
}

/**
 * Probe whether the presenter engine is reachable at PRESENTER_URL.
 * Non-fatal diagnostic only — a HEAD request with a short timeout so startup
 * never blocks. Catches the common "PRESENTER_URL points at a channel that
 * isn't published yet" case (404) before the browser hits a blank stage.
 * @returns {Promise<"reachable" | string>} "reachable", "unreachable (<status>)", or "unreachable"
 */
async function checkPresenter() {
  try {
    const r = await fetch(PRESENTER_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return r.ok ? "reachable" : `unreachable (${r.status})`;
  } catch {
    return "unreachable";
  }
}

// connectApi — real upstream implementation, thin wrappers around call().
// Route handlers reference api.* and never touch USE_MOCK directly.
const connectApi = {
  async checkUpstream() {
    try {
      const r = await fetch(`${PERXONA_API_BASE_URL}/ready`);
      return r.ok ? "reachable" : "unreachable";
    } catch {
      return "unreachable";
    }
  },

  async login(body) {
    const r = await callUpstream("/api/v1/connect/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return upstreamJson(r, "login");
  },

  async voices(token) {
    const r = await callUpstream("/api/v1/connect/voices", {}, token);
    return upstreamJson(r, "voices"); // Page[ConnectVoiceResponse] — items already have { id, name, … }
  },

  // Normalize avatar list: backend uses avatar_id; frontend dropdowns expect id.
  async avatars(token) {
    const r = await callUpstream("/api/v1/connect/assets/avatars", {}, token);
    const page = await upstreamJson(r, "avatars");
    return {
      ...page,
      items: (page.items ?? []).map(({ avatar_id, ...rest }) => ({
        id: avatar_id,
        ...rest,
      })),
    };
  },

  // Raw avatar detail — the frontend never calls this directly; it's exposed as a
  // standalone REST resource for reference (see docs/openapi.yaml).
  async avatar(id, token) {
    const r = await callUpstream(
      `/api/v1/connect/assets/avatars/${id}`,
      {},
      token,
    );
    return upstreamJson(r, "avatar detail");
  },

  // Motions are a sub-resource of an avatar, not a top-level collection.
  async avatarMotions(avatarId, token) {
    const r = await callUpstream(
      `/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions`,
      {},
      token,
    );
    return upstreamJson(r, "avatar motions"); // Page[ConnectMotionAssetResponse]
  },

  // Normalize scene list: backend uses scene_id; frontend dropdowns expect id.
  async scenes(token) {
    const r = await callUpstream("/api/v1/connect/assets/scenes", {}, token);
    const page = await upstreamJson(r, "scenes");
    return {
      ...page,
      items: (page.items ?? []).map(({ scene_id, ...rest }) => ({
        id: scene_id,
        ...rest,
      })),
    };
  },

  // Raw scene detail — the frontend never calls this directly; it's exposed as a
  // standalone REST resource for reference (see docs/openapi.yaml).
  async scene(id, token) {
    const r = await callUpstream(
      `/api/v1/connect/assets/scenes/${id}`,
      {},
      token,
    );
    return upstreamJson(r, "scene detail");
  },

  // ── Chatbot CRUD ──────────────────────────────────────────────────────────
  //
  // Create/update use multipart/form-data because the upstream supports an
  // optional knowledge_file upload. The Express proxy accepts plain JSON from
  // the browser and re-encodes it as FormData before forwarding. This keeps
  // the browser-facing API simple (JSON), while matching what the upstream expects.

  async listChatbots(token) {
    const r = await callUpstream("/api/v1/connect/chatbots?size=50", {}, token);
    return upstreamJson(r, "chatbots");
  },

  async getChatbot(id, token) {
    const r = await callUpstream(
      `/api/v1/connect/chatbots/${encodeURIComponent(id)}`,
      {},
      token,
    );
    return upstreamJson(r, "chatbot detail");
  },

  async createChatbot({ name, custom_instructions, tools }, token) {
    const form = new FormData();
    form.append("name", name);
    if (custom_instructions != null)
      form.append("custom_instructions", custom_instructions);
    if (tools !== undefined) form.append("tools", JSON.stringify(tools));
    const r = await callUpstreamFormData(
      "/api/v1/connect/chatbots",
      "POST",
      form,
      token,
    );
    return upstreamJson(r, "create chatbot");
  },

  async updateChatbot(
    id,
    { name, custom_instructions, tools, remove_knowledge },
    token,
  ) {
    const form = new FormData();
    if (name != null) form.append("name", name);
    if (custom_instructions !== undefined)
      form.append("custom_instructions", custom_instructions ?? "");
    if (tools !== undefined) form.append("tools", JSON.stringify(tools));
    if (remove_knowledge) form.append("remove_knowledge", "true");
    const r = await callUpstreamFormData(
      `/api/v1/connect/chatbots/${encodeURIComponent(id)}`,
      "PATCH",
      form,
      token,
    );
    return upstreamJson(r, "update chatbot");
  },

  // Upload a knowledge file for a chatbot by PATCHing with knowledge_file.
  // The caller supplies a Buffer so this method stays independent of Express.
  async uploadChatbotKnowledge(id, fileBuffer, filename, mimeType, token) {
    const form = new FormData();
    form.append(
      "knowledge_file",
      new Blob([fileBuffer], { type: mimeType }),
      filename,
    );
    const r = await callUpstreamFormData(
      `/api/v1/connect/chatbots/${encodeURIComponent(id)}`,
      "PATCH",
      form,
      token,
    );
    return upstreamJson(r, "upload chatbot knowledge");
  },

  async deleteChatbot(id, token) {
    const r = await callUpstream(
      `/api/v1/connect/chatbots/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      token,
    );
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      throw Object.assign(new Error("upstream delete chatbot failed"), {
        status: r.status,
        payload,
      });
    }
    // 204 No Content — intentionally returns nothing
  },

  async chatWithChatbot(id, messages, token) {
    const r = await callUpstream(
      `/api/v1/connect/chatbots/${encodeURIComponent(id)}/chat`,
      { method: "POST", body: JSON.stringify({ messages }) },
      token,
    );
    return upstreamJson(r, "chat with chatbot");
  },
};

// Select implementation at boot: mock (internal dev only) or real upstream.
let api;
if (USE_MOCK) {
  try {
    api = await import("./mocks/upstream.mjs");
  } catch {
    console.error(
      "ERROR: USE_MOCK=true but mocks/upstream.mjs is not present.\n" +
        "The mock implementation is internal-only and is not included in this " +
        "public sample — set USE_MOCK=false (or remove it) and fill in real " +
        "PERXONA_API_BASE_URL / PERXONA_CONNECT_EMAIL / PERXONA_CONNECT_PASSWORD instead.",
    );
    process.exit(1);
  }
} else {
  api = connectApi;
}

// ── Global upstream auth (token manager) ────────────────────────────────────
//
// This sample exchanges ONE set of server-side credentials (PERXONA_CONNECT_EMAIL /
// PERXONA_CONNECT_PASSWORD) for ONE Connect API bearer token, shared by every
// browser that hits this server. There is no per-user login — see README "Auth
// model" for the rationale and its tradeoffs.

/** The current shared bearer token, or null before the first login. */
let cachedToken = null;
/** In-flight login request — de-dupes concurrent callers into one upstream login call. */
let loginPromise = null;

/**
 * Return the current bearer token, logging in with the configured Connect
 * credentials on first use (lazy — no login happens until the first protected
 * route is hit) or when forceRefresh is set (after upstream rejects the
 * cached token with 401/403). Concurrent callers share the same in-flight
 * login request instead of each triggering their own.
 * @param {{ forceRefresh?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function getToken({ forceRefresh = false } = {}) {
  if (cachedToken && !forceRefresh) return cachedToken;
  if (forceRefresh) cachedToken = null;
  if (!loginPromise) {
    loginPromise = api
      .login({ email: CONNECT_EMAIL, password: CONNECT_PASSWORD })
      .then(({ access_token }) => {
        cachedToken = access_token;
        return cachedToken;
      })
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

/**
 * Run an upstream call with the shared token, transparently re-logging in and
 * retrying once if the token was rejected (401/403). This is what makes token
 * expiry invisible to the browser — no re-login UI or refresh token needed.
 * Any other error (network failure, 5xx, etc.) is rethrown as-is.
 * @param {(token: string) => Promise<any>} fn
 */
async function authedCall(fn) {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    const freshToken = await getToken({ forceRefresh: true });
    return fn(freshToken);
  }
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");

// ── Static frontend ────────────────────────────────────────────────────────

// Disable ETags in dev so a plain browser refresh always fetches the latest
// files from disk. Production keeps ETags for efficient caching.
const IS_DEV = process.env.NODE_ENV !== "production";

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(express.static("public", { etag: !IS_DEV }));

app.use(express.json());

/**
 * Wrap a route handler so any thrown error (upstream failure, or auth retry
 * exhaustion from authedCall) becomes a JSON error response instead of an
 * unhandled rejection — Express 4 does not catch async handler rejections on
 * its own.
 * @param {(req: express.Request, res: express.Response) => Promise<void>} handler
 */
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status ?? 502;
      res.status(status).json(err.payload ?? { error: String(err) });
    }
  };
}

// ── Health & config ─────────────────────────────────────────────────────────

// GET /api/health → { status: "ok", upstream: "reachable"|"unreachable"|"mock" }. Always 200.
// Liveness plus the one dynamic field: `upstream` probes the backend on every
// call (and reads "mock" in mock mode). Static per-process flags (mock, chat)
// live in /api/config, which needs no network round-trip.
app.get("/api/health", async (_req, res) => {
  res.json({
    status: "ok",
    upstream: await api.checkUpstream(),
  });
});

// GET /api/config → { mock, chat, presenterUrl, fixedTarget }. Static per-process flags fixed
// at startup; no upstream probe, so the frontend can read them cheaply without
// triggering a backend round-trip on every poll. `chat` reflects the presence of
// LLM_API_KEY only — never the key itself. `presenterUrl` lets demo frontends
// inject the presenter engine <script> dynamically instead of server-side HTML
// templating.
app.get("/api/config", (_req, res) => {
  res.json({
    mock: USE_MOCK,
    chat: Boolean(process.env.LLM_API_KEY),
    presenterUrl: PRESENTER_URL,
    defaults: DEMO_DEFAULTS,
    fixedTarget: fixedPresenterTarget,
  });
});

// GET /api/connect-token
// Returns: { connect_token } — the Connect Kit Bearer JWT the browser passes into
//          presenter.initialize(connectToken, target). From there, <sv-presenter>
//          talks to the Connect API directly to resolve the target, mint its own
//          speech token, and refresh it — this server's only job is minting the
//          token via its one shared login (see "Auth model" in README).
//          The token is validated against the catalog first, so a cached token
//          rejected with 401/403 is refreshed before it reaches the browser.
// Errors:  502 upstream login failure.
app.get(
  "/api/connect-token",
  route(async (_req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
    const connectToken = await authedCall(async (token) => {
      await api.voices(token);
      return token;
    });
    res.json({ connect_token: connectToken });
  }),
);

// ── Catalog routes ──────────────────────────────────────────────────────────
// GET  /api/voices
// GET  /api/avatars          GET  /api/avatars/:id    GET  /api/avatars/:id/motions
// GET  /api/scenes           GET  /api/scenes/:id
// POST /api/chat             (disabled when LLM_API_KEY is unset → 501)
//
// All routes below share the one server-side Connect identity via authedCall();
// there is no per-request auth check — see the token manager above.

// Catalog — read-only lists + single items used to populate UI dropdowns.
//   GET /api/voices              → Page { items: [{ id, name, … }] }
//   GET /api/avatars             → Page { items: [{ id, name, … }] }  (id normalized from avatar_id)
//   GET /api/avatars/:id         → raw avatar detail (avatar_id, lod_urls, lipsync_configs, …)
//   GET /api/avatars/:id/motions → Page { items: [ … ] }
//   GET /api/scenes              → Page { items: [{ id, name, … }] }  (id normalized from scene_id)
//   GET /api/scenes/:id          → raw scene detail
app.get(
  "/api/voices",
  route(async (_req, res) => {
    res.json(await authedCall((token) => api.voices(token)));
  }),
);

app.get(
  "/api/avatars",
  route(async (_req, res) => {
    res.json(await authedCall((token) => api.avatars(token)));
  }),
);

app.get(
  "/api/avatars/:id",
  route(async (req, res) => {
    const id = encodeURIComponent(req.params.id);
    res.json(await authedCall((token) => api.avatar(id, token)));
  }),
);

// Motions are a sub-resource of an avatar (no top-level collection endpoint).
app.get(
  "/api/avatars/:id/motions",
  route(async (req, res) => {
    const id = encodeURIComponent(req.params.id);
    res.json(await authedCall((token) => api.avatarMotions(id, token)));
  }),
);

app.get(
  "/api/scenes",
  route(async (_req, res) => {
    res.json(await authedCall((token) => api.scenes(token)));
  }),
);

app.get(
  "/api/scenes/:id",
  route(async (req, res) => {
    const id = encodeURIComponent(req.params.id);
    res.json(await authedCall((token) => api.scene(id, token)));
  }),
);

// POST /api/demo-script
// Request: { avatarId: string, prompt: string }
// Returns: { reply: string, script: string, motions: [{ id, name }] }
// The server owns the motion catalog so an LLM cannot invent IDs supplied by
// the browser. The returned Motion Markup is validated before it is exposed.
const MOTION_TAG_CANDIDATE_RE = /\[MOTION\b[^\]]*(?:\]|$)/gi;
const MOTION_TAG_RE = /^\[MOTION\s+([^\s:;\]]+):\d+(?:;([^\s:;\]]+):\d+)?\]$/i;

function parseAndValidateMotionIds(script) {
  const candidates = [...script.matchAll(MOTION_TAG_CANDIDATE_RE)].map(
    ([match]) => match,
  );
  const malformedTags = candidates.filter((candidate) => {
    const match = MOTION_TAG_RE.exec(candidate);
    MOTION_TAG_RE.lastIndex = 0;
    return !match;
  });
  if (malformedTags.length > 0) {
    throw Object.assign(
      new Error(
        `Generated script contains malformed Motion Markup: ${malformedTags.join(", ")}`,
      ),
      { status: 502 },
    );
  }
  return candidates.flatMap((candidate) => {
    const match = MOTION_TAG_RE.exec(candidate);
    MOTION_TAG_RE.lastIndex = 0;
    return [match[1], match[2]].filter(Boolean);
  });
}

function validateDemoScript(script, motions) {
  if (typeof script !== "string" || !script.trim()) {
    throw Object.assign(
      new Error("LLM response must include a non-empty script."),
      {
        status: 502,
      },
    );
  }
  if (script.length > 4000) {
    throw Object.assign(new Error("Generated script is too long."), {
      status: 502,
    });
  }

  const motionIds = new Set(motions.map(({ id }) => id));
  const unknownMotionIds = parseAndValidateMotionIds(script).filter(
    (id) => !motionIds.has(id),
  );
  if (unknownMotionIds.length > 0) {
    throw Object.assign(
      new Error(
        `Generated script contains unknown motion IDs: ${[...new Set(unknownMotionIds)].join(", ")}`,
      ),
      { status: 502 },
    );
  }
  return script.trim();
}

function parseJsonObject(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

const DEMO_SCRIPT_JSON_SCHEMA = {
  name: "presenter_script",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "script"],
    properties: {
      reply: { type: "string" },
      script: { type: "string" },
    },
  },
};

function llmRequestConfig(messages, responseFormat) {
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (LLM_PROVIDER === "anthropic") {
    const system = messages
      .filter(({ role }) => role === "system")
      .map(({ content }) => content)
      .join("\n");
    const userMessages = messages
      .filter(({ role }) => role !== "system")
      .map(({ role, content }) => ({ role, content }));
    return {
      url: `${process.env.LLM_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": LLM_API_KEY,
      },
      body: {
        model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: userMessages,
        ...(responseFormat?.json_schema
          ? {
              output_config: {
                format: {
                  type: "json_schema",
                  schema: responseFormat.json_schema.schema,
                },
              },
            }
          : {}),
      },
    };
  }
  return {
    url: `${process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: { model, messages, response_format: responseFormat },
  };
}

async function requestLlmCompletion(messages, responseFormat) {
  if (LLM_PROVIDER !== "openai" && LLM_PROVIDER !== "anthropic") {
    throw Object.assign(
      new Error("LLM_PROVIDER must be either 'openai' or 'anthropic'."),
      { status: 500 },
    );
  }
  const request = llmRequestConfig(messages, responseFormat);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error("LLM request failed."), {
      status: 502,
      payload,
    });
  }
  return payload;
}

function llmResponseText(payload) {
  if (LLM_PROVIDER === "anthropic") {
    return payload.content?.find(({ type }) => type === "text")?.text;
  }
  return payload.choices?.[0]?.message?.content;
}

function openAiCompatibleResponse(payload) {
  if (LLM_PROVIDER === "openai") return payload;
  return {
    choices: [
      {
        message: { role: "assistant", content: llmResponseText(payload) ?? "" },
      },
    ],
  };
}

function buildDemoScriptPrompt(prompt, motions) {
  return [
    'Return JSON only with exactly this shape: {"reply":"short explanation","script":"avatar dialogue with optional Motion Markup"}.',
    "Create a short speaking script for an avatar. Use only motion IDs from the supplied catalog.",
    "Motion syntax is [MOTION motion-id:1]. Never invent an ID. Do not put planning notes in script.",
    `Available motions: ${JSON.stringify(motions)}`,
  ].join("\n");
}

app.post(
  "/api/demo-script",
  route(async (req, res) => {
    const avatarId = req.body?.avatarId;
    const prompt = req.body?.prompt;
    if (typeof avatarId !== "string" || !avatarId.trim()) {
      res.status(400).json({ error: "'avatarId' is required." });
      return;
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ error: "'prompt' is required." });
      return;
    }
    if (prompt.length > 2000) {
      res
        .status(400)
        .json({ error: "'prompt' must be 2000 characters or fewer." });
      return;
    }

    const page = await authedCall((token) =>
      api.avatarMotions(avatarId, token),
    );
    const motions = (page.items ?? [])
      .map((motion) => ({
        id: motion.id ?? motion.motion_id,
        name: motion.name,
      }))
      .filter(
        ({ id, name }) => typeof id === "string" && typeof name === "string",
      );
    if (motions.length === 0) {
      res
        .status(422)
        .json({ error: "The selected avatar has no usable motions." });
      return;
    }

    let demoScriptResult;
    if (USE_MOCK) {
      const motion =
        motions.find(({ id }) => id === DEMO_DEFAULTS.motionId) ?? motions[0];
      demoScriptResult = {
        reply:
          "Created a deterministic demo script from the selected motion catalog.",
        script: `Hello! [MOTION ${motion.id}:1] It is great to meet you.`,
      };
    } else {
      if (!process.env.LLM_API_KEY) {
        res.status(501).json({
          error:
            "LLM_API_KEY not configured. Set it in .env to enable script generation.",
        });
        return;
      }
      const payload = await requestLlmCompletion(
        [
          { role: "system", content: buildDemoScriptPrompt(prompt, motions) },
          { role: "user", content: prompt.trim() },
        ],
        { type: "json_schema", json_schema: DEMO_SCRIPT_JSON_SCHEMA },
      );
      const content = llmResponseText(payload);
      if (typeof content !== "string") {
        throw Object.assign(
          new Error("LLM response did not include message content."),
          {
            status: 502,
          },
        );
      }
      demoScriptResult = parseJsonObject(content);
    }

    if (
      typeof demoScriptResult.reply !== "string" ||
      !demoScriptResult.reply.trim()
    ) {
      throw Object.assign(
        new Error("LLM response must include a non-empty reply."),
        {
          status: 502,
        },
      );
    }
    const script = validateDemoScript(demoScriptResult.script, motions);
    res.json({ reply: demoScriptResult.reply.trim(), script, motions });
  }),
);

// ── Chatbot routes ──────────────────────────────────────────────────────────
// GET    /api/chatbots              → Page { items: [{ id, name, status }] }
// POST   /api/chatbots              → ChatBotDetailResponse (201 proxied as 200)
// GET    /api/chatbots/:id          → ChatBotDetailResponse (id, name, custom_instructions, status, tools)
// PATCH  /api/chatbots/:id          → ChatBotDetailResponse
// DELETE /api/chatbots/:id          → 204 No Content
// POST   /api/chatbots/:id/chat     → { id, status, reply_text }
//
// Create and update are forwarded as multipart/form-data (see callUpstreamFormData).
// The browser sends JSON; the proxy re-encodes it before forwarding upstream.

app.get(
  "/api/chatbots",
  route(async (_req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    res.json(await authedCall((token) => api.listChatbots(token)));
  }),
);

app.post(
  "/api/chatbots",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const { name, custom_instructions, tools } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "'name' is required." });
      return;
    }
    const created = await authedCall((token) =>
      api.createChatbot({ name, custom_instructions, tools }, token),
    );
    // upstream returns 201; surface as 200 for consistent demo fetch handling
    res.json(created);
  }),
);

app.get(
  "/api/chatbots/:id",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    res.json(await authedCall((token) => api.getChatbot(id, token)));
  }),
);

app.patch(
  "/api/chatbots/:id",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    const { name, custom_instructions, tools, remove_knowledge } =
      req.body ?? {};
    res.json(
      await authedCall((token) =>
        api.updateChatbot(
          id,
          { name, custom_instructions, tools, remove_knowledge },
          token,
        ),
      ),
    );
  }),
);

app.delete(
  "/api/chatbots/:id",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    await authedCall((token) => api.deleteChatbot(id, token));
    res.status(204).end();
  }),
);

// Allowlisted file extensions and MIME types for knowledge uploads.
// Matches the frontend <input accept=".txt,.pdf,.doc,.docx,.csv"> constraint so
// the server rejects any attempt to bypass the client-side restriction.
const KNOWLEDGE_ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".pdf",
  ".doc",
  ".docx",
  ".csv",
]);
const KNOWLEDGE_ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/octet-stream", // fallback when browser cannot detect MIME
]);
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// POST /api/chatbots/:id/knowledge
// Body: { filename, content_base64, mime_type }
// Reads the base64-encoded file from the JSON body, converts it to a Buffer,
// and PATCHes the upstream chatbot with knowledge_file as multipart/form-data.
// Separating knowledge upload avoids needing a multipart parser on this server.
// express.json() defaults to 100 KB; base64 adds ~33% overhead, so a 5 MB file
// would balloon to ~6.7 MB in transit. The per-route limit below allows files up
// to ~7.5 MB (10 MB after base64 expansion) without raising the global limit.
app.post(
  "/api/chatbots/:id/knowledge",
  express.json({ limit: "10mb" }),
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    const { filename, content_base64, mime_type } = req.body ?? {};
    if (!filename || !content_base64) {
      res
        .status(400)
        .json({ error: "'filename' and 'content_base64' are required." });
      return;
    }

    // Reject filenames containing path separators to prevent directory traversal.
    if (filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ error: "Invalid filename." });
      return;
    }

    // Enforce extension allowlist (aligns with frontend <input accept> constraint).
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!KNOWLEDGE_ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: `File type not allowed. Accepted extensions: ${[...KNOWLEDGE_ALLOWED_EXTENSIONS].join(", ")}.`,
      });
      return;
    }

    // Validate MIME type if provided.
    const effectiveMime = mime_type || "application/octet-stream";
    if (!KNOWLEDGE_ALLOWED_MIME_TYPES.has(effectiveMime)) {
      res.status(400).json({
        error: `MIME type not allowed: ${effectiveMime}.`,
      });
      return;
    }

    // Basic base64 format check before decoding.
    if (!BASE64_RE.test(content_base64)) {
      res.status(400).json({ error: "Invalid base64 content." });
      return;
    }

    const buffer = Buffer.from(content_base64, "base64");
    res.json(
      await authedCall((token) =>
        api.uploadChatbotKnowledge(id, buffer, filename, effectiveMime, token),
      ),
    );
  }),
);

// DELETE /api/chatbots/:id/knowledge
// Sends remove_knowledge=true via PATCH to clear the chatbot's knowledge file.
app.delete(
  "/api/chatbots/:id/knowledge",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    res.json(
      await authedCall((token) =>
        api.updateChatbot(id, { remove_knowledge: true }, token),
      ),
    );
  }),
);

app.post(
  "/api/chatbots/:id/chat",
  route(async (req, res) => {
    if (USE_MOCK) {
      res
        .status(501)
        .json({ error: "Chatbot API is not available in mock mode." });
      return;
    }
    const id = req.params.id;
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "'messages' must be a non-empty array." });
      return;
    }
    res.json(
      await authedCall((token) => api.chatWithChatbot(id, messages, token)),
    );
  }),
);

// POST /api/chat
// Request: { messages: [...] } (OpenAI chat format).
// Returns: the OpenAI-compatible chat-completion JSON from the configured endpoint.
// Errors:  501 until LLM_API_KEY is set · 502 LLM upstream unreachable.
// Note: chat talks directly to the configured LLM endpoint, not the Connect API,
// so it does not go through authedCall().
app.post("/api/chat", async (req, res) => {
  if (!process.env.LLM_API_KEY) {
    res.status(501).json({
      error: "LLM_API_KEY not configured. Set it in .env to enable chat.",
    });
    return;
  }
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      error: "Request body must include a non-empty 'messages' array.",
    });
    return;
  }
  try {
    const payload = await requestLlmCompletion(messages);
    res.json(openAiCompatibleResponse(payload));
  } catch (err) {
    res
      .status(err.status ?? 502)
      .json({ error: "LLM upstream unreachable", message: String(err) });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

const CHECK_ICONS = { reachable: "✓", unreachable: "✗", mock: "–" };

app.listen(PORT, () => {
  console.log(`\nPerxona Connect Kit`);
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log(`  Mode : ${USE_MOCK ? "MOCK (no real API calls)" : "live"}`);
  // Deferred probes so the banner prints immediately and startup never blocks.
  // Labeled API/CDN so each line reads as that resource's reachability.
  api.checkUpstream().then((status) => {
    const icon = CHECK_ICONS[status] ?? "✗";
    const hint =
      status === "unreachable" ? " — check PERXONA_API_BASE_URL" : "";
    console.log(`  API  : ${icon} ${status}  ${PERXONA_API_BASE_URL}${hint}`);
  });
  checkPresenter().then((status) => {
    const icon = CHECK_ICONS[status] ?? "✗";
    const hint =
      status === "reachable"
        ? ""
        : " — set PRESENTER_URL to a reachable engine (see .env)";
    console.log(`  CDN  : ${icon} ${status}  ${PRESENTER_URL}${hint}`);
  });
});
