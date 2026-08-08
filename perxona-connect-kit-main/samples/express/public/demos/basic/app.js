/**
 * Perxona Connect Kit — frontend
 *
 * Catalog selection, presenter initialization, performance playback, and an
 * optional LLM chat panel. The server authenticates with its own Connect
 * credentials (see .env) — there is no browser login step.
 * Zero dependencies — plain ESM, no build step required.
 */

// ── Presenter engine bootstrap ───────────────────────────────────────────────

/**
 * Load the presenter engine <script> for the URL the server resolved from
 * PRESENTER_URL (GET /api/config → presenterUrl). This replaces server-side
 * HTML templating (index.html has no %PRESENTER_URL% placeholder to fill) so
 * the same static build can target any CDN just by changing the env var.
 * @returns {Promise<void>} resolves once the presenter engine module has loaded
 */
async function loadPresenterEngine(presenterUrl) {
  // DEMO-ONLY: presenterUrl is trusted as-is with no host allowlist before
  // being injected as a <script src>. Acceptable for this sample, but not
  // production-ready — a real integration should validate presenterUrl
  // against a known CDN allowlist first.
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = presenterUrl;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Failed to load presenter engine from ${presenterUrl}`));
    document.head.append(script);
  });
}

const appConfig = await request("/api/config");

// Mock mode only supports catalog browsing — the presenter always resolves
// its target directly against the real Connect API, so launching it (loading
// the engine script, enabling Launch, allowing playback) is disabled whenever
// the server reports mock mode.
const isPresenterLaunchDisabled = appConfig.mock;
const fixedTarget = appConfig.fixedTarget;
const hasFixedTarget = Boolean(fixedTarget);
const isFixedByoTtsTarget = hasFixedTarget && !fixedTarget.voiceId;

// Block the rest of this module until the presenter engine is loaded, so
// <sv-presenter> is upgraded before any code below can call its methods.
if (!isPresenterLaunchDisabled) {
  await loadPresenterEngine(appConfig.presenterUrl);
}

// ── DOM refs ───────────────────────────────────────────────────────────────

const avatarSelect = document.getElementById("avatar-select");
const sceneSelect = document.getElementById("scene-select");
const voiceSelect = document.getElementById("voice-select");
const avatarIcon = document.getElementById("avatar-icon");
const sceneIcon = document.getElementById("scene-icon");
const initBtn = document.getElementById("init-btn");
const statusMsg = document.getElementById("status-msg");
const stagePlaceholder = document.getElementById("stage-placeholder");

// Performance controls
const perfControls = document.getElementById("perf-controls");
const sayForm = document.getElementById("say-form");
const sayInput = document.getElementById("say-input");
const stopBtn = document.getElementById("stop-btn");
const audioForm = document.getElementById("audio-form");
const audioFileInput = document.getElementById("audio-file");
const audioTextInput = document.getElementById("audio-text");
const presetGrid = perfControls.querySelector(".preset-grid");

// Chat panel (opt-in)
const chatPanel = document.getElementById("chat-panel");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");
const chatHint = document.getElementById("chat-hint");

/** In-memory conversation history (OpenAI message format), reset on reload. */
const chatHistory = [];

// No client-side AvatarConfig bookkeeping needed anymore: presenter.initialize()
// takes a Connect token + target, and presenter.present() builds the Performance
// internally via the Connect API. initBtn's click handler reads the picked
// avatarId/sceneId/voiceId straight from the <select>s and passes them through.

/** @type {HTMLElement & import('@perxona/presenter-types').IPresentationWidget} */
const presenter = document.querySelector("sv-presenter");

// ── API helper ─────────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper. Accepts a plain-object body (auto-serialised to JSON).
 * Throws on non-2xx with { message, status, data } attached.
 * @param {string} path
 * @param {{ method?: string, body?: object }} [opts]
 * @returns {Promise<any>}
 */
async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail) ??
      data.error ??
      res.statusText;
    throw Object.assign(new Error(message), { status: res.status, data });
  }
  return res.json();
}

// ── Catalog ────────────────────────────────────────────────────────────────

// Full catalog items (id, name, thumbnail_urls, …) keyed by list, so change
// handlers can look up thumbnail_urls without a second network round-trip.
// fillSelect() only needs { id, name } for <option>s — native <select> can't
// render images inline, so the preview <img> beside each select is updated
// separately via updateAssetIcon().
let avatars = [];
let scenes = [];

function fillSelect(select, items) {
  select.replaceChildren(
    ...items.map(({ id, name }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      return opt;
    }),
  );
}

/**
 * Show the thumbnail for the selected item (looked up by id in `items`), or
 * hide the <img> when there's no matching thumbnail_urls entry. A broken/expired
 * CDN URL falls back to hidden via onerror rather than showing a broken-image icon.
 * @param {HTMLImageElement} img
 * @param {Array<{ id: string, thumbnail_urls?: Record<string, string> }>} items
 * @param {string} id
 * @param {string} thumbnailKey  e.g. 'head' for avatars, 'default' for scenes
 */
function updateAssetIcon(img, items, id, thumbnailKey) {
  const url = items.find((item) => item.id === id)?.thumbnail_urls?.[
    thumbnailKey
  ];
  if (!url) {
    img.hidden = true;
    img.removeAttribute("src");
    return;
  }
  img.onerror = () => {
    img.hidden = true;
  };
  img.src = url;
  img.hidden = false;
}

function updateInitBtn() {
  initBtn.disabled =
    isPresenterLaunchDisabled ||
    (!hasFixedTarget && (!avatarSelect.value || !sceneSelect.value));
}

function applyFixedTargetMode() {
  if (!hasFixedTarget) return;

  avatarSelect.closest(".field-group")?.toggleAttribute("hidden", true);
  initBtn.hidden = true;
  avatarIcon.hidden = true;
  sceneIcon.hidden = true;
  updateInitBtn();

  // The default placeholder tells the visitor to pick an avatar/scene and click
  // Launch — neither applies here: the picker is hidden above, and the bootstrap
  // below auto-clicks initBtn for a fixed target, so there's nothing to select or
  // click.
  stagePlaceholder.querySelector("p").textContent =
    "Fixed target configured — launching automatically…";
}

avatarSelect.addEventListener("change", () => {
  updateInitBtn();
  updateAssetIcon(avatarIcon, avatars, avatarSelect.value, "head");
});
sceneSelect.addEventListener("change", () => {
  updateInitBtn();
  updateAssetIcon(sceneIcon, scenes, sceneSelect.value, "default");
});

async function loadCatalog() {
  if (hasFixedTarget) {
    applyFixedTargetMode();
    setStatus(
      isPresenterLaunchDisabled
        ? "Configure live credentials to launch the presenter."
        : "",
    );
    return;
  }

  setStatus("Loading catalog…");
  try {
    const [{ items: avatarList }, { items: sceneList }, { items: voiceList }] =
      await Promise.all([
        request("/api/avatars"),
        request("/api/scenes"),
        request("/api/voices"),
      ]);
    avatars = avatarList;
    scenes = sceneList;
    fillSelect(avatarSelect, avatarList);
    fillSelect(sceneSelect, sceneList);
    fillSelect(voiceSelect, voiceList);
    updateInitBtn();
    updateAssetIcon(avatarIcon, avatars, avatarSelect.value, "head");
    updateAssetIcon(sceneIcon, scenes, sceneSelect.value, "default");
    if (isPresenterLaunchDisabled) {
      stagePlaceholder.querySelector("p").textContent =
        "Mock mode supports catalog browsing only.";
      setStatus("Configure live credentials to launch the presenter.");
    } else {
      setStatus("");
    }
  } catch (err) {
    const credentialHint =
      err.status === 401 || err.status === 403
        ? " — check the server's PERXONA_CONNECT_EMAIL/PASSWORD in .env"
        : "";
    setStatus(`Catalog error: ${err.message}${credentialHint}`);
  }
}

// ── Presenter events ───────────────────────────────────────────────────────

const STATUS_LABELS = {
  Uninitialized: "",
  Initializing: "Initializing…",
  Ready: "✓ Ready",
};

presenter.addEventListener("PRESENTER_STATUS", (e) => {
  const { status } = e.detail;
  setStatus(STATUS_LABELS[status] ?? status);
  if (status === "Ready") {
    stagePlaceholder.hidden = true;
    presenter.hidden = false;
    perfControls.hidden = false;
    if (isFixedByoTtsTarget) {
      presetGrid.hidden = true;
      sayForm.hidden = true;
      setStatus("✓ Ready — BYO-TTS: provide audio below.");
    }
  }
});

// The presenter fires CONNECT_TOKEN_EXPIRED whenever a Connect API call inside
// the SDK returns 401 — including during initialize() and during playback. The
// call that triggered the event still fails; refreshConnectToken() only swaps
// in a fresh token for *subsequent* calls, so a failed initialize()/present()
// needs the user (or the calling code) to retry it.
// isRefreshingToken guards against overlapping refreshes if the event fires
// again (e.g. from a second in-flight call) before the first one settles.
let isRefreshingToken = false;
presenter.addEventListener("CONNECT_TOKEN_EXPIRED", async () => {
  if (isRefreshingToken) return;
  isRefreshingToken = true;
  try {
    const freshToken = await fetchConnectToken();
    presenter.refreshConnectToken(freshToken);
    setStatus("Connect token refreshed — try again.");
  } catch (err) {
    setStatus(`Token refresh failed: ${err.message}`);
  } finally {
    isRefreshingToken = false;
  }
});

// ── Initialize presenter ───────────────────────────────────────────────────

/**
 * Fetch a fresh Connect bearer token from the server's connect-token
 * endpoint. Split out from the click handler so "get a token" reads as one
 * step, separate from the surrounding UI state management.
 * @returns {Promise<string>} the Connect bearer token
 */
async function fetchConnectToken() {
  const { connect_token } = await request("/api/connect-token");
  return connect_token;
}

/**
 * Build the PresentationTarget for presenter.initialize() from the currently
 * picked avatar/scene/voice <select> values.
 * @returns {{ avatarId: string, sceneId: string, voiceId: (string|undefined) }}
 */
function buildPresentationTarget() {
  if (hasFixedTarget) return fixedTarget;

  return {
    avatarId: avatarSelect.value,
    sceneId: sceneSelect.value,
    voiceId: voiceSelect.value || undefined,
  };
}

initBtn.addEventListener("click", async () => {
  if (isPresenterLaunchDisabled) {
    setStatus("Configure live credentials to launch the presenter.");
    return;
  }

  initBtn.disabled = true;
  setStatus("Fetching connect token…");

  try {
    // resumeAudioPlayback must be called from a direct user gesture to unlock
    // the browser's autoplay policy before the presenter starts audio. It
    // returns a Promise that resolves once the audio context has resumed.
    if (!hasFixedTarget) {
      await presenter.resumeAudioPlayback?.();
    }

    const connectToken = await fetchConnectToken();

    setStatus("Initializing…");
    // initialize() resolves avatar/scene/motions and mints a speech token
    // directly against the Connect API using connectToken — this server no
    // longer assembles that bundle itself (see README "Auth model").
    await presenter.initialize(connectToken, buildPresentationTarget());
    // Status label is then driven by PRESENTER_STATUS events above.
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    initBtn.disabled = false;
  }
});

// ── Performance ────────────────────────────────────────────────────────────
//
// All three entry points (preset buttons, the free-text box, and chat) drive
// the presenter through speak(): presenter.present(text) synthesizes speech
// and resolves motion timing via the Connect API (using the avatar/voice
// resolved by initialize()) and plays it back.

/**
 * Surface a presenter PresentationResult. present() returns a
 * PresentationResult (not void): when `success` is false, `code` and `message`
 * explain why the request was rejected (e.g. presenter not ready, no target
 * resolved yet) so the UI can react instead of silently dropping the line.
 * @param {{ success: boolean, code: string, message?: string }} result
 */
function reportPlaybackResult(result) {
  if (!result?.success) {
    setStatus(`Playback failed (${result?.code}): ${result?.message ?? ""}`);
  }
}

/**
 * Turn a line of text into a presenter performance: present() sends it to the
 * Connect API (using the avatar/voice resolved by initialize()), synthesizes
 * it into speech, and plays it back on the avatar. present() isn't expected
 * to reject, but network/SDK errors are still caught defensively so they
 * surface via setStatus() instead of becoming an unhandled rejection.
 * @param {string} message
 */
async function speak(message) {
  const text = message.trim();
  if (!text) return;
  if (isFixedByoTtsTarget) {
    setStatus("BYO-TTS target: use Present with audio below.");
    return;
  }
  try {
    await presenter.resumeAudioPlayback?.();
    const result = await presenter.present(text);
    reportPlaybackResult(result);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

/**
 * Present a user-supplied audio file with accompanying text: reads the file
 * into an ArrayBuffer and calls presenter.presentWithAudio(). Mirrors speak()
 * in structure — errors surface via setStatus().
 * @param {File} file
 * @param {string} text
 */
async function speakWithAudio(file, text) {
  if (!file || !text.trim()) return;
  try {
    await presenter.resumeAudioPlayback?.();
    const arrayBuffer = await file.arrayBuffer();
    const result = await presenter.presentWithAudio(arrayBuffer, text.trim());
    reportPlaybackResult(result);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

// Preset buttons and the free-text box call presenter.present() directly —
// the widget builds the Performance via the Connect API internally.
perfControls.querySelectorAll(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => speak(btn.dataset.text));
});

sayForm.addEventListener("submit", (e) => {
  e.preventDefault();
  speak(sayInput.value);
  sayInput.value = "";
});

// ── Present with audio file ────────────────────────────────────────────────
audioForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const file = audioFileInput.files[0];
  const text = audioTextInput.value.trim();
  speakWithAudio(file, text);
  audioForm.reset();
});

// Stop: clear the queue and interrupt the current performance immediately.
stopBtn.addEventListener("click", () => {
  presenter.interruptPresentation();
});

// ── Chat (opt-in) ──────────────────────────────────────────────────────────

/** Reveal the chat panel or hint from the static config loaded at startup. */
function updateChatPanel() {
  chatPanel.hidden = appConfig.mock || !appConfig.chat;
  chatHint.hidden = appConfig.mock || Boolean(appConfig.chat);
}

function appendChat(role, content) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.textContent = content;
  chatLog.append(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";

  appendChat("user", text);
  chatHistory.push({ role: "user", content: text });

  try {
    const completion = await request("/api/chat", {
      method: "POST",
      body: { messages: chatHistory },
    });
    const reply = completion.choices?.[0]?.message?.content ?? "";
    if (reply) {
      appendChat("assistant", reply);
      chatHistory.push({ role: "assistant", content: reply });
      speak(reply);
    }
  } catch (err) {
    appendChat("assistant", `⚠️ ${err.message}`);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function setStatus(text) {
  statusMsg.textContent = text;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
// No login step: the server already authenticated with its own Connect
// credentials (see .env), so the catalog can load as soon as the presenter
// engine is ready. Mock mode loads catalog data only.
await loadCatalog();
updateChatPanel();

if (hasFixedTarget && !isPresenterLaunchDisabled) {
  applyFixedTargetMode();
  initBtn.click();
}
