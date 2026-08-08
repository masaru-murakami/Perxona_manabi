// Shared helpers for the cg-exam Netlify Functions deployment.
//
// This is a trimmed port of samples/express/server.mjs — only the pieces the
// cg-exam demo actually calls (GET /api/config, GET /api/connect-token,
// GET /api/avatars/:id/motions, POST /api/demo-script). See that file for the
// full Connect Kit backend (catalog browsing, chatbot CRUD, chat, etc.) if a
// future deploy needs more than this demo does.
//
// Netlify Functions v2 (the `export default async (req, context) => ...`
// style used by every function in this folder) run on standard Web Request/
// Response — no Express, no `serverless-http` adapter needed here.

export const PERXONA_API_BASE_URL = process.env.PERXONA_API_BASE_URL;
export const PRESENTER_URL =
  process.env.PRESENTER_URL ||
  "https://cdn.perxona.ai/prod/latest/widget/entry/presenter.js";
export const DEMO_DEFAULTS = {
  avatarId: process.env.DEMO_DEFAULT_AVATAR_ID || "",
  sceneId: process.env.DEMO_DEFAULT_SCENE_ID || "",
  voiceId: process.env.DEMO_DEFAULT_VOICE_ID || "",
  motionId: process.env.DEMO_DEFAULT_MOTION_ID || "",
};
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();
export const LLM_API_KEY = process.env.LLM_API_KEY;
export const HAS_CHAT = Boolean(LLM_API_KEY);

const CONNECT_EMAIL = process.env.PERXONA_CONNECT_EMAIL;
const CONNECT_PASSWORD = process.env.PERXONA_CONNECT_PASSWORD;

class UpstreamError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function assertConfigured() {
  if (!PERXONA_API_BASE_URL || !CONNECT_EMAIL || !CONNECT_PASSWORD) {
    throw new UpstreamError(
      "Server misconfigured: set PERXONA_API_BASE_URL, PERXONA_CONNECT_EMAIL, PERXONA_CONNECT_PASSWORD in the Netlify site's environment variables.",
      500,
    );
  }
}

// HTTP header values must be ByteString (Latin-1, code points 0-255) — the
// native error when they aren't ("Cannot convert argument to a ByteString…")
// doesn't say *which* value was bad. This turns that into an actionable
// message naming the offending env var, so a stray character from copying a
// value into the Netlify dashboard (smart quotes, a bullet from a pasted
// list, a trailing character) is easy to spot instead of a guessing game.
function assertHeaderSafe(name, value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      throw new UpstreamError(
        `${name} contains a character that can't go in an HTTP header (U+${code.toString(16).toUpperCase()} at position ${i}). ` +
          "This usually means the value got mangled when it was copied into the Netlify dashboard — re-copy it from the source " +
          "(e.g. your local .env file) rather than from a chat message or rendered document, then redeploy.",
        500,
      );
    }
  }
}

async function callUpstream(path, opts = {}, token) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) {
    assertHeaderSafe("The Perxona Connect bearer token", token);
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(`${PERXONA_API_BASE_URL}${path}`, { ...opts, headers });
}

async function upstreamJson(r, label) {
  if (!r.ok) {
    const payload = await r.json().catch(() => ({}));
    throw new UpstreamError(`upstream ${label} failed`, r.status, payload);
  }
  return r.json();
}

async function login() {
  const r = await callUpstream("/api/v1/connect/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: CONNECT_EMAIL, password: CONNECT_PASSWORD }),
  });
  return upstreamJson(r, "login");
}

export async function voices(token) {
  const r = await callUpstream("/api/v1/connect/voices", {}, token);
  return upstreamJson(r, "voices");
}

export async function avatarMotions(avatarId, token) {
  const r = await callUpstream(
    `/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions`,
    {},
    token,
  );
  return upstreamJson(r, "avatar motions");
}

// ── Shared upstream auth (token cache) ──────────────────────────────────────
//
// Same "one shared server-side Connect identity" model as samples/express —
// see its README "Auth model". On Netlify, this module-level cache survives
// only for as long as a given function instance stays warm (best-effort: it
// cuts down on repeat logins across requests, but every cold start logs in
// again — there is no cross-instance shared cache here).
let cachedToken = null;
let loginPromise = null;

async function getToken({ forceRefresh = false } = {}) {
  assertConfigured();
  if (cachedToken && !forceRefresh) return cachedToken;
  if (forceRefresh) cachedToken = null;
  if (!loginPromise) {
    loginPromise = login()
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

export async function authedCall(fn) {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    const freshToken = await getToken({ forceRefresh: true });
    return fn(freshToken);
  }
}

// ── LLM (demo-script) ────────────────────────────────────────────────────────

export function llmRequestConfig(messages, responseFormat) {
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (LLM_API_KEY) assertHeaderSafe("LLM_API_KEY", LLM_API_KEY);
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

export async function requestLlmCompletion(messages, responseFormat) {
  if (LLM_PROVIDER !== "openai" && LLM_PROVIDER !== "anthropic") {
    throw new UpstreamError(
      "LLM_PROVIDER must be either 'openai' or 'anthropic'.",
      500,
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
    throw new UpstreamError("LLM request failed.", 502, payload);
  }
  return payload;
}

export function llmResponseText(payload) {
  if (LLM_PROVIDER === "anthropic") {
    return payload.content?.find(({ type }) => type === "text")?.text;
  }
  return payload.choices?.[0]?.message?.content;
}

export function parseJsonObject(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export const DEMO_SCRIPT_JSON_SCHEMA = {
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

export function buildDemoScriptPrompt(prompt, motions) {
  return [
    'Return JSON only with exactly this shape: {"reply":"short explanation","script":"avatar dialogue with optional Motion Markup"}.',
    "Create a short speaking script for an avatar. Use only motion IDs from the supplied catalog.",
    "Motion syntax is [MOTION motion-id:1]. Never invent an ID. Do not put planning notes in script.",
    `Available motions: ${JSON.stringify(motions)}`,
  ].join("\n");
}

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
    throw new UpstreamError(
      `Generated script contains malformed Motion Markup: ${malformedTags.join(", ")}`,
      502,
    );
  }
  return candidates.flatMap((candidate) => {
    const match = MOTION_TAG_RE.exec(candidate);
    MOTION_TAG_RE.lastIndex = 0;
    return [match[1], match[2]].filter(Boolean);
  });
}

export function validateDemoScript(script, motions) {
  if (typeof script !== "string" || !script.trim()) {
    throw new UpstreamError("LLM response must include a non-empty script.", 502);
  }
  if (script.length > 4000) {
    throw new UpstreamError("Generated script is too long.", 502);
  }
  const motionIds = new Set(motions.map(({ id }) => id));
  const unknownMotionIds = parseAndValidateMotionIds(script).filter(
    (id) => !motionIds.has(id),
  );
  if (unknownMotionIds.length > 0) {
    throw new UpstreamError(
      `Generated script contains unknown motion IDs: ${[...new Set(unknownMotionIds)].join(", ")}`,
      502,
    );
  }
  return script.trim();
}

export function errorResponse(err) {
  const status = err.status ?? 502;
  const body = err.payload ?? { error: String(err.message ?? err) };
  return Response.json(body, { status });
}
