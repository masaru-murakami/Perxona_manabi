import { authedCall, voices, errorResponse } from "./_lib.mjs";

// GET /api/connect-token → { connect_token }
// Validates the cached (or freshly logged-in) shared token against a cheap
// upstream call before handing it to the browser — same approach as
// samples/express/server.mjs.
export default async () => {
  try {
    const token = await authedCall(async (t) => {
      await voices(t);
      return t;
    });
    return Response.json(
      { connect_token: token },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/connect-token" };
