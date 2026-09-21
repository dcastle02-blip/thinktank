(() => {
  const AGENT_URL = "https://ddxhpsgwxqoejghmsatg.supabase.co/functions/v1/agent";
  let agentTasks = [];
  let agentBusy = false;
  let activeTaskId = null;
  let activeTask = null;
  let activeSteps = [];

  const style = document.createElement("style");
  style.textContent = `
    #agentOverlay{padding:0;align-items:stretch;justify-content:center}
    .agent-shell{width:100%;max-width:820px;height:100dvh;background:var(--bg);display:flex;flex-direction:column;border-left:1px solid var(--border);border-right:1px solid var(--border)}
    .agent-header{flex:0 0 auto;padding:max(14px,env(safe-area-inset-top)) 16px 12px;background:rgba(11,15,20,.96);backdrop-filter:blur(18px);border-bottom:1px solid var(--border)}
    .agent-header-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .agent-header-title{font-size:20px;font-weight:800;line-height:1.15;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .agent-header-sub{font-size:12px;color:var(--muted);margin-top:5px;line-height:1.4}
    .agent-header-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
    .agent-home{flex:1;overflow:auto;padding:16px 14px 80px}
    .agent-new{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:14px;box-shadow:var(--shadow)}
    .agent-new h3{margin:0;font-size:15px}
    .agent-goal{width:100%;min-height:105px;resize:vertical;border:1px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);padding:13px 14px;margin-top:10px;outline:none}
    .agent-goal:focus{border-color:#4d6783}
    .agent-controls,.agent-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
    .agent-list-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 2px 9px}
    .agent-list-heading strong{font-size:13px}
    .agent-list{display:flex;flex-direction:column;gap:10px}
    .agent-task{border:1px solid var(--border);border-radius:15px;background:var(--panel);padding:13px}
    .agent-task-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .agent-title{font-weight:800;font-size:14px;line-height:1.35}
    .agent-meta,.agent-summary{font-size:12px;color:var(--muted);line-height:1.48;margin-top:5px;word-break:break-word}
    .agent-status-pill{font-size:11px;font-weight:800;border:1px solid var(--border);border-radius:999px;padding:5px 8px;white-space:nowrap;text-transform:lowercase}
    .agent-status-pill.completed{color:#bff5d6;border-color:#315c46;background:#102b21}
    .agent-status-pill.failed,.agent-status-pill.cancelled{color:#f3c0c0;border-color:#623737;background:#2c1717}
    .agent-status-pill.waiting_approval{color:#f7dfac;border-color:#6f5a2d;background:#30250f}
    .agent-status-pill.running{color:#c8e4ff;border-color:#365978;background:#102338}
    .agent-chat{flex:1;min-height:0;display:flex;flex-direction:column}
    .agent-chat.hidden,.agent-home.hidden,#agentBackBtn.hidden{display:none}
    .agent-feed{flex:1;overflow:auto;padding:16px 14px 28px}
    .agent-feed .card{box-shadow:none}
    .agent-tool-card,.agent-system-card{border:1px solid var(--border);border-radius:14px;background:var(--panel);margin-bottom:13px;overflow:hidden}
    .agent-tool-head,.agent-system-head{padding:8px 12px;font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--muted);background:var(--panel2)}
    .agent-tool-head.succeeded{color:#bff5d6}
    .agent-tool-head.failed,.agent-tool-head.denied{color:#f3c0c0}
    .agent-tool-head.waiting,.agent-tool-head.requested{color:#f7dfac}
    .agent-tool-body,.agent-system-body{padding:12px 13px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
    .agent-step-meta{font-size:11px;color:var(--muted);margin-top:7px}
    .agent-approval{border:1px solid #6f5a2d;background:#30250f;border-radius:14px;padding:12px 13px;margin-bottom:14px}
    .agent-approval strong{display:block;margin-bottom:5px}
    .agent-result{border-color:#665494}
    .agent-result .card-head{background:var(--consensus)}
    .agent-dock{flex:0 0 auto;border-top:1px solid var(--border);background:rgba(11,15,20,.98);backdrop-filter:blur(18px);padding:10px 14px max(12px,env(safe-area-inset-bottom))}
    .agent-dock-status{font-size:12px;color:var(--muted);line-height:1.4;min-height:17px;margin-bottom:8px}
    .agent-dock-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .agent-dock-actions .btn{width:100%}
    .agent-dock-secondary{display:flex;gap:8px;margin-top:8px}
    .agent-dock-secondary .btn{flex:1}
    @media (min-width:700px){
      .agent-home,.agent-feed{padding-left:24px;padding-right:24px}
    }
  `;
  document.head.appendChild(style);

  const headerActions = document.querySelector(".header-actions");
  const agentBtn = document.createElement("button");
  agentBtn.id = "agentBtn";
  agentBtn.className = "btn";
  agentBtn.textContent = "Agent";
  if (headerActions) headerActions.insertBefore(agentBtn, document.getElementById("toolsBtn") || document.getElementById("libraryBtn"));

  const overlay = document.createElement("div");
  overlay.id = "agentOverlay";
  overlay.className = "overlay hidden";
  overlay.innerHTML = `
    <div class="agent-shell">
      <div class="agent-header">
        <div class="agent-header-row">
          <div style="min-width:0">
            <div id="agentHeaderTitle" class="agent-header-title">Think Tank Agent</div>
            <div id="agentHeaderSub" class="agent-header-sub">Outcome-driven work with persistent state and governed tools.</div>
          </div>
          <div class="agent-header-actions">
            <button class="btn small-btn hidden" id="agentBackBtn">Tasks</button>
            <button class="btn small-btn" id="refreshAgentBtn">Refresh</button>
            <button class="btn small-btn" id="closeAgentBtn">Close</button>
          </div>
        </div>
      </div>

      <div id="agentHome" class="agent-home">
        <div class="agent-new">
          <h3>Start a new agent task</h3>
          <div class="small">Describe the outcome. The agent can inspect, act, checkpoint, pause for approval, and resume.</div>
          <textarea id="agentGoal" class="agent-goal" placeholder="Example: Audit the current Think Tank UI, simplify the agent experience, implement the changes, deploy, and verify them live."></textarea>
          <div class="agent-controls">
            <button class="btn primary" id="startAgentBtn">Start Agent</button>
          </div>
          <div id="agentStatus" class="upload-detail"></div>
        </div>

        <div class="agent-list-heading">
          <strong>Agent tasks</strong>
          <span id="agentTaskCount" class="small" style="margin:0"></span>
        </div>
        <div id="agentTasks" class="agent-list"></div>
      </div>

      <div id="agentChat" class="agent-chat hidden">
        <div id="agentFeed" class="agent-feed"></div>
        <div class="agent-dock">
          <div id="agentChatStatus" class="agent-dock-status"></div>
          <div id="agentPrimaryActions" class="agent-dock-actions"></div>
          <div id="agentSecondaryActions" class="agent-dock-secondary"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function setAgentStatus(message) {
    const home = document.getElementById("agentStatus");
    const chat = document.getElementById("agentChatStatus");
    if (home) home.textContent = message || "";
    if (chat && activeTaskId) chat.textContent = message || "";
  }

  async function agentPost(payload) {
    return postJson(AGENT_URL, payload);
  }

  function taskSummary(task) {
    if (task.result) return task.result;
    if (task.error_text) return task.error_text;
    if (task.working_state?.summary) return task.working_state.summary;
    if (task.working_state?.next_step) return "Next: " + task.working_state.next_step;
    return task.goal;
  }

  function isBudgetExhausted(task) {
    const budgetFailed = task?.status === "failed" && String(task?.error_text || "").startsWith("Step budget reached");
    return budgetFailed || Number(task?.step_count || 0) >= Number(task?.max_steps || 0);
  }

  function isTerminal(task) {
    const budgetFailed = task?.status === "failed" && String(task?.error_text || "").startsWith("Step budget reached");
    return ["completed","cancelled"].includes(task?.status) || (task?.status === "failed" && !budgetFailed);
  }

  function formatWhen(value) {
    try { return new Date(value).toLocaleString(); } catch { return ""; }
  }

  function renderAgentTasks() {
    const wrap = document.getElementById("agentTasks");
    const count = document.getElementById("agentTaskCount");
    if (count) count.textContent = `${agentTasks.length} total`;
    if (!wrap) return;
    if (!agentTasks.length) {
      wrap.innerHTML = '<div class="library-empty">No agent tasks yet.</div>';
      return;
    }

    wrap.innerHTML = agentTasks.map(task => `
      <div class="agent-task">
        <div class="agent-task-top">
          <div style="min-width:0">
            <div class="agent-title">${escapeHtml(task.title || "Agent task")}</div>
            <div class="agent-meta">${Number(task.step_count || 0)}/${Number(task.max_steps || 0)} steps · updated ${escapeHtml(formatWhen(task.updated_at))}</div>
          </div>
          <div class="agent-status-pill ${escapeHtml(task.status || "")}">${escapeHtml(task.status || "unknown")}</div>
        </div>
        <div class="agent-summary">${escapeHtml(taskSummary(task) || "")}</div>
        <div class="agent-actions">
          <button class="btn primary small-btn" data-agent-open="${escapeHtml(task.id)}">Open</button>
          ${task.status === "waiting_approval" ? '<button class="btn small-btn" data-open-tools="1">Approvals</button>' : ""}
        </div>
      </div>
    `).join("");

    wrap.querySelectorAll("[data-agent-open]").forEach(btn => btn.addEventListener("click", () => openTaskChat(btn.dataset.agentOpen)));
    wrap.querySelectorAll("[data-open-tools]").forEach(btn => btn.addEventListener("click", openToolsFromAgent));
  }

  function stepCard(step) {
    const actor = step.actor === "Claude" ? "Claude" : "GPT";
    const when = step.created_at ? formatWhen(step.created_at) : "";
    const summary = escapeHtml(step.summary || "");
    const seq = Number(step.sequence || 0);

    if (step.kind === "model") {
      return `
        <section class="card speaker-${actor}">
          <div class="card-head">${actor.toUpperCase()} · AGENT UPDATE</div>
          <div class="card-body">${summary || "Agent reasoning checkpoint."}<div class="agent-step-meta">Step #${seq}${when ? " · " + escapeHtml(when) : ""}</div></div>
        </section>`;
    }

    if (step.kind === "tool") {
      return `
        <section class="agent-tool-card">
          <div class="agent-tool-head ${escapeHtml(step.status || "")}">TOOL ACTION · ${escapeHtml(String(step.status || "").toUpperCase())}</div>
          <div class="agent-tool-body">${summary || "Tool action"}<div class="agent-step-meta">Step #${seq}${when ? " · " + escapeHtml(when) : ""}</div></div>
        </section>`;
    }

    return `
      <section class="agent-system-card">
        <div class="agent-system-head">${escapeHtml(String(step.kind || "system").toUpperCase())} · ${escapeHtml(String(step.status || "").toUpperCase())}</div>
        <div class="agent-system-body">${summary || "Agent checkpoint"}<div class="agent-step-meta">Step #${seq}${when ? " · " + escapeHtml(when) : ""}</div></div>
      </section>`;
  }

  function renderTaskChat(scrollToBottom = false) {
    const feed = document.getElementById("agentFeed");
    const primary = document.getElementById("agentPrimaryActions");
    const secondary = document.getElementById("agentSecondaryActions");
    if (!feed || !activeTask) return;

    const pieces = [
      `<section class="card speaker-Dylan"><div class="card-head">DYLAN · AGENT GOAL</div><div class="card-body">${escapeHtml(activeTask.goal || "")}</div></section>`
    ];

    for (const step of activeSteps) pieces.push(stepCard(step));

    if (activeTask.status === "waiting_approval") {
      pieces.push(`
        <div class="agent-approval">
          <strong>Agent paused for approval</strong>
          A connected-system action needs your approval before the task can continue.
          <div class="agent-actions"><button class="btn small-btn" data-chat-open-tools="1">Open Tools / Approvals</button></div>
        </div>`);
    }

    if (activeTask.result) {
      pieces.push(`
        <section class="card agent-result">
          <div class="card-head">AGENT RESULT</div>
          <div class="card-body">${escapeHtml(activeTask.result)}</div>
        </section>`);
    } else if (activeTask.error_text && !isBudgetExhausted(activeTask)) {
      pieces.push(`
        <section class="agent-system-card">
          <div class="agent-system-head">TASK ERROR</div>
          <div class="agent-system-body">${escapeHtml(activeTask.error_text)}</div>
        </section>`);
    }

    feed.innerHTML = pieces.join("");

    const terminal = isTerminal(activeTask);
    const atBudget = isBudgetExhausted(activeTask);

    if (activeTask.status === "waiting_approval") {
      primary.innerHTML = '<button class="btn primary" data-chat-open-tools="1">Review Approval</button><button class="btn" data-chat-refresh="1">Refresh</button>';
    } else if (!terminal && atBudget) {
      primary.innerHTML = '<button class="btn primary" data-chat-extend="1">Add 30 Steps & Continue</button><button class="btn" data-chat-refresh="1">Refresh</button>';
    } else if (!terminal) {
      primary.innerHTML = '<button class="btn primary" data-chat-continue="1">Continue Agent</button><button class="btn" data-chat-refresh="1">Refresh</button>';
    } else {
      primary.innerHTML = '<button class="btn primary" data-agent-back="1">Back to Tasks</button><button class="btn" data-chat-refresh="1">Refresh</button>';
    }

    secondary.innerHTML = !terminal
      ? '<button class="btn danger" data-chat-cancel="1">Cancel Task</button><button class="btn" data-agent-back="1">Task List</button>'
      : '<button class="btn" data-agent-back="1">Task List</button>';

    feed.querySelectorAll("[data-chat-open-tools]").forEach(btn => btn.addEventListener("click", openToolsFromAgent));
    primary.querySelectorAll("[data-chat-open-tools]").forEach(btn => btn.addEventListener("click", openToolsFromAgent));
    primary.querySelectorAll("[data-chat-refresh]").forEach(btn => btn.addEventListener("click", () => loadTaskChat(activeTaskId, false)));
    primary.querySelectorAll("[data-chat-continue]").forEach(btn => btn.addEventListener("click", () => driveTask(activeTaskId, 4)));
    primary.querySelectorAll("[data-chat-extend]").forEach(btn => btn.addEventListener("click", () => extendAndContinue(activeTaskId)));
    primary.querySelectorAll("[data-agent-back]").forEach(btn => btn.addEventListener("click", showAgentHome));
    secondary.querySelectorAll("[data-agent-back]").forEach(btn => btn.addEventListener("click", showAgentHome));
    secondary.querySelectorAll("[data-chat-cancel]").forEach(btn => btn.addEventListener("click", () => cancelTask(activeTaskId)));

    const headerTitle = document.getElementById("agentHeaderTitle");
    const headerSub = document.getElementById("agentHeaderSub");
    if (headerTitle) headerTitle.textContent = activeTask.title || "Agent task";
    if (headerSub) headerSub.textContent = `${activeTask.status} · ${Number(activeTask.step_count || 0)}/${Number(activeTask.max_steps || 0)} steps · updated ${formatWhen(activeTask.updated_at)}`;

    if (activeTask.status === "waiting_approval") setAgentStatus("Waiting for your approval.");
    else if (activeTask.status === "completed") setAgentStatus("Task completed.");
    else if (activeTask.status === "failed") setAgentStatus(activeTask.error_text || "Task failed.");
    else if (activeTask.status === "cancelled") setAgentStatus("Task cancelled.");
    else if (atBudget) setAgentStatus("Task checkpointed at its current step budget.");
    else setAgentStatus("Agent task is ready to continue.");

    if (scrollToBottom) setTimeout(() => { feed.scrollTop = feed.scrollHeight; }, 30);
  }

  function showAgentHome() {
    activeTaskId = null;
    activeTask = null;
    activeSteps = [];
    document.getElementById("agentHome")?.classList.remove("hidden");
    document.getElementById("agentChat")?.classList.add("hidden");
    document.getElementById("agentBackBtn")?.classList.add("hidden");
    const title = document.getElementById("agentHeaderTitle");
    const sub = document.getElementById("agentHeaderSub");
    if (title) title.textContent = "Think Tank Agent";
    if (sub) sub.textContent = "Outcome-driven work with persistent state and governed tools.";
  }

  async function openTaskChat(taskId) {
    activeTaskId = taskId;
    document.getElementById("agentHome")?.classList.add("hidden");
    document.getElementById("agentChat")?.classList.remove("hidden");
    document.getElementById("agentBackBtn")?.classList.remove("hidden");
    setAgentStatus("Loading agent workspace…");
    await loadTaskChat(taskId, true);
  }

  async function loadTaskChat(taskId, scrollToBottom = false) {
    if (!taskId) return;
    try {
      const data = await agentPost({ action:"get", taskId });
      activeTask = data.task || null;
      activeSteps = Array.isArray(data.steps) ? data.steps : [];
      if (activeTask) renderTaskChat(scrollToBottom);
    } catch (err) {
      setAgentStatus(`Could not load task: ${String(err?.message || err)}`);
    }
  }

  async function loadAgent(showMessage = true) {
    if (!getSecret()) return;
    if (showMessage && !activeTaskId) setAgentStatus("Loading agent tasks…");
    try {
      const data = await agentPost({ action:"list" });
      agentTasks = Array.isArray(data.tasks) ? data.tasks : [];
      renderAgentTasks();
      if (activeTaskId) await loadTaskChat(activeTaskId, false);
      else if (showMessage) setAgentStatus(`${agentTasks.length} task(s).`);
    } catch (err) {
      setAgentStatus(`Agent unavailable: ${String(err?.message || err)}`);
    }
  }

  async function driveTask(taskId, maxCycles = 4) {
    if (agentBusy || !taskId) return;
    agentBusy = true;
    try {
      for (let i = 0; i < maxCycles; i++) {
        setAgentStatus(`Agent working… pass ${i + 1}/${maxCycles}`);
        const data = await agentPost({ action:"run", taskId });
        const task = data.task;
        if (!task) break;
        await loadAgent(false);
        if (activeTaskId === taskId) await loadTaskChat(taskId, true);
        if (["waiting_approval","completed","failed","cancelled"].includes(task.status)) {
          if (task.status === "waiting_approval") setAgentStatus("Agent paused for approval.");
          else setAgentStatus(`Agent task ${task.status}.`);
          return;
        }
      }
      setAgentStatus("Agent checkpointed. Continue when you want another work pass.");
      await loadAgent(false);
      if (activeTaskId === taskId) await loadTaskChat(taskId, true);
    } catch (err) {
      setAgentStatus(`Agent run failed: ${String(err?.message || err)}`);
    } finally {
      agentBusy = false;
    }
  }

  async function extendAndContinue(taskId) {
    if (agentBusy || !taskId) return;
    agentBusy = true;
    setAgentStatus("Extending task budget by 30 steps…");
    try {
      await agentPost({ action:"extend_budget", taskId, addSteps:30 });
      await loadAgent(false);
      if (activeTaskId === taskId) await loadTaskChat(taskId, false);
    } catch (err) {
      setAgentStatus(`Could not extend task: ${String(err?.message || err)}`);
      agentBusy = false;
      return;
    }
    agentBusy = false;
    await driveTask(taskId, 4);
  }

  async function startTask() {
    if (agentBusy) return;
    const goal = document.getElementById("agentGoal")?.value.trim();
    if (!goal) {
      setAgentStatus("Enter a goal first.");
      return;
    }
    agentBusy = true;
    setAgentStatus("Creating task and starting first work pass…");
    try {
      const data = await agentPost({ action:"create", goal, maxSteps:60, autoRun:true });
      document.getElementById("agentGoal").value = "";
      await loadAgent(false);
      const task = data.task;
      if (task?.id) {
        agentBusy = false;
        await openTaskChat(task.id);
        if (task.status === "queued" || task.status === "running") await driveTask(task.id, 3);
        return;
      }
      setAgentStatus("Agent task created.");
    } catch (err) {
      setAgentStatus(`Could not start agent: ${String(err?.message || err)}`);
    } finally {
      agentBusy = false;
    }
  }

  async function cancelTask(taskId) {
    if (!taskId || !confirm("Cancel this agent task? Persisted history will remain.")) return;
    try {
      await agentPost({ action:"cancel", taskId });
      setAgentStatus("Agent task cancelled.");
      await loadAgent(false);
      if (activeTaskId === taskId) await loadTaskChat(taskId, true);
    } catch (err) {
      setAgentStatus(`Cancel failed: ${String(err?.message || err)}`);
    }
  }

  function openToolsFromAgent() {
    overlay.classList.add("hidden");
    document.getElementById("toolsBtn")?.click();
  }

  async function resumeForActivity(activityId) {
    try {
      const data = await agentPost({ action:"resume_activity", activityId });
      if (data?.resumed) {
        setAgentStatus("Approved action completed. Agent resumed.");
        await loadAgent(false);
        if (activeTaskId) await loadTaskChat(activeTaskId, true);
      }
      return data;
    } catch (err) {
      setAgentStatus(`Agent resume failed: ${String(err?.message || err)}`);
      return null;
    }
  }

  window.ThinkTankAgent = { load:loadAgent, resumeForActivity, driveTask, openTask:openTaskChat };

  agentBtn.addEventListener("click", async () => {
    overlay.classList.remove("hidden");
    showAgentHome();
    await loadAgent();
  });
  document.getElementById("closeAgentBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  document.getElementById("agentBackBtn").addEventListener("click", showAgentHome);
  document.getElementById("refreshAgentBtn").addEventListener("click", () => activeTaskId ? loadTaskChat(activeTaskId, false) : loadAgent());
  document.getElementById("startAgentBtn").addEventListener("click", startTask);

  if (getSecret()) loadAgent(false);
})();
