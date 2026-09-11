// Perxona Presenter integration for the CG Creator mock exam.
//
// This module never reaches into the quiz engine's internals (paper/cur/answers
// are plain `let` bindings in index.html's classic script, not exposed on
// `window`). Instead, index.html calls the four functions exposed here as
// `window.CGExamAvatar.*` at the points where the quiz already has the data:
// start() → onStart, renderQ()'s reveal branch → onReveal + explain (bound to
// the "ask the avatar more" button), showResult() → onResult.
//
// Design notes (see docs/perxona_docs_summary.md.pdf §6 for the original plan):
// - Correct/wrong reactions are canned lines picked client-side — zero LLM
//   latency, zero API cost, since these fire on every single answer.
// - The LLM (via the server's /api/demo-script, already grounded to the real
//   motion catalog — see server.mjs) is only called for the two spots where a
//   generated response actually adds value: the on-demand deeper explanation,
//   and the end-of-exam weak-point summary.
// - Motion IDs are never hard-coded: they're picked from the selected
//   avatar's real GET /api/avatars/:id/motions catalog by keyword match, so
//   this keeps working if the account's avatar/motion catalog changes.

function requestJson(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // response.statusText is always "" over HTTP/2 (no reason phrase in
      // the protocol) — which is how Netlify serves this app in production.
      // Without this fallback, any non-ok response whose body isn't our own
      // JSON { error } shape (a platform-level timeout/gateway error, say)
      // surfaced as a blank error message. `HTTP <status>` guarantees the
      // learner-facing failure text is never empty.
      throw new Error(body.error || response.statusText || `HTTP ${response.status}`);
    }
    return body;
  });
}

// Anonymous per-browser id (no login system exists) so the analytics view
// can group one learner's questions together across a session. Falls back
// to a per-page-load id if localStorage is unavailable (private mode,
// blocked) — analytics just won't be able to group that visitor's questions
// across reloads.
function getSessionId() {
  const key = "cg-exam-session-id";
  const fresh = () =>
    crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = fresh();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return fresh();
  }
}
const sessionId = getSessionId();

// Fire-and-forget logging for the analytics view (analytics.html /
// GET /api/analytics) — never lets a logging failure affect the
// learner-facing question flow, so it's deliberately not awaited by callers.
function logQuestion({ domain, question, reply, success, errorMessage, kind = "ask" }) {
  requestJson("/api/log-question", {
    method: "POST",
    body: {
      sessionId,
      lang: lastLang,
      domain: domain ?? null,
      kind,
      question,
      reply: reply ?? null,
      success,
      errorMessage: errorMessage ?? null,
    },
  }).catch((error) => {
    console.error("[avatar] failed to log question for analytics", error);
  });
}

