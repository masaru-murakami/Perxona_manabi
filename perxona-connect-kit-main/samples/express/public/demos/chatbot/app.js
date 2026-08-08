/**
 * Perxona Connect Kit — Chatbot Demo
 *
 * Shows the full chatbot lifecycle integrated with sv-presenter:
 *   1. Chatbot CRUD — create, read, update, delete via /api/chatbots proxy
 *   2. Multi-turn conversation using the Connect chatbot chat API
 *   3. Each assistant reply is piped into sv-presenter for live speech playback
 *
 * The Connect chatbot messages format differs from OpenAI's: each message has a
 * `parts` array instead of a plain `content` string:
 *   { role: "user"|"assistant", parts: [{ type: "text", text: "…" }] }
 *
 * Zero dependencies — plain ESM, no build step required.
 */

// ── Presenter engine bootstrap ───────────────────────────────────────────────

/**
 * Dynamically inject the presenter engine <script>. Resolved from the server's
 * PRESENTER_URL env var (GET /api/config → presenterUrl) so the same static
 * build can target any CDN by changing the env var alone.
 * @param {string} presenterUrl
 * @returns {Promise<void>}
 */
async function loadPresenterEngine(presenterUrl) {
  // DEMO-ONLY: presenterUrl is trusted without host validation. A production
  // integration should verify presenterUrl against a known CDN allowlist.
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
const isPresenterLaunchDisabled = appConfig.mock;

// Block module execution until the presenter custom element is defined, so
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

// Chatbot manager — custom bot picker (replaces native <select> to avoid
// Chrome's native-dropdown misposition bug inside scrolled overflow containers)
const botPickerBtn = document.getElementById("bot-picker-btn");
const botPickerLabel = document.getElementById("bot-picker-label");
const botPickerList = document.getElementById("bot-picker-list");
const botDeleteBtn = document.getElementById("bot-delete-btn");
const botEditor = document.getElementById("bot-editor");
const botEditorSummary = document.getElementById("bot-editor-summary");
const botNameInput = document.getElementById("bot-name");
const botInstructionsInput = document.getElementById("bot-instructions");
const botSaveBtn = document.getElementById("bot-save-btn");
const botCancelBtn = document.getElementById("bot-cancel-btn");
const botStatusMsg = document.getElementById("bot-status");
// Knowledge file
const botKnowledgeFileInput = document.getElementById("bot-knowledge-file");
const botKnowledgeFilename = document.getElementById("bot-knowledge-filename");
const botKnowledgeStatus = document.getElementById("bot-knowledge-status");
const botKnowledgeRemoveBtn = document.getElementById(
  "bot-knowledge-remove-btn",
);
// Function tools
const botToolsInput = document.getElementById("bot-tools");
const botToolsCount = document.getElementById("bot-tools-count");
const botToolsExampleBtn = document.getElementById("bot-tools-example-btn");
const botIdRow = document.getElementById("bot-id-row");
const botIdValue = document.getElementById("bot-id-value");
const botIdCopy = document.getElementById("bot-id-copy");
const botNewBtn = document.getElementById("bot-new-btn");

// Chat panel
const chatPlaceholder = document.getElementById("chat-placeholder");
const chatHintText = document.getElementById("chat-hint-text");
const chatContent = document.getElementById("chat-content");
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

// Debug timeline panel
const debugPanel = document.getElementById("debug-panel");
const debugLog = document.getElementById("debug-log");
const debugClearBtn = document.getElementById("debug-clear-btn");

/** @type {HTMLElement & import('@perxona/presenter-types').IPresentationWidget} */
const presenter = document.querySelector("sv-presenter");

// ── App state ──────────────────────────────────────────────────────────────

/** Conversation history for the active chatbot session (Connect message format). */
let chatHistory = [];
/** ID of the currently selected chatbot, or null. */
let activeBotId = null;
/** Lightweight chatbot list from the last /api/chatbots call. */
let chatbotList = [];
/** Whether the presenter has reached Ready status. */
let presenterReady = false;
/** Catalog caches for thumbnail lookups. */
let avatars = [];
let scenes = [];

// ── API helper ─────────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper for JSON APIs. Throws a structured error on non-2xx.
 * 204 No Content resolves to null.
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
  if (res.status === 204) return null;
  return res.json();
}

// ── Catalog ────────────────────────────────────────────────────────────────

