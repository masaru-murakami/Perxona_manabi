import { PRESENTER_URL, DEMO_DEFAULTS, HAS_CHAT } from "./_lib.mjs";

// GET /api/config → { mock, chat, presenterUrl, defaults }
// Mirrors samples/express/server.mjs's /api/config, minus the mock/fixedTarget
// options this deploy doesn't use.
export default async () => {
  return Response.json({
    mock: false,
    chat: HAS_CHAT,
    presenterUrl: PRESENTER_URL,
    defaults: DEMO_DEFAULTS,
    fixedTarget: null,
  });
};

export const config = { path: "/api/config" };