function loadPresenterEngine(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Presenter failed to load: ${url}`));
    document.head.append(script);
  });
}

const panel = document.querySelector("#avatar-panel");
const bubble = document.querySelector("#avatar-bubble");
const presenter = document.querySelector("sv-presenter");
const statusEl = document.querySelector("#avatar-status");
const askForm = document.querySelector("#avatar-ask-form");
const askInput = document.querySelector("#avatar-ask-input");
const askSubmit = document.querySelector("#avatar-ask-submit");
const askMic = document.querySelector("#avatar-ask-mic");

let config;
let motions = [];
let ready = false;
let audioEnabled = false;
let initPromise;
let currentVoiceId;

// Resolved every time the presenter reaches "Ready" (see markReady() below).
// waitUntilReady() lets speak() hold off briefly instead of silently
// dropping audio when it's called just before the avatar's initial load (or
// a voice/scene reinit) actually finishes — see speak()'s comment for the
// bug this fixes.
let readyWaiters = [];
function markReady() {
  ready = true;
  panel.classList.add("ready");
  setStatus("");
  applyCameraFraming();
  readyWaiters.forEach((resolve) => resolve());
  readyWaiters = [];
}
function waitUntilReady(timeoutMs = 8000) {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// A voice pinned to one language (e.g. "(Japanese only)") cannot speak the
// other language natively — it just reads the text with the wrong accent,
// which is what happened when the exam's language toggle switched to
// English but the avatar kept its Japanese-only voice. Pick one voice per
// UI language instead; ensureVoice() re-initializes the Presenter with the
// right one on demand (cheap: same avatar/scene, so assets are already
// cached — only the voice/TTS config actually changes).
const VOICE_BY_LANG = {
  ja: "01KT9NE031K3MWGCXMYZ078TKD", // Female - cheerful and clear (Japanese only)
  en: "01KZFF41AV1D4FJNM81PZSSX6E", // Female - warm and cheerful (multilingual)
};

// "Japanese accent" mode is the fun opposite of the fix above: it forces the
// Japanese-only voice on regardless of UI language, so English lines get
// read back in a Japanese accent (Japanese lines just sound normal). Off by
// default — the toggle in the panel is what turns it on.
let accentMode = false;
let lastLang = "ja";
// Set by onLangChange... no — set by onExamLoad(), called once by
// index.html's loadExam() when the learner picks a certification (see
// data/manifest.json). Every LLM prompt below refers to this instead of a
// hardcoded exam name, so avatar.js works for whichever exam is loaded.
// Falls back to a generic phrase before any exam has loaded yet.
let examTitle = { ja: "検定試験", en: "certification exam" };
function tutorPhrase(lang) {
  return lang === "ja"
    ? `あなたは${examTitle.ja}の家庭教師アバターです。`
    : `You are a friendly tutor avatar for the ${examTitle.en} exam.`;
}
// The question currently on screen, kept in sync by index.html's renderQ()
// calling onQuestion() on every render (question change or lang toggle).
// Gives the free-text "ask the AI" form the same grounding the "ask the
// avatar more" button gets, without avatar.js reaching into quiz internals.
let currentQuestion = null;
// A live "Hint" dialogue: null when none is active. Set by hint() after its
// opening reply, appended to by continueHint() (routed there instead of
// askQuestion() by the ask-form's submit handler whenever this is non-null),
// and reset to null by onQuestion() — i.e. it never survives navigating to
// another question, answering the current one, or a language toggle
// (onQuestion fires on all three).
let hintConversation = null;
const accentToggle = document.querySelector("#avatar-accent-toggle");
const sceneSelect = document.querySelector("#avatar-scene-select");
let currentSceneId;

function voiceForLang(lang) {
  if (accentMode) return VOICE_BY_LANG.ja;
  return VOICE_BY_LANG[lang] ?? VOICE_BY_LANG.ja;
}

function setStatus(text) {
  statusEl.textContent = text ?? "";
}

// Cuts off whatever the avatar might still be mid-saying/queued. present()
// alone wouldn't do this: per the SDK's own docs, calling it again while
// something is still playing queues behind it rather than interrupting.
// Safe to call when nothing is playing (interruptPresentation() just clears
// an empty queue). Called from say() — so every fresh avatar utterance
// silences whatever came before it — and from onQuestion(), so navigating
// away, answering, or a language toggle also stops stale audio even when
// nothing new is about to speak right away.
function stopSpeaking() {
  try {
    presenter.interruptPresentation?.();
  } catch (error) {
    console.error("[avatar] interruptPresentation failed", error);
  }
}

function say(text) {
  stopSpeaking();
  const clean = (text ?? "").replace(/\[MOTION[^\]]*\]/gi, "").trim();
  bubble.textContent = clean;
  bubble.hidden = !clean;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Finds a real motion ID matching one of the given keywords, checked against
// both the catalog's free-text name and its tags (e.g. "category:talking",
// "pose:idle_02") — most avatars only tag broad categories, not emotions, so
// matching tags is what makes this work at all on a small catalog. Falls
// back to the .env default motion, then the first catalog entry. Never
// invents an ID that isn't in the fetched catalog.
function pickMotion(keywords) {
  for (const kw of keywords) {
    const hit = motions.find(
      (m) =>
        m.name.toLowerCase().includes(kw) ||
        m.tags.some((tag) => tag.includes(kw)),
    );
    if (hit) return hit.id;
  }
  return config?.defaults?.motionId ?? motions[0]?.id;
}

// The floating panel is small (200x200px), so the default full-body framing
// leaves the avatar tiny with lots of dead space. "halfbody" (CameraAngle,
// see @perxona/presenter-types) plus a manual FOV nudge gets a much closer,
// portrait-style shot instead — dialed in empirically (the SDK doesn't
// document what units distance/vertical/horizontal are in) by trying values
// against this avatar until the framing looked right; adjust here if a
// different avatar/scene needs a different crop. Re-applied every time
// PRESENTER_STATUS reports "Ready" (including after a voice-switch
// re-initialize, which resets camera state).
function applyCameraFraming() {
  try {
    presenter.updateCameraAngle?.("halfbody");
    presenter.updateCameraFOV?.({ distance: 0.05, vertical: -10, horizontal: 1 });
  } catch (error) {
    console.error("[avatar] camera framing failed", error);
  }
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    config = await requestJson("/api/config");
    if (config.mock) {
      setStatus("Mock mode — avatar disabled");
      return;
    }
    const { avatarId, sceneId, voiceId } = config.defaults ?? {};
    if (!avatarId || !sceneId) {
      setStatus("Set DEMO_DEFAULT_AVATAR_ID / SCENE_ID in .env");
      return;
    }

    await loadPresenterEngine(config.presenterUrl);

    const motionsRes = await requestJson(
      `/api/avatars/${encodeURIComponent(avatarId)}/motions`,
    );
    motions = (motionsRes.items ?? [])
      .map((m) => ({
        id: m.id ?? m.motion_id,
        name: m.name ?? "",
        tags: (m.tags ?? []).map((tag) => String(tag).toLowerCase()),
      }))
      .filter((m) => m.id);

    presenter.addEventListener("PRESENTER_STATUS", (event) => {
      if (event.detail?.status === "Ready") {
        markReady();
      }
    });
    presenter.addEventListener("CONNECT_TOKEN_EXPIRED", async () => {
      try {
        const { connect_token } = await requestJson("/api/connect-token");
        presenter.refreshConnectToken(connect_token);
      } catch (error) {
        console.error("[avatar] token refresh failed", error);
      }
    });

    setStatus("Starting avatar…");
    // Read the quiz's current language (it sets <html lang> in applyStatic())
    // so the very first initialize() already picks the right voice instead
    // of starting in Japanese and immediately re-initializing for English.
    const initialLang = document.documentElement.lang === "en" ? "en" : "ja";
    lastLang = initialLang;
    applyAskFormLang(initialLang);
    currentVoiceId = voiceForLang(initialLang) ?? voiceId ?? undefined;
    currentSceneId = sceneId;
    const { connect_token } = await requestJson("/api/connect-token");
    await presenter.initialize(connect_token, {
      avatarId,
      sceneId,
      voiceId: currentVoiceId,
    });
  })().catch((error) => {
    console.error("[avatar] init failed", error);
    setStatus(`Avatar unavailable: ${error.message}`);
  });
  return initPromise;
}

// Voice switch (language toggle / accent mode) and scene switch (the panel's
// <select>) both call presenter.initialize() to swap one part of the target.
// Both can fire around the same time — e.g. on page load, a browser can
// restore an already-answered question (firing onReveal → ensureVoice) and a
// restored <select> value (firing switchScene) together — and two overlapping
// initialize() calls race and leave the presenter stuck with no further
// PRESENTER_STATUS "Ready" event. reinitChain forces every reinit through one
// at a time; reinitPresenter() does the actual work once it's its turn.
let reinitChain = Promise.resolve();

function queueReinit(fn) {
  reinitChain = reinitChain.then(fn, fn);
  return reinitChain;
}

async function reinitPresenter({ sceneId, voiceId } = {}) {
  await init();
  if (!config || config.mock) return;
  const targetSceneId = sceneId ?? currentSceneId;
  const targetVoiceId = voiceId ?? currentVoiceId;
  if (targetSceneId === currentSceneId && targetVoiceId === currentVoiceId) {
    return;
  }
  try {
    ready = false;
    panel.classList.remove("ready");
    setStatus(lastLang === "ja" ? "切り替え中…" : "Switching…");
    const { avatarId } = config.defaults ?? {};
    const { connect_token } = await requestJson("/api/connect-token");
    await presenter.initialize(connect_token, {
      avatarId,
      sceneId: targetSceneId,
      voiceId: targetVoiceId,
    });
    currentSceneId = targetSceneId;
    currentVoiceId = targetVoiceId;
    // The presenter re-fires PRESENTER_STATUS → "Ready" once the swapped
    // target finishes loading; the listener registered in init() sets
    // ready/panel.classList/status back at that point.
  } catch (error) {
    console.error("[avatar] reinit failed", error);
    setStatus(`Switch failed: ${error.message}`);
  }
}

// Switches the Presenter to the voice for `lang` if it isn't already active.
// Called at the top of every hook, after init(), so the very first line the
// avatar speaks in a session already uses the right voice.
async function ensureVoice(lang) {
  lastLang = lang;
  await init();
  await queueReinit(() => reinitPresenter({ voiceId: voiceForLang(lang) }));
}

// Re-initializes the Presenter against a different scene, keeping the same
// avatar and voice. Triggered by the scene <select> in the panel — lets
// switching backgrounds happen live in the browser instead of only via the
// server's DEMO_DEFAULT_SCENE_ID env var (which needs a restart to change).
async function switchScene(sceneId) {
  await init();
  await queueReinit(() =>
    reinitPresenter({ sceneId: sceneId || config?.defaults?.sceneId }),
  );
}

async function ensureAudio() {
  if (audioEnabled) return;
  try {
    await presenter.resumeAudioPlayback?.();
    audioEnabled = true;
  } catch (error) {
    // Non-fatal: the bubble text still shows even without audio (e.g. an
    // exam auto-submitted by the timer has no user gesture to unlock audio).
    console.error("[avatar] resumeAudioPlayback failed", error);
  }
}

// Puts the motion cue near the START of the line — per the repo's Presenter
// FAQ, a cue placed at the very end of an utterance often doesn't have time
// to play before speech (and motion) stop.
function withMotion(text, motionId) {
  return motionId ? `[MOTION ${motionId}:1] ${text}` : text;
}

async function speak(scriptText) {
  say(scriptText);
  // The avatar's initial load (or a voice/scene reinit) can still be in
  // flight when this is called — most likely for the "Hint" button, which
  // becomes clickable the instant a question renders, sooner than any other
  // avatar-speech trigger gets its first chance to run. Without this wait,
  // that raced `!ready` here, silently dropping audio while the bubble text
  // still showed (present() was simply never called). Bounded so a genuine
  // failure (or mock mode, where the presenter never becomes ready) still
  // falls back to text-only instead of hanging.
  await waitUntilReady();
  if (!ready) return;
  await ensureAudio();
  try {
    await presenter.present(scriptText);
  } catch (error) {
    console.error("[avatar] present failed", error);
  }
}

const GREETINGS = {
  ja: [
    "さあ、はじめましょう。落ち着いて解いていきましょうね。",
    "頑張ってください、わたしも隣で見ていますよ。",
  ],
  en: [
    "Let's get started — take your time.",
    "Good luck, I'll be right here with you.",
  ],
};
const CORRECT_LINES = {
  ja: ["正解です、その調子!", "いいですね、よく理解できています。", "正解、素晴らしいです。"],
  en: ["Correct, nice work!", "That's right, you've got this.", "Great job, that's correct."],
};
const WRONG_LINES = {
  ja: [
    "おしい、不正解です。解説を確認してみましょう。",
    "残念、違いました。次に活かしましょう。",
    "不正解です。焦らず解説を読んでみてください。",
  ],
  en: [
    "Not quite — let's check the explanation.",
    "That one was wrong, but you'll get the next one.",
    "Incorrect. Take a look at the explanation.",
  ],
};

const ASK_TEXT = {
  ja: {
    placeholder: "AIに質問する…",
    submit: "質問する",
    mic: "音声入力",
    thinking: "考え中…",
    disabled:
      "質問機能を使うにはサーバーの .env に LLM_API_KEY を設定してください。",
    failed: (message) => `回答の取得に失敗しました: ${message}`,
  },
  en: {
    placeholder: "Ask the AI…",
    submit: "Ask",
    mic: "Voice input",
    thinking: "Thinking…",
    disabled: "Set LLM_API_KEY in the server's .env to enable this.",
    failed: (message) => `Failed to get an answer: ${message}`,
  },
};

const HINT_TEXT = {
  ja: {
    thinking: "ヒントを考え中…",
    disabled:
      "ヒント機能を使うにはサーバーの .env に LLM_API_KEY を設定してください。",
    failed: (message) => `ヒントの取得に失敗しました: ${message}`,
    replyPlaceholder: "ヒントに返信する…",
  },
  en: {
    thinking: "Thinking of a hint…",
    disabled: "Set LLM_API_KEY in the server's .env to enable hints.",
    failed: (message) => `Failed to get a hint: ${message}`,
    replyPlaceholder: "Reply to the hint…",
  },
};

// Labels the ask form's placeholder "ask" vs "reply to the hint" depending
// on whether a hint dialogue (hintConversation) is currently active, so the
// same input visibly does double duty instead of silently changing meaning.
function applyAskFormLang(lang) {
  const t = ASK_TEXT[lang] ?? ASK_TEXT.ja;
  const h = HINT_TEXT[lang] ?? HINT_TEXT.ja;
  if (askInput) {
    askInput.placeholder = hintConversation ? h.replyPlaceholder : t.placeholder;
  }
  if (askSubmit) askSubmit.textContent = t.submit;
  if (askMic) {
    askMic.setAttribute("aria-label", t.mic);
    askMic.title = t.mic;
  }
}

// ── Voice input for the ask form (Web Speech API) ───────────────────────────
// Chrome/Edge/Safari only (no Firefox support as of writing) — the mic button
// stays hidden (see the HTML's `hidden` attribute) unless the API exists, so
// unsupported browsers just see the normal text form.
const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

function speechLangFor(lang) {
  return lang === "ja" ? "ja-JP" : "en-US";
}

function stopListening() {
  recognition?.stop();
}

function startListening() {
  if (!SpeechRecognitionCtor || listening) return;
  recognition = new SpeechRecognitionCtor();
  recognition.lang = speechLangFor(lastLang);
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  listening = true;
  askMic.classList.add("listening");
  askMic.setAttribute("aria-pressed", "true");
  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    askInput.value = transcript;
  };
  recognition.onerror = (event) => {
    // "no-speech" / "aborted" fire on ordinary silence or a manual stop —
    // not worth surfacing as an error to the user.
    if (event.error !== "no-speech" && event.error !== "aborted") {
      console.error("[avatar] speech recognition error", event.error);
    }
  };
  recognition.onend = () => {
    listening = false;
    recognition = null;
    askMic.classList.remove("listening");
    askMic.setAttribute("aria-pressed", "false");
    askInput.focus();
  };
  try {
    recognition.start();
  } catch (error) {
    console.error("[avatar] speech recognition failed to start", error);
    listening = false;
    askMic.classList.remove("listening");
    askMic.setAttribute("aria-pressed", "false");
  }
}

// Keyword lists try emotion-specific names first (in case a richer catalog
// has them), then fall back to the broad category tags every catalog is
// likely to have ("category:talking" / "category:idle" / "category:listening").
const MOTION_KEYWORDS = {
  greeting: ["greet", "wave", "hello", "lively gestures", "category:talking"],
  correct: ["happy", "yes", "correct", "cheer", "extend 2 arms", "category:talking"],
  wrong: ["sad", "no", "wrong", "shake", "hand on hip", "category:idle"],
  thinking: ["think", "explain", "lean forward", "category:listening"],
  celebrate: ["celebrate", "happy", "cheer", "extend 2 arms", "category:talking"],
  encourage: ["encourage", "think", "lean forward", "category:idle"],
};

async function onStart(lang) {
  await ensureAudio();
  await ensureVoice(lang);
  const motionId = pickMotion(MOTION_KEYWORDS.greeting);
  await speak(withMotion(pick(GREETINGS[lang] ?? GREETINGS.ja), motionId));
}

async function onReveal(_item, ok, lang) {
  await ensureVoice(lang);
  const motionId = pickMotion(ok ? MOTION_KEYWORDS.correct : MOTION_KEYWORDS.wrong);
  const line = pick(ok ? (CORRECT_LINES[lang] ?? CORRECT_LINES.ja) : (WRONG_LINES[lang] ?? WRONG_LINES.ja));
  await speak(withMotion(line, motionId));
}

// Called by index.html's renderQ() on every question render (navigation or
// lang toggle) so the free-text ask form always has fresh grounding, without
// avatar.js reaching into the quiz engine's own state.
function onQuestion(item, lang, domainName) {
  currentQuestion = { item, lang, domainName };
  lastLang = lang;
  // Every render here means a different question, an answer was just
  // submitted (hiding the Hint button), or a language toggle — none of
  // which a live hint dialogue (or its audio) should survive.
  hintConversation = null;
  stopSpeaking();
  applyAskFormLang(lang);
}

// Called by index.html's setLang() on every toggle click, including on
// screens (e.g. the home screen) that never call onQuestion. Without this,
// toggling language before starting an exam left lastLang stale, and the
// ask form would answer in the previous language until the next question
// render caught it up.
function onLangChange(lang) {
  lastLang = lang;
  stopSpeaking();
  applyAskFormLang(lang);
}

// Called once by index.html's loadExam() right after a certification is
// chosen (see data/manifest.json) — title is that manifest entry's
// {ja, en} display name. Every tutor-framing prompt below reads examTitle
// instead of naming a specific exam, so this file works unmodified for
// whichever certification's data the learner loads.
function onExamLoad(title) {
  if (title?.ja && title?.en) examTitle = title;
}

// Free-text "ask the AI" form. Grounds the answer in whatever question is
// currently on screen (set by onQuestion) but still answers reasonably if
// the question is unrelated or no question is on screen yet. Always answers
// in the current UI language (lastLang), not a possibly-stale
// currentQuestion snapshot — see onLangChange above.
async function askQuestion(rawText) {
  const question = rawText.trim();
  if (!question) return;
  const lang = lastLang;
  const t = ASK_TEXT[lang] ?? ASK_TEXT.ja;
  // Only trust currentQuestion if it was captured in the same language we're
  // about to answer in — otherwise (language toggled on a screen that
  // doesn't re-render a question, e.g. the home screen) it's stale text from
  // the other language and would confuse both the prompt and the analytics
  // log's domain field.
  const hasFreshContext = Boolean(
    currentQuestion && currentQuestion.lang === lang,
  );
  const questionDomain = hasFreshContext ? currentQuestion.domainName : null;
  await ensureVoice(lang);
  say(t.thinking);
  if (!config || config.mock || !config.chat) {
    say(t.disabled);
    logQuestion({
      domain: questionDomain,
      question,
      success: false,
      errorMessage: "chat_disabled",
    });
    return;
  }
  try {
    const context = hasFreshContext
      ? (lang === "ja"
          ? [
              `分野: ${currentQuestion.domainName}`,
              `設問: ${currentQuestion.item.q}`,
              `選択肢: ${currentQuestion.item.c.join(" / ")}`,
              `正解: ${currentQuestion.item.c[currentQuestion.item.a]}`,
            ]
          : [
              `Domain: ${currentQuestion.domainName}`,
              `Question: ${currentQuestion.item.q}`,
              `Choices: ${currentQuestion.item.c.join(" / ")}`,
              `Correct answer: ${currentQuestion.item.c[currentQuestion.item.a]}`,
            ]
        ).join("\n")
      : "";
    const prompt = (
      lang === "ja"
        ? [
            tutorPhrase(lang) + "受験者から次の質問を受け取りました。",
            context,
            `受験者からの質問: ${question}`,
            `上記の設問に関連づけつつ、初学者にも分かるように2〜4文の自然な話し言葉で答えてください。設問とあまり関係のない質問でも、${examTitle.ja}の学習に役立つ範囲で簡潔に答えてください。`,
            "重要: 受験者の質問がどの言語で書かれていても関係なく、回答は必ず日本語で書いてください。Motion Markupは付けないでください。",
          ]
        : [
            tutorPhrase(lang) + " The test-taker asked you the following question.",
            context,
            `Test-taker's question: ${question}`,
            "Answer in 2-4 natural spoken sentences, relating it to the question above when relevant. If it's unrelated, still answer briefly and usefully for exam study.",
            "Important: always answer in English, regardless of what language the test-taker's question is written in. Do not add Motion Markup.",
          ]
    )
      .filter(Boolean)
      .join("\n");
    const result = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: config.defaults.avatarId, prompt },
    });
    const motionId = pickMotion(MOTION_KEYWORDS.thinking);
    await speak(withMotion(result.script, motionId));
    logQuestion({
      domain: questionDomain,
      question,
      reply: result.reply,
      success: true,
    });
  } catch (error) {
    console.error("[avatar] ask failed", error);
    say(t.failed(error.message));
    logQuestion({
      domain: questionDomain,
      question,
      success: false,
      errorMessage: error.message,
    });
  }
}