function fillSelect(select, items, emptyLabel) {
  select.replaceChildren(
    Object.assign(document.createElement("option"), {
      value: "",
      textContent: emptyLabel,
    }),
    ...items.map(({ id, name }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      return opt;
    }),
  );
}

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
    isPresenterLaunchDisabled || !avatarSelect.value || !sceneSelect.value;
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
    fillSelect(avatarSelect, avatarList, "— select avatar —");
    fillSelect(sceneSelect, sceneList, "— select scene —");
    fillSelect(voiceSelect, voiceList, "— no voice —");
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
        ? " — check PERXONA_CONNECT_EMAIL/PASSWORD in .env"
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
    presenterReady = true;
    stagePlaceholder.hidden = true;
    presenter.hidden = false;
    debugPanel.hidden = false; // reveal the timeline once the avatar is live
    updateChatUI();
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

// ── Presenter lifecycle events (debug timeline) ──────────────────────────
//
// These events expose the internal state machine of sv-presenter so the demo
// can show exactly what happens after present() is called.

presenter.addEventListener("PERFORMANCE_STATE", (e) => {
  const { state } = e.detail;
  appendDebug("sdk", `Presenter state → ${state}`);
});

presenter.addEventListener("PERFORMANCE_START", () => {
  appendDebug("sdk", "Performance started");
});

presenter.addEventListener("PERFORMANCE_END", () => {
  appendDebug("sdk", "Performance segment ended");
});

presenter.addEventListener("ALL_PERFORMANCE_FINISHED", () => {
  appendDebug("ok", "All performances finished — avatar returned to idle ✓");
});

presenter.addEventListener("PLAYING_SPEECH_TEXT", (e) => {
  const raw = e.detail?.text ?? "";
  const preview = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
  appendDebug("sdk", `Speaking: “${preview}”`);
});

// ── Initialize presenter ───────────────────────────────────────────────────

async function fetchConnectToken() {
  const { connect_token } = await request("/api/connect-token");
  return connect_token;
}

initBtn.addEventListener("click", async () => {
  if (isPresenterLaunchDisabled) {
    setStatus("Configure live credentials to launch the presenter.");
    return;
  }
  initBtn.disabled = true;
  setStatus("Fetching connect token…");
  try {
    // resumeAudioPlayback must be called from a direct user gesture to satisfy
    // browser autoplay policy before the presenter attempts audio playback.
    await presenter.resumeAudioPlayback?.();
    const connectToken = await fetchConnectToken();
    setStatus("Initializing…");
    await presenter.initialize(connectToken, {
      avatarId: avatarSelect.value,
      sceneId: sceneSelect.value,
      voiceId: voiceSelect.value || undefined,
    });
    // Status label is then driven by PRESENTER_STATUS events above.
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    initBtn.disabled = false;
  }
});

// ── Speak helper ──────────────────────────────────────────────────────────

/**
 * Send text to the presenter for speech synthesis and playback. Silently
 * skips if the presenter is not yet ready (chat still works as text-only).
 * @param {string} text
 */
async function speak(text) {
  if (!presenterReady || !text.trim()) return;
  appendDebug("cmd", "presenter.setThinking(false)");
  presenter.setThinking?.(false);
  appendDebug("cmd", "presenter.present() — queuing speech + motion");
  try {
    const result = await presenter.present(text.trim());
    if (!result?.success) {
      setStatus(`Playback failed (${result?.code}): ${result?.message ?? ""}`);
      appendDebug(
        "err",
        `present() failed: ${result?.code} — ${result?.message ?? ""}`,
      );
    } else {
      appendDebug("ok", "present() accepted — performance queued ✓");
    }
  } catch (err) {
    setStatus(`Playback error: ${err.message}`);
    appendDebug("err", `present() threw: ${err.message}`);
  }
}

// ── Chatbot Manager ────────────────────────────────────────────────────────

// ── Custom bot picker (replaces native <select>) ───────────────────────────
// Reason: native <select> dropdowns misposition when opened inside a scrolled
// overflow-y: auto container (Chrome). A custom absolute-positioned list avoids
// the issue entirely.

function openBotPicker() {
  botPickerList.hidden = false;
  botPickerBtn.setAttribute("aria-expanded", "true");
}

function closeBotPicker() {
  botPickerList.hidden = true;
  botPickerBtn.setAttribute("aria-expanded", "false");
}

