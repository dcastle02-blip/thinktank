(() => {
  const HELPER_STORAGE = "thinktank_chat_helper_v1";
  const HELPERS = {
    standard: {label:"Standard", help:"Normal Think Tank behavior."},
    troubleshoot: {label:"Troubleshoot", help:"Drive toward root cause and resolution with evidence-based diagnostic steps."},
    challenge: {label:"Challenge", help:"Stress-test assumptions and alternative explanations."},
    plan: {label:"Plan", help:"Turn the conversation into an executable sequence."},
    explain: {label:"Explain", help:"Build a clear system/process mental model."},
    decision: {label:"Decide", help:"Compare options using evidence, tradeoffs, and risk."}
  };

  let selectedHelper = localStorage.getItem(HELPER_STORAGE) || "standard";
  if (!HELPERS[selectedHelper]) selectedHelper = "standard";

  const style = document.createElement("style");
  style.textContent = `
    .helper-controls{display:flex;align-items:center;gap:7px;margin-top:8px;overflow-x:auto;padding-bottom:1px;scrollbar-width:none}
    .helper-controls::-webkit-scrollbar{display:none}
    .helper-label{font-size:11px;color:var(--muted);font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;margin-right:2px}
    .helper-chip{white-space:nowrap;border:1px solid var(--border);border-radius:999px;padding:7px 10px;background:var(--panel2);color:var(--text);font-size:12px;font-weight:750}
    .helper-chip.selected{border-color:#7c96b2;background:#1b2a3a}
    .helper-chip.troubleshoot.selected{border-color:#c69052;background:#3c2917}
    .helper-hint{font-size:11px;color:var(--muted);margin-top:5px;min-height:15px}
    .header-actions .troubleshoot-link{border-color:#8b633d}
  `;
  document.head.appendChild(style);

  const textarea = document.getElementById("question");
  const composerInner = document.querySelector(".composer-inner");
  if (composerInner && textarea) {
    const row = document.createElement("div");
    row.className = "helper-controls";
    row.id = "chatHelperControls";
    row.innerHTML = `<span class="helper-label">Guide</span>` +
      Object.entries(HELPERS).map(([key,h]) =>
        `<button type="button" class="helper-chip ${key === "troubleshoot" ? "troubleshoot" : ""}" data-helper="${key}" title="${escapeHtml(h.help)}">${escapeHtml(h.label)}</button>`
      ).join("");
    const hint = document.createElement("div");
    hint.id = "chatHelperHint";
    hint.className = "helper-hint";
    composerInner.insertBefore(row, textarea);
    composerInner.insertBefore(hint, textarea);

    function renderHelper() {
      row.querySelectorAll("[data-helper]").forEach(btn => btn.classList.toggle("selected", btn.dataset.helper === selectedHelper));
      hint.textContent = selectedHelper === "standard" ? "" : HELPERS[selectedHelper].help;
      textarea.placeholder = selectedHelper === "troubleshoot"
        ? "Describe the symptom, what changed, or the latest test result..."
        : selectedHelper === "challenge"
          ? "What should GPT and Claude stress-test?"
          : selectedHelper === "plan"
            ? "What are you trying to execute?"
            : selectedHelper === "explain"
              ? "What process or system should they explain?"
              : selectedHelper === "decision"
                ? "What decision or options are you weighing?"
                : "Ask the think tank... uploaded library files are searched automatically";
    }

    row.querySelectorAll("[data-helper]").forEach(btn => btn.addEventListener("click", () => {
      selectedHelper = btn.dataset.helper;
      localStorage.setItem(HELPER_STORAGE, selectedHelper);
      renderHelper();
      const status = document.getElementById("status");
      if (status) status.textContent = selectedHelper === "standard"
        ? "Conversation guide cleared."
        : `${HELPERS[selectedHelper].label} guide active for this conversation.`;
    }));
    renderHelper();
  }

  const originalCallRelay = callRelay;
  callRelay = async function(payload, busyMessage) {
    const withHelper = {...payload, helperMode:selectedHelper};
    return originalCallRelay(withHelper, busyMessage);
  };

  const headerActions = document.querySelector(".header-actions");
  if (headerActions && !document.getElementById("troubleshootScreenLink")) {
    const link = document.createElement("a");
    link.id = "troubleshootScreenLink";
    link.className = "btn troubleshoot-link";
    link.href = "troubleshoot.html";
    link.style.textDecoration = "none";
    link.textContent = "Troubleshoot";
    const library = document.getElementById("libraryBtn");
    headerActions.insertBefore(link, library || headerActions.firstChild);
  }

  window.ThinkTankChatHelpers = {
    get mode(){ return selectedHelper; },
    set mode(value){
      if (!HELPERS[value]) return;
      selectedHelper=value;
      localStorage.setItem(HELPER_STORAGE,value);
      document.querySelectorAll("[data-helper]").forEach(btn => btn.classList.toggle("selected", btn.dataset.helper === selectedHelper));
    }
  };
})();