// "Hint" button — only shown by index.html in Practice mode before the
// learner answers (see renderQ()'s #hint-row toggle). Always uses
// currentQuestion (set by onQuestion on the same render that shows the
// button, so it's never stale here the way askQuestion's free-text form can
// be from the home screen). Never reveals the correct choice — the prompt
// explicitly forbids it — and always opens by explaining what the question
// is actually asking before nudging toward how to think about it.
async function hint() {
  if (!currentQuestion) return;
  const { item, domainName } = currentQuestion;
  const lang = lastLang;
  const t = HINT_TEXT[lang] ?? HINT_TEXT.ja;
  await ensureVoice(lang);
  say(t.thinking);
  if (!config || config.mock || !config.chat) {
    say(t.disabled);
    logQuestion({
      domain: domainName,
      question: item.q,
      success: false,
      errorMessage: "chat_disabled",
      kind: "hint",
    });
    return;
  }
  try {
    const prompt = (
      lang === "ja"
        ? [
            tutorPhrase(lang) + "受験者はまだこの設問に解答していません。",
            `分野: ${domainName}`,
            `設問: ${item.q}`,
            `選択肢: ${item.c.join(" / ")}`,
            "受験者にヒントを与えてください。全体で200字程度に収めてください: まず1文だけで、この設問が何を問うているのか(意図・着眼点)を簡潔に説明し、そのあとすぐに、選択肢を消去法で1つずつ検討させる短い問いかけを1つ添えてください(例:「まず明らかに違うと思う選択肢はどれですか？なぜそう思いますか？」)。説明を長々と続けず、できるだけ早く問いかけに移ってください。",
            "重要: 正解の選択肢そのものや、選択肢を絞り込んで答えが一意に決まってしまうような決定的な情報は、絶対に教えないでください。あくまで考える方向性を示すだけにとどめてください。Motion Markupは付けないでください。",
          ]
        : [
            tutorPhrase(lang) + " The test-taker has not answered this question yet.",
            `Domain: ${domainName}`,
            `Question: ${item.q}`,
            `Choices: ${item.c.join(" / ")}`,
            "Give the test-taker a hint, about 200 characters total. In just one short sentence, state what the question is actually asking (its intent/focus) — don't elaborate. Then immediately ask one short question that nudges them to work through the choices by elimination (e.g., 'Which option do you think is clearly wrong first, and why?'). Get to that question quickly.",
            "Important: never reveal the correct choice, and never give away information decisive enough to narrow the choices down to a single answer. Only point at the direction of thinking. Do not add Motion Markup.",
          ]
    ).join("\n");
    const result = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: config.defaults.avatarId, prompt },
    });
    const motionId = pickMotion(MOTION_KEYWORDS.thinking);
    await speak(withMotion(result.script, motionId));
    // Opens a hint dialogue: the ask form's submit handler routes to
    // continueHint() instead of askQuestion() while this is set, letting the
    // learner reply here to keep talking it through — see onQuestion() for
    // when this resets.
    hintConversation = {
      item,
      domainName,
      lang,
      turns: [{ role: "assistant", text: result.reply }],
    };
    applyAskFormLang(lang);
    logQuestion({
      domain: domainName,
      question: item.q,
      reply: result.reply,
      success: true,
      kind: "hint",
    });
  } catch (error) {
    console.error("[avatar] hint failed", error);
    say(t.failed(error.message));
    logQuestion({
      domain: domainName,
      question: item.q,
      success: false,
      errorMessage: error.message,
      kind: "hint",
    });
  }
}