/**
 * Rebuild the picker's option list from the current chatbotList array.
 * @param {Array<{ id: string, name: string, status: string }>} bots
 */
function populateBotPicker(bots) {
  function makeOption(id, label) {
    const li = document.createElement("li");
    li.role = "option";
    li.dataset.botId = id ?? "";
    li.className = `bot-picker-option${id ? "" : " empty-option"}`;
    li.setAttribute("aria-selected", (id === activeBotId).toString());
    li.textContent = label;
    return li;
  }
  botPickerList.replaceChildren(
    makeOption(null, "— select a chatbot —"),
    ...bots.map(({ id, name, status }) =>
      makeOption(id, status === "disabled" ? `${name} (disabled)` : name),
    ),
  );
}

/**
 * Update activeBotId, the picker label, and all dependent UI.
 * Resets conversation history when the active bot changes.
 * @param {string|null} id
 */
function selectChatbot(id) {
  const newId = id || null;
  if (newId !== activeBotId) {
    activeBotId = newId;
    chatHistory = [];
    chatLog.replaceChildren();
  }
  const bot = chatbotList.find((b) => b.id === newId);
  botPickerLabel.textContent = bot
    ? bot.status === "disabled"
      ? `${bot.name} (disabled)`
      : bot.name
    : "— select a chatbot —";
  // Sync aria-selected in the open list
  botPickerList.querySelectorAll(".bot-picker-option").forEach((li) => {
    li.setAttribute(
      "aria-selected",
      (li.dataset.botId === (newId ?? "")).toString(),
    );
  });
  botDeleteBtn.hidden = !activeBotId;
  if (activeBotId) {
    botIdValue.textContent = activeBotId;
    botIdRow.hidden = false;
  } else {
    botIdRow.hidden = true;
    botIdValue.textContent = "";
  }
  updateChatUI();
}

botPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  botPickerList.hidden ? openBotPicker() : closeBotPicker();
});

botPickerList.addEventListener("click", (e) => {
  e.stopPropagation();
  const option = e.target.closest(".bot-picker-option");
  if (!option) return;
  const id = option.dataset.botId || null;
  selectChatbot(id);
  closeBotPicker();
  botEditor.open = false;
  setBotStatus("");
});

// Close picker on any outside click or Escape key.
document.addEventListener("click", closeBotPicker);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeBotPicker();
});

/**
 * Fetch the chatbot list and refresh the picker.
 * Preserves the currently selected bot ID if it still exists after the refresh.
 */
async function loadChatbots() {
  try {
    const { items } = await request("/api/chatbots");
    chatbotList = items ?? [];
    populateBotPicker(chatbotList);
    // Restore previous selection, or clear if the bot was deleted.
    const previousId = activeBotId;
    if (previousId && chatbotList.some((b) => b.id === previousId)) {
      selectChatbot(previousId);
    } else {
      selectChatbot(null);
    }
  } catch (err) {
    setBotStatus(`Failed to load chatbots: ${err.message}`);
  }
}

// Prefill editor when the <details> opens for an existing bot.
botEditor.addEventListener("toggle", async () => {
  if (!botEditor.open || !activeBotId) return;
  try {
    const detail = await request(`/api/chatbots/${activeBotId}`);
    botNameInput.value = detail.name ?? "";
    botInstructionsInput.value = detail.custom_instructions ?? "";
    // Show current knowledge status
    updateKnowledgeStatus(detail.knowledge ?? null);
    // Show tools count but leave textarea empty — the user only fills it
    // when they intend to replace tools (empty = leave unchanged per API semantics)
    const toolCount = detail.tools?.length ?? 0;
    botToolsCount.textContent =
      toolCount > 0
        ? `${toolCount} tool${toolCount === 1 ? "" : "s"} configured`
        : "";
    botToolsInput.value = "";
    // Reset file picker
    botKnowledgeFileInput.value = "";
    botKnowledgeFilename.textContent = "";
  } catch (err) {
    setBotStatus(`Failed to load chatbot details: ${err.message}`);
  }
});

botNewBtn.addEventListener("click", () => {
  selectChatbot(null); // deselect any active bot
  botNameInput.value = "";
  botInstructionsInput.value = "";
  botToolsInput.value = "";
  botToolsCount.textContent = "";
  botKnowledgeFileInput.value = "";
  botKnowledgeFilename.textContent = "";
  updateKnowledgeStatus(null);
  botEditorSummary.textContent = "Create New Chatbot";
  botEditor.open = true;
  botNameInput.focus();
  setBotStatus("");
});

