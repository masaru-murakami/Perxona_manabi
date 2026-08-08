import {
  authedCall,
  avatarMotions,
  requestLlmCompletion,
  llmResponseText,
  parseJsonObject,
  buildDemoScriptPrompt,
  validateDemoScript,
  DEMO_SCRIPT_JSON_SCHEMA,
  LLM_API_KEY,
  errorResponse,
} from "./_lib.mjs";

// POST /api/demo-script
// Request:  { avatarId: string, prompt: string }
// Response: { reply: string, script: string, motions: [{ id, name }] }
//
// The server owns the motion catalog so the LLM can only ever reference real
// motion IDs — the returned Motion Markup is validated before it's exposed to
// the browser. See samples/express/server.mjs for the original, more heavily
// commented version this is ported from.
export default async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const avatarId = body?.avatarId;
  const prompt = body?.prompt;
  if (typeof avatarId !== "string" || !avatarId.trim()) {
    return Response.json({ error: "'avatarId' is required." }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "'prompt' is required." }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return Response.json(
      { error: "'prompt' must be 2000 characters or fewer." },
      { status: 400 },
    );
  }

  try {
    const page = await authedCall((token) => avatarMotions(avatarId, token));
    const motions = (page.items ?? [])
      .map((motion) => ({ id: motion.id ?? motion.motion_id, name: motion.name }))
      .filter(({ id, name }) => typeof id === "string" && typeof name === "string");
    if (motions.length === 0) {
      return Response.json(
        { error: "The selected avatar has no usable motions." },
        { status: 422 },
      );
    }

    if (!LLM_API_KEY) {
      return Response.json(
        { error: "LLM_API_KEY not configured. Set it in the Netlify site's environment variables." },
        { status: 501 },
      );
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
      return Response.json(
        { error: "LLM response did not include message content." },
        { status: 502 },
      );
    }
    const demoScriptResult = parseJsonObject(content);
    if (typeof demoScriptResult.reply !== "string" || !demoScriptResult.reply.trim()) {
      return Response.json(
        { error: "LLM response must include a non-empty reply." },
        { status: 502 },
      );
    }
    const script = validateDemoScript(demoScriptResult.script, motions);
    return Response.json({ reply: demoScriptResult.reply.trim(), script, motions });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/demo-script" };