// Continues an open hint dialogue (hintConversation) with the learner's
// reply, typed into the same ask-form input the free-text "ask" feature
// uses. Embeds the running transcript in the prompt since /api/demo-script
// is stateless (no server-side conversation memory).
async function continueHint(rawText) {
  const reply = rawText.trim();
  if (!reply || !hintConversation) return;
  const { item, domainName, lang } = hintConversation;
  const t = HINT_TEXT[lang] ?? HINT_TEXT.ja;
  await ensureVoice(lang);
  say(t.thinking);
  if (!config || config.mock || !config.chat) {
    say(t.disabled);
    return;
  }
  hintConversation.turns.push({ role: "user", text: reply });
  try {
    const roleLabel = (role) => {
      if (lang === "ja") return role === "user" ? "受験者" : "アバター";
      return role === "user" ? "Test-taker" : "Tutor";
    };
    const transcript = hintConversation.turns
      .map((turn) => `${roleLabel(turn.role)}: ${turn.text}`)
      .join("\n");
    const prompt = (
      lang === "ja"
        ? [
            tutorPhrase(lang) + "受験者と、次の設問についてヒント対話を続けています。",
            `分野: ${domainName}`,
            `設問: ${item.q}`,
            `選択肢: ${item.c.join(" / ")}`,
            "これまでの会話:",
            transcript,
            "受験者の直前の発言を踏まえ、対話を続けてください。2〜3文程度の自然な話し言葉で応答し、まだ絞り込めていない選択肢があれば、消去法で1つずつ検討を進められるような問いかけを添えてください(例:他にも違うと思う選択肢はありますか？残ったものはなぜ怪しいと思いますか？)。",
            "重要: 正解の選択肢そのものや、選択肢を絞り込んで答えが一意に決まってしまうような決定的な情報は、絶対に教えないでください。Motion Markupは付けないでください。",
          ]
        : [
            tutorPhrase(lang) + " You're continuing a hint dialogue about the following question.",
            `Domain: ${domainName}`,
            `Question: ${item.q}`,
            `Choices: ${item.c.join(" / ")}`,
            "Conversation so far:",
            transcript,
            "Respond to the test-taker's latest message, continuing the dialogue in 2-3 natural spoken sentences. If choices remain unnarrowed, add a follow-up question that nudges them to keep eliminating options one by one (e.g., asking which remaining option looks next-most-doubtful, and why).",
            "Important: never reveal the correct choice, and never give away information decisive enough to narrow the choices down to a single answer. Do not add Motion Markup.",
          ]
    ).join("\n");
    const result = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: config.defaults.avatarId, prompt },
    });
    const motionId = pickMotion(MOTION_KEYWORDS.thinking);
    await speak(withMotion(result.script, motionId));
    hintConversation.turns.push({ role: "assistant", text: result.reply });
    logQuestion({
      domain: domainName,
      question: reply,
      reply: result.reply,
      success: true,
      kind: "hint",
    });
  } catch (error) {
    console.error("[avatar] hint reply failed", error);
    say(t.failed(error.message));
    // Roll back the user's turn so a retry doesn't duplicate it in the
    // transcript sent next time.
    hintConversation.turns.pop();
    logQuestion({
      domain: domainName,
      question: reply,
      success: false,
      errorMessage: error.message,
      kind: "hint",
    });
  }
}