botCancelBtn.addEventListener("click", () => {
  botEditor.open = false;
  // Restore summary label to default
  botEditorSummary.textContent = "Create / Edit";
  setBotStatus("");
});

botSaveBtn.addEventListener("click", async () => {
  const name = botNameInput.value.trim();
  if (!name) {
    setBotStatus("Name is required.");
    return;
  }

  // Validate and parse tools JSON if the user provided any
  let tools = undefined; // undefined = "leave unchanged"
  const toolsRaw = botToolsInput.value.trim();
  if (toolsRaw) {
    try {
      tools = JSON.parse(toolsRaw);
      if (!Array.isArray(tools))
        throw new Error("Tools must be a JSON array — e.g. [] or [{...}].");
    } catch (parseErr) {
      setBotStatus(`Tools JSON error: ${parseErr.message}`);
      return;
    }
  }

  setBotStatus("Saving…");
  botSaveBtn.disabled = true;

  try {
    if (activeBotId) {
      // Update existing chatbot
      await request(`/api/chatbots/${activeBotId}`, {
        method: "PATCH",
        body: {
          name,
          custom_instructions: botInstructionsInput.value.trim() || null,
          tools,
        },
      });
      setBotStatus("Chatbot updated.");
    } else {
      // Create new chatbot
      const created = await request("/api/chatbots", {
        method: "POST",
        body: {
          name,
          custom_instructions: botInstructionsInput.value.trim() || null,
          tools,
        },
      });
      // Select the newly created bot right away
      activeBotId = created.id;
      setBotStatus("Chatbot created.");
    }

    // Upload knowledge file if the user selected one
    const knowledgeFile = botKnowledgeFileInput.files[0];
    if (knowledgeFile && activeBotId) {
      setBotStatus("Uploading knowledge file…");
      const base64 = await fileToBase64(knowledgeFile);
      const updated = await request(`/api/chatbots/${activeBotId}/knowledge`, {
        method: "POST",
        body: {
          filename: knowledgeFile.name,
          content_base64: base64,
          mime_type: knowledgeFile.type || "application/octet-stream",
        },
      });
      updateKnowledgeStatus(updated.knowledge ?? null);
      botKnowledgeFileInput.value = "";
      botKnowledgeFilename.textContent = "";
      setBotStatus("Chatbot saved with knowledge file.");
    }

    botEditor.open = false;
    botEditorSummary.textContent = "Create / Edit";

    const targetChatbotId = activeBotId;
    await loadChatbots();

    // Guard against upstream eventual consistency: if the just-created bot isn't
    // in the refreshed list yet, add it manually so the user sees it immediately.
    if (targetChatbotId && !chatbotList.some((b) => b.id === targetChatbotId)) {
      chatbotList.push({ id: targetChatbotId, name, status: "active" });
      populateBotPicker(chatbotList);
    }
    selectChatbot(targetChatbotId);
  } catch (err) {
    setBotStatus(`Save failed: ${err.message}`);
  } finally {
    botSaveBtn.disabled = false;
  }
});

botDeleteBtn.addEventListener("click", async () => {
  if (!activeBotId) return;
  const bot = chatbotList.find((b) => b.id === activeBotId);
  const botName = bot?.name ?? activeBotId;
  if (!confirm(`Delete chatbot "${botName}"?\n\nThis action cannot be undone.`))
    return;

  try {
    await request(`/api/chatbots/${activeBotId}`, { method: "DELETE" });
    activeBotId = null;
    chatHistory = [];
    chatLog.replaceChildren();
    await loadChatbots();
    setBotStatus("Chatbot deleted.");
  } catch (err) {
    setBotStatus(`Delete failed: ${err.message}`);
  }
});

// ── Chat ───────────────────────────────────────────────────────────────────

/**
 * Show or hide the chat UI depending on whether a bot is active and the
 * presenter is ready. If only one condition is met, show a contextual hint.
 */
function updateChatUI() {
  const hasBot = Boolean(activeBotId);

  // Chat is available as soon as a bot is selected — no presenter required.
  // speak() already silently skips audio when the presenter isn't ready, so
  // the text conversation works independently of the presenter state.
  chatContent.hidden = !hasBot;
  chatSendBtn.disabled = !hasBot;

  if (hasBot) {
    chatPlaceholder.hidden = true;
  } else {
    chatPlaceholder.hidden = false;
    chatHintText.textContent = presenterReady
      ? "Select a chatbot to start chatting."
      : "Select a chatbot to chat. Launch the presenter first to also hear the replies.";
  }
}

