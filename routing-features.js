(() => {
  const ROUTE_STORAGE = "thinktank_ai_route_v1";
  const ROUTES = {
    auto: {
      label: "Auto · Both",
      help: "Keep the current Think Tank behavior: both models respond, starting with the next scheduled AI.",
      payload: { mode: "auto" }
    },
    gpt: {
      label: "GPT only",
      help: "Send this turn only to GPT.",
      payload: { mode: "single", order: ["GPT"] }
    },
    claude: {
      label: "Claude only",
      help: "Send this turn only to Claude. GPT is used only if Claude is unavailable.",
      payload: { mode: "single", order: ["Claude"] }
    },
    gpt_claude: {
      label: "GPT → Claude",
      help: "GPT answers first. Claude automatically sees GPT's answer and responds second.",
      payload: { mode: "both", order: ["GPT", "Claude"] }
    },
    claude_gpt: {
      label: "Claude → GPT",
      help: "Claude answers first. GPT automatically sees Claude's answer and responds second.",
      payload: { mode: "both", order: ["Claude", "GPT"] }
    },
    gpt_claude_gpt: {
      label: "GPT → Claude → GPT",
      help: "A short debate loop: GPT proposes, Claude challenges or extends it, then GPT gets one final response.",
      payload: { mode: "debate", order: ["GPT", "Claude", "GPT"] }
    },
    claude_gpt_claude: {
      label: "Claude → GPT → Claude",
      help: "A short debate loop: Claude proposes, GPT challenges or extends it, then Claude gets one final response.",
      payload: { mode: "debate", order: ["Claude", "GPT", "Claude"] }
    }
  };

  let selectedRoute = localStorage.getItem(ROUTE_STORAGE) || "auto";
  if (!ROUTES[selectedRoute]) selectedRoute = "auto";

  const style = document.createElement("style");
  style.textContent = `
    .think-controls{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
    .think-chip{border:1px solid var(--border);border-radius:999px;padding:8px 11px;background:var(--panel2);color:var(--text);font-size:12px;font-weight:750}
    .think-chip strong{font-weight:850}
    .think-controls-spacer{flex:1}
    .route-overlay{position:fixed;inset:0;z-index:140;background:rgba(7,10,14,.82);display:flex;align-items:flex-end;justify-content:center;padding:12px}
    .route-overlay.hidden{display:none}
    .route-sheet{width:min(620px,100%);max-height:86dvh;overflow:auto;border:1px solid var(--border);background:var(--panel);border-radius:20px 20px 14px 14px;padding:16px;box-shadow:var(--shadow)}
    .route-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
    .route-sheet-title{font-size:19px;font-weight:850}
    .route-sheet-sub{font-size:12px;color:var(--muted);line-height:1.45;margin-top:4px}
    .route-option{width:100%;text-align:left;border:1px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);padding:12px;margin-top:8px}
    .route-option.selected{border-color:#6f8fb1;background:#152333}
    .route-option-title{font-weight:800}
    .route-option-help{font-size:12px;color:var(--muted);line-height:1.4;margin-top:4px}
    @media(min-width:700px){.route-overlay{align-items:center}.route-sheet{border-radius:20px}}
  `;
  document.head.appendChild(style);

  const composerInner = document.querySelector(".composer-inner");
  const libraryRow = document.querySelector(".library-row");
  if (composerInner && libraryRow) {
    const row = document.createElement("div");
    row.className = "think-controls";
    row.innerHTML = `
      <button class="think-chip" id="aiRouteBtn" type="button"></button>
      <button class="think-chip" id="knowledgeStateBtn" type="button">Knowledge: loading…</button>
      <span class="think-controls-spacer"></span>
    `;
    composerInner.insertBefore(row, libraryRow);
  }

  const overlay = document.createElement("div");
  overlay.id = "aiRouteOverlay";
  overlay.className = "route-overlay hidden";
  overlay.innerHTML = `
    <div class="route-sheet">
      <div class="route-sheet-head">
        <div>
          <div class="route-sheet-title">Choose AI</div>
          <div class="route-sheet-sub">This controls which model answers this message and, when both are selected, the order they see each other's work.</div>
        </div>
        <button class="btn small-btn" id="closeAiRouteBtn" type="button">Close</button>
      </div>
      <div id="aiRouteOptions"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function routePayload() {
    return typeof structuredClone === "function"
      ? structuredClone(ROUTES[selectedRoute].payload)
      : JSON.parse(JSON.stringify(ROUTES[selectedRoute].payload));
  }

  function renderRouteControl() {
    const btn = document.getElementById("aiRouteBtn");
    if (btn) btn.textContent = `AI: ${ROUTES[selectedRoute].label}`;
    const host = document.getElementById("aiRouteOptions");
    if (!host) return;
    host.innerHTML = Object.entries(ROUTES).map(([key, route]) => `
      <button class="route-option ${key === selectedRoute ? "selected" : ""}" data-route-key="${key}" type="button">
        <div class="route-option-title">${escapeHtml(route.label)}</div>
        <div class="route-option-help">${escapeHtml(route.help)}</div>
      </button>
    `).join("");
    host.querySelectorAll("[data-route-key]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedRoute = btn.dataset.routeKey;
        localStorage.setItem(ROUTE_STORAGE, selectedRoute);
        renderRouteControl();
        overlay.classList.add("hidden");
        const status = document.getElementById("status");
        if (status) status.textContent = `AI route set to ${ROUTES[selectedRoute].label}.`;
      });
    });
  }

  async function refreshKnowledgeState() {
    const btn = document.getElementById("knowledgeStateBtn");
    if (!btn || !getSecret()) return;
    try {
      const data = await postJson(`${BASE}/onboarding`, { action: "status" });
      const counts = data?.counts || {};
      const facts = Number(counts.activeClaims || 0);
      const gaps = Number(counts.openGaps || 0);
      btn.textContent = `Knowledge: ${facts} facts · ${gaps} gap${gaps === 1 ? "" : "s"}`;
      btn.title = "Open Process Knowledge";
    } catch {
      btn.textContent = "Knowledge";
    }
  }

  const routeBtn = document.getElementById("aiRouteBtn");
  if (routeBtn) routeBtn.addEventListener("click", () => {
    renderRouteControl();
    overlay.classList.remove("hidden");
  });
  const closeBtn = document.getElementById("closeAiRouteBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.add("hidden"); });

  const knowledgeBtn = document.getElementById("knowledgeStateBtn");
  if (knowledgeBtn) knowledgeBtn.addEventListener("click", async () => {
    await refreshKnowledgeState();
    const onboard = document.getElementById("onboardingBtn");
    if (onboard) onboard.click();
  });

  const send = document.getElementById("sendBtn");
  if (send) send.addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = document.getElementById("question")?.value?.trim() || "";
    if (!text || busy) return;
    const route = routePayload();
    const data = await callRelay(
      { action: "message", message: text, transcript, nextSpeaker, route },
      `${ROUTES[selectedRoute].label} is responding…`
    );
    if (data) {
      document.getElementById("question").value = "";
      if (data?.providerNotice) document.getElementById("status").textContent = data.providerNotice;
      else if (!data?.knowledge?.chunksUsed) document.getElementById("status").textContent = `${ROUTES[selectedRoute].label} responded. No matching library section was needed/found.`;
      else document.getElementById("status").textContent = `${ROUTES[selectedRoute].label} responded using ${data.knowledge.chunksUsed} library section(s).`;
      await refreshKnowledgeState();
    }
  }, true);

  const next = document.getElementById("nextBtn");
  if (next) next.addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!transcript.length) {
      document.getElementById("status").textContent = "Start a conversation first.";
      return;
    }
    if (busy) return;
    const route = routePayload();
    const selected = route?.order?.[0] || nextSpeaker;
    const data = await callRelay(
      { action: "next", transcript, nextSpeaker, route },
      `${selected} is responding…`
    );
    if (data?.providerNotice) document.getElementById("status").textContent = data.providerNotice;
    else if (data) document.getElementById("status").textContent = `${data?.route?.actual?.[0] || selected} responded.`;
  }, true);

  renderRouteControl();
  refreshKnowledgeState();
})();