async function explain(item, ok, lang, domainName) {
  await ensureVoice(lang);
  say(lang === "ja" ? "考え中…" : "Thinking…");
  if (!config || config.mock || !config.chat) {
    say(
      lang === "ja"
        ? "解説機能を使うにはサーバーの .env に LLM_API_KEY を設定してください。"
        : "Set LLM_API_KEY in the server's .env to enable this.",
    );
    return;
  }
  try {
    const prompt =
      lang === "ja"
        ? [
            tutorPhrase(lang) + "次の設問について、口頭で少し踏み込んだ解説をしてください。",
            `分野: ${domainName}`,
            `設問: ${item.q}`,
            `選択肢: ${item.c.join(" / ")}`,
            `正解: ${item.c[item.a]}`,
            `受験者の解答は${ok ? "正解でした" : "不正解でした"}。`,
            `公式の簡易解説: ${item.e}`,
            "この簡易解説をふまえ、初学者にも分かるように2〜3文で自然な話し言葉で補足してください。Motion Markupは付けないでください。",
          ].join("\n")
        : [
            tutorPhrase(lang) + " Give a short spoken follow-up explanation.",
            `Domain: ${domainName}`,
            `Question: ${item.q}`,
            `Choices: ${item.c.join(" / ")}`,
            `Correct answer: ${item.c[item.a]}`,
            `The test-taker answered ${ok ? "correctly" : "incorrectly"}.`,
            `Official short explanation: ${item.e}`,
            "Build on it in 2-3 spoken sentences, natural conversational tone. Do not add Motion Markup.",
          ].join("\n");
    const result = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: config.defaults.avatarId, prompt },
    });
    const motionId = pickMotion(MOTION_KEYWORDS.thinking);
    await speak(withMotion(result.script, motionId));
  } catch (error) {
    console.error("[avatar] explain failed", error);
    say(
      lang === "ja"
        ? `解説の取得に失敗しました: ${error.message}`
        : `Failed to get an explanation: ${error.message}`,
    );
  }
}

