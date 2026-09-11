import { getStore } from "@netlify/blobs";

// Mirrors samples/express/server.mjs's /api/analytics; reads the same
// Netlify Blobs store log-question.mjs writes to.
const STORE_NAME = "cg-exam-question-log";
const BLOB_KEY = "entries";
const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD;

// GET /api/analytics — protected by ANALYTICS_PASSWORD (header
// 'x-analytics-password'). Returns logged cg-exam questions, newest first,
// for analytics.html. 501 until ANALYTICS_PASSWORD is set in the Netlify
// site's environment variables; 401 on a missing or wrong password.
export default async (req) => {
  if (!ANALYTICS_PASSWORD) {
    return Response.json(
      {
        error:
          "ANALYTICS_PASSWORD not configured. Set it in the Netlify site's environment variables to enable the analytics view.",
      },
      { status: 501 },
    );
  }
  if (req.headers.get("x-analytics-password") !== ANALYTICS_PASSWORD) {
    return Response.json({ error: "Invalid analytics password." }, { status: 401 });
  }
  try {
    const store = getStore(STORE_NAME);
    const entries = (await store.get(BLOB_KEY, { type: "json" })) ?? [];
    return Response.json({ count: entries.length, entries });
  } catch (err) {
    console.error("[analytics] failed to read question log:", err);
    return Response.json({ error: "Failed to read the question log." }, { status: 500 });
  }
};

export const config = { path: "/api/analytics" };
