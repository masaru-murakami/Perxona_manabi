import { getStore } from "@netlify/blobs";

// Mirrors samples/express/server.mjs's /api/log-question, but stores in
// Netlify Blobs instead of a local JSONL file — Functions have no durable
// local filesystem between invocations. See analytics.mjs for the reader.
const STORE_NAME = "cg-exam-question-log";
const BLOB_KEY = "entries";
const MAX_ENTRIES = 5000; // oldest entries drop once the log exceeds this

function truncateText(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

// POST /api/log-question — best-effort. Called by avatar.js right after
// every askQuestion() call, success or failure. A write failure here is
// logged server-side only and never surfaces to the learner-facing UI:
// losing one analytics row is far better than breaking the question flow.
// Request: { sessionId?, lang, domain?, question, reply?, success, errorMessage? }
export default async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const question = truncateText(body?.question, 2000);
  if (!question) {
    return Response.json({ error: "'question' is required." }, { status: 400 });
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    sessionId: truncateText(body.sessionId, 100),
    lang: body.lang === "en" ? "en" : "ja",
    domain: truncateText(body.domain, 200),
    question,
    reply: truncateText(body.reply, 4000),
    success: Boolean(body.success),
    errorMessage: truncateText(body.errorMessage, 500),
  };

  try {
    const store = getStore(STORE_NAME);
    // Read-modify-write — not atomic under concurrent writes, but fine at
    // this demo's traffic level (a lost race just drops one entry, never
    // corrupts the store). Newest first, capped so the blob can't grow
    // unbounded.
    const existing = (await store.get(BLOB_KEY, { type: "json" })) ?? [];
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    await store.setJSON(BLOB_KEY, updated);
  } catch (err) {
    console.error("[analytics] failed to write question log:", err);
  }

  return new Response(null, { status: 204 });
};

export const config = { path: "/api/log-question" };