async function onResult(result, domains, lang) {
  await ensureVoice(lang);
  say(lang === "ja" ? "総評を準備しています…" : "Preparing your summary…");
  if (!config || config.mock || !config.chat) {
    say(
      lang === "ja"
        ? `総合 ${result.score} 点（${result.correct} / 40問正解）。総評を使うには LLM_API_KEY を設定してください。`
        : `Overall ${result.score} pts (${result.correct} / 40 correct). Set LLM_API_KEY to enable the spoken summary.`,
    );
    return;
  }
  try {
    const breakdown = domains
      .map((name, i) => `${name}: ${result.dom[i]}/4`)
      .join(", ");
    const prompt =
      lang === "ja"
        ? [
            tutorPhrase(lang) + "模擬試験の結果を見て、口頭で励ましと弱点分析を伝えてください。",
            `総合得点: ${result.score}点 / 100点（合格ライン70点）`,
            `正答数: ${result.correct} / 40問`,
            `分野別正答数（4問中）: ${breakdown}`,
            "4問中2問以下の分野があれば重点的に指摘し、優しく励ましながら次にやるべきことを一言添えてください。3〜5文の自然な話し言葉で。Motion Markupは付けないでください。",
          ].join("\n")
        : [
            tutorPhrase(lang) + " Review this mock exam result with spoken encouragement and weak-point analysis.",
            `Overall score: ${result.score} / 100 (pass mark 70)`,
            `Correct: ${result.correct} / 40`,
            `Per-domain correct (out of 4): ${breakdown}`,
            "Call out any domain at or below 2/4 as a priority, encourage warmly, and suggest one next step. 3-5 spoken sentences. Do not add Motion Markup.",
          ].join("\n");
    const result_ = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: config.defaults.avatarId, prompt },
    });
    const motionId =
      result.score >= 70
        ? pickMotion(MOTION_KEYWORDS.celebrate)
        : pickMotion(MOTION_KEYWORDS.encourage);
    await speak(withMotion(result_.script, motionId));
  } catch (error) {
    console.error("[avatar] summary failed", error);
    say(
      lang === "ja"
        ? `総評の取得に失敗しました: ${error.message}`
        : `Failed to get the summary: ${error.message}`,
    );
  }
}

