import { authedCall, avatarMotions, errorResponse } from "./_lib.mjs";

// GET /api/avatars/:id/motions → Page[ConnectMotionAssetResponse]
export default async (_req, context) => {
  const id = context.params.id;
  try {
    const data = await authedCall((token) => avatarMotions(id, token));
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/avatars/:id/motions" };
