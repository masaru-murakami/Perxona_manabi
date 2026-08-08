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
const status = document.querySelector("#status");
const motionsEl = document.querySelector("#motions");
/** @type {HTMLElement & import('@perxona/presenter-types').IPresentationWidget} */
const presenter = document.querySelector("sv-presenter");
const stagePlaceholder = document.querySelector("#stage-placeholder");
const presentBtn = document.querySelector("#present-btn");
const scriptInput = document.querySelector("#script-input");
const resultEl = document.querySelector("#result");
const stopBtn = document.querySelector("#stop-btn");
let motions = [];
let presenterReady = false;
let isAudioEnabled = false;
let isInitializing = false;
let requestedTargetRevision = 0;
let initializedTargetRevision = 0;

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
  presentBtn.disabled = !presenterReady || !isAudioEnabled;
  stopBtn.disabled = !presenterReady || !isAudioEnabled;
}

function showResult(value) {
  resultEl.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
  await loadMotions();
  if (config.mock) {
    setStatus(
      "Mock mode: catalog and script generation are available; Presenter launch is disabled.",
    );
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

async function loadMotions() {
  if (!avatarSelect.value) return;
  const response = await requestJson(
    `/api/avatars/${encodeURIComponent(avatarSelect.value)}/motions`,
  );
  motions = response.items.map((item) => ({
    id: item.id ?? item.motion_id,
    name: item.name,
  }));
  motionsEl.replaceChildren(
    ...motions.map((motion) => {
      const row = document.createElement("div");
      row.className = "motion-row";
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = motion.name;
      const id = document.createElement("code");
      id.textContent = motion.id;
      details.append(name, id);
      if (motion.id === config.defaults.motionId) {
        const defaultLabel = document.createElement("small");
        defaultLabel.textContent = "Default";
        defaultLabel.className = "default-motion";
        details.append(defaultLabel);
      }
      row.append(details);
      const preview = document.createElement("button");
      preview.className = "secondary";
      preview.textContent = "Preview";
      preview.onclick = () => previewMotion(motion.id);
      const insert = document.createElement("button");
      insert.className = "secondary";
      insert.textContent = "Insert";
      insert.onclick = () => {
        scriptInput.value += `${scriptInput.value.endsWith(" ") ? "" : " "}[MOTION ${motion.id}:1] `;
      };
      row.append(preview, insert);
      return row;
    }),
  );
}

async function previewMotion(motionId) {
  if (!presenterReady) {
    setStatus("Wait until the Presenter is ready before previewing a motion.");
    return;
  }
  showResult(await presenter.playMotion(motionId));
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
        : "Presenter ready. Enable audio before speaking.",
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

avatarSelect.addEventListener("change", () =>
  loadMotions()
    .then(schedulePresenterPreload)
    .catch((error) => setStatus(error.message)),
);
sceneSelect.addEventListener("change", schedulePresenterPreload);
voiceSelect.addEventListener("change", schedulePresenterPreload);
document
  .querySelector("#say-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = document.querySelector("#say-input").value.trim();
    if (!presenterReady || !isAudioEnabled || !text) return;
    showResult(await presenter.present(text));
  });
presentBtn.addEventListener("click", async () => {
  if (!scriptInput.value.trim()) return;
  if (!presenterReady || !isAudioEnabled) {
    setStatus("Enable audio before presenting a script.");
    return;
  }
  showResult(await presenter.present(scriptInput.value.trim()));
});
stopBtn.addEventListener("click", () => presenter.interruptPresentation());
document.querySelector("#copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(scriptInput.value);
  setStatus("Script copied.");
});

loadCatalog().catch((error) => setStatus(`Catalog failed: ${error.message}`));