/**
 * Append a message bubble to the chat log.
 * @param {"user"|"assistant"|"error"} role
 * @param {string} text
 */
function appendChat(role, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  chatLog.append(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !activeBotId) return;

  chatInput.value = "";
  chatSendBtn.disabled = true;
  chatInput.disabled = true;

  // Add user message to history and display it
  appendChat("user", text);
  appendDebug(
    "user",
    `You sent: “${text.length > 60 ? text.slice(0, 60) + "…" : text}”`,
  );
  chatHistory.push({ role: "user", parts: [{ type: "text", text }] });

  // Signal "thinking" on the presenter while the LLM processes the request
  appendDebug("cmd", "presenter.setThinking(true)");
  presenter.setThinking?.(true);
  presenter.setListening?.(false);

  appendDebug("api", "Calling chatbot API…");
  try {
    // Send only the last MAX_HISTORY_TURNS turns to the chatbot API.
    // Gemini (the LLM powering the Connect chatbot) has a fixed backend
    // deadline. Sending the full unbounded history causes the prompt to
    // grow until it exceeds that deadline → 504 DEADLINE_EXCEEDED.
    // Keeping a sliding window avoids the timeout while preserving recent
    // conversational context. The full history remains in chatHistory for
    // display in the chat log.
    const MAX_HISTORY_TURNS = 20; // 10 user + 10 assistant messages
    const windowedMessages = chatHistory.slice(-MAX_HISTORY_TURNS);

    // POST /api/chatbots/:id/chat → { id, status, reply_text }
    const chatResponse = await request(`/api/chatbots/${activeBotId}/chat`, {
      method: "POST",
      body: { messages: windowedMessages },
    });

    if (chatResponse.status === "succeeded" && chatResponse.reply_text) {
      const reply = chatResponse.reply_text;
      appendChat("assistant", reply);
      appendDebug(
        "bot",
        `Chatbot replied: “${reply.length > 60 ? reply.slice(0, 60) + "…" : reply}”`,
      );
      // Add assistant turn to history so follow-up messages have full context
      chatHistory.push({
        role: "assistant",
        parts: [{ type: "text", text: reply }],
      });
      // Hand the reply text to the presenter for speech + motion playback
      await speak(reply);
    } else {
      // Roll back the user turn — no usable assistant reply was produced.
      // Covers: status === "failed", status === "succeeded" with empty
      // reply_text, or any other unexpected status value. Without this pop,
      // the orphaned user turn would be re-sent on every subsequent message,
      // producing consecutive role:"user" entries that break the parts-based
      // multi-turn format expected by the Connect chatbot API.
      chatHistory.pop();
      const reason =
        chatResponse.status === "failed"
          ? "The chatbot failed to generate a response."
          : `Unexpected response (status: ${chatResponse.status}).`;
      appendChat("error", `${reason}`);
      appendDebug("err", `Chatbot status: ${chatResponse.status}`);
      presenter.setThinking?.(false);
    }
  } catch (err) {
    // Roll back the user turn so a retry doesn't send a duplicate.
    chatHistory.pop();
    appendChat("error", `${err.message}`);
    appendDebug("err", `API error: ${err.message}`);
    presenter.setThinking?.(false);
  } finally {
    chatSendBtn.disabled = !activeBotId;
    chatInput.disabled = false;
    chatInput.focus();
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function setStatus(text) {
  statusMsg.textContent = text;
}

function setBotStatus(text) {
  botStatusMsg.textContent = text;
}

// ── Knowledge file helpers ────────────────────────────────────────────────

/** Knowledge status badge copy & CSS class map. */
const KNOWLEDGE_STATUS_MAP = {
  processing: { label: "Processing…", badgeClass: "processing" },
  ready: { label: "Ready", badgeClass: "ready" },
  error: { label: "Error", badgeClass: "error" },
};

/**
 * Update the knowledge status badge and Remove button from a knowledge DO.
 * @param {{ name: string, status: string } | null} knowledge
 */
function updateKnowledgeStatus(knowledge) {
  if (!knowledge) {
    botKnowledgeStatus.textContent = "No file";
    botKnowledgeStatus.className = "knowledge-badge knowledge-badge--none";
    botKnowledgeRemoveBtn.hidden = true;
    return;
  }
  const { label, badgeClass } = KNOWLEDGE_STATUS_MAP[knowledge.status] ?? {
    label: knowledge.status,
    badgeClass: "none",
  };
  botKnowledgeStatus.textContent = `${knowledge.name} \u2014 ${label}`;
  botKnowledgeStatus.className = `knowledge-badge knowledge-badge--${badgeClass}`;
  botKnowledgeRemoveBtn.hidden = false;
}

/**
 * Read a File as a base64-encoded data string (without the data-URL prefix).
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(/** @type {string} */ (reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Show selected file name next to the file picker
botKnowledgeFileInput.addEventListener("change", () => {
  const file = botKnowledgeFileInput.files[0];
  botKnowledgeFilename.textContent = file ? file.name : "";
});

// Remove knowledge file from the active chatbot
botKnowledgeRemoveBtn.addEventListener("click", async () => {
  if (!activeBotId) return;
  if (!confirm("Remove the knowledge file from this chatbot?")) return;
  try {
    setBotStatus("Removing knowledge file…");
    const updated = await request(`/api/chatbots/${activeBotId}/knowledge`, {
      method: "DELETE",
    });
    updateKnowledgeStatus(updated.knowledge ?? null);
    setBotStatus("Knowledge file removed.");
  } catch (err) {
    setBotStatus(`Remove failed: ${err.message}`);
  }
});

// ── Function tools helpers ────────────────────────────────────────────────

/**
 * A ready-to-use example tool: weather lookup via wttr.in (no API key needed).
 * Good for hackathon demos because it works immediately without any signup.
 */
const TOOL_EXAMPLE = [
  {
    name: "get_weather",
    description:
      "Look up the current weather for a city. Use this when the user asks about weather, temperature, or forecast.",
    settings: {
      request: {
        method: "get",
        url: "https://wttr.in",
        query_params: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "City name in English, e.g. Taipei",
            },
            format: {
              type: "string",
              description:
                "Response format. ALWAYS pass the literal string value '3'",
            },
          },
          required: ["location", "format"],
        },
      },
      auth: { secret_type: "no_auth" },
      response: { body_schema: {} },
    },
  },
];

