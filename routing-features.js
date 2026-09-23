(() => {
  const ROUTE_STORAGE = "thinktank_ai_route_v1";
  const AGENT_TASK_STORAGE = "thinktank_active_agent_task_v1";
  const AGENT_URL = `${BASE}/agent`;

  const ROUTES = {
    auto: {
      label: "Auto · Both",
      help: "Keep the normal Think Tank flow: both models respond, starting with the next scheduled AI.",
      payload: { mode: "auto" }
    },
    agent: {
      label: "Agent",
      help: "Give the message to the persistent execution Agent. It keeps task state, can use governed tools, and returns updates directly into this same chat.",
      payload: { mode: "agent" }
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
  let activeAgentTaskId = localStorage.getItem(AGENT_TASK_STORAGE) || "";

  const style = document.createElement("style");
  style.textContent = `
    .think-controls{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
    .think-chip{border:1px solid var(--border);border-radius:999px;padding:8px 11px;background:var(--panel2);color:var(--text);font-size:12px;font-weight:750}
    .think-chip.agent-selected{border-color:#557ca4;background:#18304a}
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
          <div class="route-sheet-title">Choose AI or Agent</div>
          <div class="route-sheet-sub">Use GPT, Claude, both in a chosen order, or hand the message to the persistent Agent without leaving the conversation.</div>
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
    if (btn) {
      btn.textContent = `AI: ${ROUTES[selectedRoute].label}`;
      btn.classList.toggle("agent-selected", selectedRoute === "agent");
    }
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
        if (status) status.textContent = selectedRoute === "agent"
          ? "Agent selected. Your next message will run as a persistent agent task in this chat."
          : `AI route set to ${ROUTES[selectedRoute].label}.`;
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

  function recentChatContext() {
    return (transcript || []).slice(-10)
      .map(turn => `${turn.speaker}: ${String(turn.text || "").slice(0,2400)}`)
      .join("\n\n")
      .slice(-12000);
  }

  async function agentPost(payload) {
    return postJson(AGENT_URL, payload);
  }

  async function getAgentTask(taskId) {
    if (!taskId) return null;
    try {
      return await agentPost({ action:"get", taskId });
    } catch {
      return null;
    }
  }

  function isAgentTerminal(task) {
    if (!task) return true;
    if (["completed","cancelled"].includes(task.status)) return true;
    if (task.status === "failed" && !String(task.error_text || "").startsWith("Step budget reached")) return true;
    return false;
  }

  function bestAgentText(task, steps = []) {
    const result = String(task?.result || "").trim();
    const summary = String(task?.working_state?.summary || "").trim();
    const error = String(task?.error_text || "").trim();
    let text = result || summary || "";

    if (!text) {
      const candidates = [...steps].reverse();
      for (const step of candidates) {
        if (!["checkpoint","model"].includes(step?.kind)) continue;
        const candidate = String(step?.summary || "").trim();
        if (candidate && candidate !== "Task created") {
          text = candidate;
          break;
        }
      }
    }

    if (!text && error) text = error;
    if (!text) text = "Agent task updated.";

    if (task?.status === "waiting_approval") {
      text += "\n\nAgent paused for approval. Use Tools / Approvals, then tap Next Response with Agent selected to continue.";
    } else if (task?.status === "queued") {
      text += "\n\nAgent paused at a checkpoint. Keep Agent selected and send guidance, or tap Next Response to continue.";
    } else if (task?.status === "failed") {
      text += "\n\nAgent task failed.";
    }

    return text;
  }

  async function fetchCurrentAgentState() {
    if (!activeAgentTaskId) return null;
    const data = await getAgentTask(activeAgentTaskId);
    if (!data?.task) {
      activeAgentTaskId = "";
      localStorage.removeItem(AGENT_TASK_STORAGE);
      return null;
    }
    return data;
  }

  async function runAgentMessage(text) {
    if (busy) return null;
    setBusy(true, "Agent is working…");
    try {
      const context = recentChatContext();
      let current = await fetchCurrentAgentState();
      let task;

      if (current?.task && !isAgentTerminal(current.task)) {
        const guided = await agentPost({ action:"message", taskId:current.task.id, message:text, context });
        task = guided?.task || current.task;
        if (task.status !== "waiting_approval") {
          const ran = await agentPost({ action:"run", taskId:task.id });
          task = ran?.task || task;
        }
      } else {
        const created = await agentPost({ action:"create", goal:text, context, autoRun:true });
        task = created?.task;
      }

      if (!task?.id) throw new Error("Agent returned no task.");
      activeAgentTaskId = task.id;
      localStorage.setItem(AGENT_TASK_STORAGE, activeAgentTaskId);

      const latest = await agentPost({ action:"get", taskId:task.id });
      task = latest?.task || task;
      const steps = Array.isArray(latest?.steps) ? latest.steps : [];

      transcript = [...transcript, {speaker:"Dylan",text}, {speaker:"Agent",text:bestAgentText(task, steps),taskId:task.id,taskStatus:task.status}];
      saveState();
      render();
      document.getElementById("question").value = "";
      const status = document.getElementById("status");
      if (status) status.textContent = task.status === "waiting_approval"
        ? "Agent is waiting for approval in Tools."
        : `Agent task: ${task.status}.`;
      setTimeout(() => window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"}),40);
      return {task,steps};
    } catch (err) {
      const status = document.getElementById("status");
      if (status) status.textContent = `Agent error: ${String(err?.message || err)}`;
      return null;
    } finally {
      busy = false;
      document.body.classList.remove("loading");
    }
  }

  async function continueAgent() {
    if (busy) return null;
    if (!activeAgentTaskId) {
      const status = document.getElementById("status");
      if (status) status.textContent = "No active Agent task. Send a message with Agent selected first.";
      return null;
    }
    setBusy(true, "Agent is continuing…");
    try {
      let current = await fetchCurrentAgentState();
      if (!current?.task) throw new Error("Active Agent task was not found.");
      if (isAgentTerminal(current.task)) {
        const status = document.getElementById("status");
        if (status) status.textContent = "That Agent task is complete. Send a new Agent message to start another task.";
        return current;
      }
      if (current.task.status === "waiting_approval") {
        const status = document.getElementById("status");
        if (status) status.textContent = "Agent is still waiting for approval in Tools.";
        return current;
      }

      const ran = await agentPost({ action:"run", taskId:current.task.id });
      const latest = await agentPost({ action:"get", taskId:current.task.id });
      const task = latest?.task || ran?.task || current.task;
      const steps = Array.isArray(latest?.steps) ? latest.steps : [];
      transcript = [...transcript, {speaker:"Agent",text:bestAgentText(task, steps),taskId:task.id,taskStatus:task.status}];
      saveState();
      render();
      const status = document.getElementById("status");
      if (status) status.textContent = task.status === "waiting_approval"
        ? "Agent is waiting for approval in Tools."
        : `Agent task: ${task.status}.`;
      setTimeout(() => window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"}),40);
      return {task,steps};
    } catch (err) {
      const status = document.getElementById("status");
      if (status) status.textContent = `Agent error: ${String(err?.message || err)}`;
      return null;
    } finally {
      busy = false;
      document.body.classList.remove("loading");
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

    if (selectedRoute === "agent") {
      await runAgentMessage(text);
      await refreshKnowledgeState();
      return;
    }

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

    if (selectedRoute === "agent") {
      await continueAgent();
      await refreshKnowledgeState();
      return;
    }

    const route = routePayload();
    const selected = route?.order?.[0] || nextSpeaker;
    const data = await callRelay(
      { action: "next", transcript, nextSpeaker, route },
      `${selected} is responding…`
    );
    if (data?.providerNotice) document.getElementById("status").textContent = data.providerNotice;
    else if (data) document.getElementById("status").textContent = `${data?.route?.actual?.[0] || selected} responded.`;
  }, true);

  window.ThinkTankChatAgent = {
    get activeTaskId(){ return activeAgentTaskId; },
    continue: continueAgent,
    send: runAgentMessage
  };

  renderRouteControl();
  refreshKnowledgeState();
})();