const ACCENT_DEMO_LINE = {
  ja: "こんな感じでどうかな?",
  en: "How does this sound now?",
};

accentToggle?.addEventListener("change", async () => {
  accentMode = accentToggle.checked;
  await ensureVoice(lastLang);
  await speak(ACCENT_DEMO_LINE[lastLang] ?? ACCENT_DEMO_LINE.ja);
});

sceneSelect?.addEventListener("change", () => {
  switchScene(sceneSelect.value);
});

askForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  stopListening();
  const text = askInput?.value ?? "";
  if (!text.trim()) return;
  askInput.value = "";
  askInput.disabled = true;
  askSubmit.disabled = true;
  if (askMic) askMic.disabled = true;
  // While a hint dialogue is open (hintConversation set by hint(), cleared
  // by onQuestion() — see its comment), this same input's submissions
  // continue that conversation instead of asking a fresh, unrelated
  // question.
  const task = hintConversation ? continueHint(text) : askQuestion(text);
  task.finally(() => {
    askInput.disabled = false;
    askSubmit.disabled = false;
    if (askMic) askMic.disabled = false;
    askInput.focus();
  });
});

if (askMic && SpeechRecognitionCtor) {
  askMic.hidden = false;
  askMic.addEventListener("click", () => {
    if (listening) stopListening();
    else startListening();
  });
}

window.CGExamAvatar = {
  onStart,
  onReveal,
  explain,
  onResult,
  onQuestion,
  onLangChange,
  onExamLoad,
  hint,
};
init();