// Load the example tool JSON into the tools textarea
botToolsExampleBtn.addEventListener("click", () => {
  botToolsInput.value = JSON.stringify(TOOL_EXAMPLE, null, 2);
  botToolsInput.focus();
});

/**
 * Append a timestamped entry to the debug timeline panel.
 *
 * Types and their meaning:
 *   user  — the user sent a message
 *   api   — an API call is in-flight
 *   bot   — chatbot reply received
 *   cmd   — a command sent to sv-presenter (present, setThinking…)
 *   sdk   — an event emitted by the sv-presenter SDK
 *   ok    — a successful outcome
 *   err   — an error
 *
 * @param {"user"|"api"|"bot"|"cmd"|"sdk"|"ok"|"err"} type
 * @param {string} message
 */
function appendDebug(type, message) {
  const now = new Date();
  const ts =
    [
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join(":") +
    "." +
    String(now.getMilliseconds()).padStart(3, "0");

  const li = document.createElement("li");
  li.className = `debug-entry debug-entry--${type}`;

  const tsEl = document.createElement("span");
  tsEl.className = "debug-ts";
  tsEl.textContent = ts;

  const msgEl = document.createElement("span");
  msgEl.className = "debug-msg";
  msgEl.textContent = message;

  li.append(tsEl, msgEl);
  debugLog.append(li);
  debugLog.scrollTop = debugLog.scrollHeight;
}

debugClearBtn.addEventListener("click", () => {
  debugLog.replaceChildren();
});

botIdCopy.addEventListener("click", () => {
  if (!activeBotId) return;
  navigator.clipboard.writeText(activeBotId).then(() => {
    const prev = botIdCopy.textContent;
    botIdCopy.textContent = "Copied!";
    setTimeout(() => {
      botIdCopy.textContent = prev;
    }, 1500);
  });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────
//
// Load catalog and chatbot list in parallel. Both are independent server
// calls; there is no ordering dependency between them.

await Promise.all([loadCatalog(), loadChatbots()]);
updateChatUI();
