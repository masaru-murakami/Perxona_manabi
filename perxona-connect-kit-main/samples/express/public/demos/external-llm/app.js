const config = await requestJson("/api/config");
let presenterDisabled = config.mock;
let presenterLoadError;
if (!presenterDisabled) {
  try {
    await loadPresenterEngine(config.presenterUrl);
  } catch (error) {
    presenterDisabled = true;
    presenterLoadError = error;
    console.error(error);
  }
}

const avatarSelect = document.querySelector("#avatar-select");
const sceneSelect = document.querySelector("#scene-select");
const voiceSelect = document.querySelector("#voice-select");
const enableAudioBtn = document.querySelector("#launch-btn");
const generateForm = document.querySelector("#generate-form");
const promptInput = document.querySelector("#prompt");
const replyEl = document.querySelector("#reply");
const scriptInput = document.querySelector("#script");
const runBtn = document.querySelector("#run-btn");
const resultEl = document.querySelector("#result");
const status = document.querySelector("#status");
/** @type {HTMLElement & import('@perxona/presenter-types').IPresentationWidget} */
const presenter = document.querySelector("sv-presenter");
const stagePlaceholder = document.querySelector("#stage-placeholder");
let presenterReady = false;
let isAudioEnabled = false;
let isInitializing = false;
let requestedTargetRevision = 0;
let initializedTargetRevision = 0;
let generatedScriptAvatarId;

function requestJson(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? response.statusText);
    return body;
  });
}

async function loadPresenterEngine(url) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Presenter failed to load: ${url}`));
    document.head.append(script);
  });
}

function setStatus(message) {
  status.textContent = message;
}
function fillSelect(select, items, selectedId) {
  select.replaceChildren(
    ...items.map(({ id, name }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${name} (${id})`;
      option.selected = id === selectedId;
      return option;
    }),
  );
}
function updateControls() {
  enableAudioBtn.disabled =
    presenterDisabled || !presenterReady || isAudioEnabled;
  enableAudioBtn.textContent = isAudioEnabled
    ? "Audio Enabled"
    : "Enable Audio";
  runBtn.disabled =
    !scriptInput.value.trim() ||
    (generatedScriptAvatarId !== undefined &&
      generatedScriptAvatarId !== avatarSelect.value);
}

async function loadCatalog() {
  const [{ items: avatars }, { items: scenes }, { items: voices }] =
    await Promise.all([
      requestJson("/api/avatars"),
      requestJson("/api/scenes"),
      requestJson("/api/voices"),
    ]);
  fillSelect(avatarSelect, avatars, config.defaults.avatarId);
  fillSelect(sceneSelect, scenes, config.defaults.sceneId);
  fillSelect(voiceSelect, voices, config.defaults.voiceId);
  if (config.mock) {
    setStatus("Mock mode: generation works; Presenter launch is disabled.");
  } else if (presenterLoadError) {
    setStatus(`Presenter unavailable: ${presenterLoadError.message}`);
  } else {
    schedulePresenterPreload();
  }
  updateControls();
}

function schedulePresenterPreload() {
  requestedTargetRevision += 1;
  presenterReady = false;
  updateControls();
  void initializePresenterForLatestTarget();
}

async function initializePresenterForLatestTarget() {
  if (presenterDisabled || isInitializing) {
    return;
  }

  isInitializing = true;
  let attemptedTargetRevision = initializedTargetRevision;
  try {
    while (initializedTargetRevision !== requestedTargetRevision) {
      const targetRevision = requestedTargetRevision;
      attemptedTargetRevision = targetRevision;
      const target = {
        avatarId: avatarSelect.value,
        sceneId: sceneSelect.value,
        voiceId: voiceSelect.value || undefined,
      };
      if (!target.avatarId || !target.sceneId) {
        initializedTargetRevision = targetRevision;
        break;
      }

      presenterReady = false;
      updateControls();
      setStatus("Preparing Presenter with the configured target…");
      const { connect_token: token } = await requestJson("/api/connect-token");
      await presenter.initialize(token, {
        ...target,
      });
      initializedTargetRevision = targetRevision;
    }
  } catch (error) {
    initializedTargetRevision = attemptedTargetRevision;
    setStatus(`Presenter preparation failed: ${error.message}`);
  } finally {
    isInitializing = false;
    if (initializedTargetRevision !== requestedTargetRevision) {
      void initializePresenterForLatestTarget();
    }
  }
}

presenter.addEventListener("PRESENTER_STATUS", (event) => {
  const current = event.detail?.status;
  setStatus(current === "Ready" ? "Ready" : (current ?? ""));
  if (current === "Ready") {
    presenterReady = true;
    stagePlaceholder.hidden = true;
    presenter.hidden = false;
    setStatus(
      isAudioEnabled
        ? "Presenter ready."
        : "Presenter ready. Enable audio before running a script.",
    );
    updateControls();
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
    const { connect_token: freshToken } =
      await requestJson("/api/connect-token");
    presenter.refreshConnectToken(freshToken);
    setStatus("Connect token refreshed — try again.");
  } catch (error) {
    setStatus(`Token refresh failed: ${error.message}`);
  } finally {
    isRefreshingToken = false;
  }
});

enableAudioBtn.addEventListener("click", async () => {
  enableAudioBtn.disabled = true;
  try {
    await presenter.resumeAudioPlayback?.();
    isAudioEnabled = true;
    setStatus("Presenter ready. Audio enabled.");
    updateControls();
  } catch (error) {
    setStatus(`Audio setup failed: ${error.message}`);
    updateControls();
  }
});

avatarSelect.addEventListener("change", () => {
  generatedScriptAvatarId = undefined;
  scriptInput.value = "";
  replyEl.textContent = "";
  resultEl.textContent = "";
  updateControls();
  schedulePresenterPreload();
});
sceneSelect.addEventListener("change", schedulePresenterPreload);
voiceSelect.addEventListener("change", schedulePresenterPreload);

generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = generateForm.querySelector("button");
  button.disabled = true;
  try {
    const result = await requestJson("/api/demo-script", {
      method: "POST",
      body: { avatarId: avatarSelect.value, prompt: promptInput.value },
    });
    replyEl.textContent = result.reply;
    scriptInput.value = result.script;
    generatedScriptAvatarId = avatarSelect.value;
    resultEl.textContent = `Grounded motions: ${result.motions.map(({ id, name }) => `${name} (${id})`).join(", ")}`;
    updateControls();
  } catch (error) {
    resultEl.textContent = `Generation failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
scriptInput.addEventListener("input", updateControls);
runBtn.addEventListener("click", async () => {
  if (!presenterReady) {
    setStatus("Presenter is still preparing. Try again when it is ready.");
    return;
  }
  try {
    if (!isAudioEnabled) {
      await presenter.resumeAudioPlayback?.();
      isAudioEnabled = true;
      updateControls();
    }
    resultEl.textContent = JSON.stringify(
      await presenter.present(scriptInput.value.trim()),
      null,
      2,
    );
  } catch (error) {
    resultEl.textContent = `Presentation failed: ${error.message}`;
  }
});
document.querySelector("#copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(scriptInput.value);
  setStatus("Script copied.");
});
document.querySelectorAll("[data-copy-code]").forEach((button) => {
  button.addEventListener("click", async () => {
    const code = document.querySelector(`#${button.dataset.copyCode}`);
    await navigator.clipboard.writeText(code.textContent);
    setStatus("Code copied.");
  });
});

loadCatalog().catch((error) => setStatus(`Catalog failed: ${error.message}`));
