import { getStore } from "@netlify/blobs";

// Mirrors samples/express/server.mjs's /api/my-stats; reads the same
// Netlify Blobs store log-question.mjs writes to.
const STORE_NAME = "cg-exam-question-log";
const BLOB_KEY = "entries";

function truncateText(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

// GET /api/my-stats?sessionId=... — unauthenticated (no ANALYTICS_PASSWORD
// needed), unlike /api/analytics: it only ever returns a single count
// scoped to the sessionId the caller already holds (a random id avatar.js
// generates into localStorage), never the full log or anyone else's data.
// Powers the certification-picker screen's "questions asked so far" stat
// and the tutor's personalized greeting.
export default async (req) => {
  const url = new URL(req.url);
  const sessionId = truncateText(url.searchParams.get("sessionId"), 100);
  if (!sessionId) {
    return Response.json({ count: 0 });
  }
  try {
    const store = getStore(STORE_NAME);
    const entries = (await store.get(BLOB_KEY, { type: "json" })) ?? [];
    const count = entries.filter((entry) => entry.sessionId === sessionId).length;
    return Response.json({ count });
  } catch (err) {
    console.error("[analytics] failed to read question log for my-stats:", err);
    return Response.json({ count: 0 });
  }
};

export const config = { path: "/api/my-stats" };
