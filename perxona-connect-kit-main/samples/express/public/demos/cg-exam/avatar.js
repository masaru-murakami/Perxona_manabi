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
    if (!response.ok) throw new Error(body.error ?? response.statusText);
    return body;
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

let config;
let motions = [];
let ready = false;
let audioEnabled = false;
let initPromise;

function setStatus(text) {
  statusEl.textContent = text ?? "";
}

function say(text) {
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
        ready = true;
        panel.classList.add("ready");
        setStatus("");
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
    const { connect_token } = await requestJson("/api/connect-token");
    await presenter.initialize(connect_token, {
      avatarId,
      sceneId,
      voiceId: voiceId || undefined,
    });
  })().catch((error) => {
    console.error("[avatar] init failed", error);
    setStatus(`Avatar unavailable: ${error.message}`);
  });
  return initPromise;
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
  await init();
  const motionId = pickMotion(MOTION_KEYWORDS.greeting);
  await speak(withMotion(pick(GREETINGS[lang] ?? GREETINGS.ja), motionId));
}

async function onReveal(_item, ok, lang) {
  await init();
  const motionId = pickMotion(ok ? MOTION_KEYWORDS.correct : MOTION_KEYWORDS.wrong);
  const line = pick(ok ? (CORRECT_LINES[lang] ?? CORRECT_LINES.ja) : (WRONG_LINES[lang] ?? WRONG_LINES.ja));
  await speak(withMotion(line, motionId));
}

async function explain(item, ok, lang, domainName) {
  await init();
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
            "あなたはCGクリエイター検定の家庭教師アバターです。次の設問について、口頭で少し踏み込んだ解説をしてください。",
            `分野: ${domainName}`,
            `設問: ${item.q}`,
            `選択肢: ${item.c.join(" / ")}`,
            `正解: ${item.c[item.a]}`,
            `受験者の解答は${ok ? "正解でした" : "不正解でした"}。`,
            `公式の簡易解説: ${item.e}`,
            "この簡易解説をふまえ、初学者にも分かるように2〜3文で自然な話し言葉で補足してください。Motion Markupは付けないでください。",
          ].join("\n")
        : [
            "You are a friendly tutor avatar for a CG creator certification exam. Give a short spoken follow-up explanation.",
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
  await init();
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
            "あなたはCGクリエイター検定の家庭教師アバターです。模擬試験の結果を見て、口頭で励ましと弱点分析を伝えてください。",
            `総合得点: ${result.score}点 / 100点（合格ライン70点）`,
            `正答数: ${result.correct} / 40問`,
            `分野別正答数（4問中）: ${breakdown}`,
            "4問中2問以下の分野があれば重点的に指摘し、優しく励ましながら次にやるべきことを一言添えてください。3〜5文の自然な話し言葉で。Motion Markupは付けないでください。",
          ].join("\n")
        : [
            "You are a friendly tutor avatar for a CG creator certification exam. Review this mock exam result with spoken encouragement and weak-point analysis.",
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

window.CGExamAvatar = { onStart, onReveal, explain, onResult };
init();
