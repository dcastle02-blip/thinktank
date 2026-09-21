(() => {
  const AGENT_URL = "https://ddxhpsgwxqoejghmsatg.supabase.co/functions/v1/agent";
  let agentTasks = [];
  let agentBusy = false;

  const style = document.createElement("style");
  style.textContent = `
    .agent-goal{width:100%;min-height:110px;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);padding:12px;margin-top:12px}
    .agent-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
    .agent-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
    .agent-task{border:1px solid var(--border);border-radius:14px;background:var(--bg);padding:12px}
    .agent-task-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .agent-title{font-weight:800;font-size:14px}
    .agent-meta,.agent-summary{font-size:12px;color:var(--muted);line-height:1.45;margin-top:5px;word-break:break-word}
    .agent-status{font-size:11px;font-weight:800;border:1px solid var(--border);border-radius:999px;padding:5px 8px;white-space:nowrap}
    .agent-status.completed{color:#bff5d6;border-color:#315c46;background:#102b21}
    .agent-status.failed,.agent-status.cancelled{color:#f3c0c0;border-color:#623737;background:#2c1717}
    .agent-status.waiting_approval{color:#f7dfac;border-color:#6f5a2d;background:#30250f}
    .agent-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
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
    <div class="setup">
      <div class="modal-top">
        <div>
          <h2>Think Tank Agent</h2>
          <div class="small">Give it an outcome. State persists in Supabase, tool permissions still control every connected-system action.</div>
        </div>
        <button class="btn" id="closeAgentBtn">Close</button>
      </div>

      <textarea id="agentGoal" class="agent-goal" placeholder="Example: Finish hybrid RAG end to end. Inspect live state, implement, deploy, test, and verify before calling it complete."></textarea>
      <div class="agent-controls">
        <button class="btn primary" id="startAgentBtn">Start Agent</button>
        <button class="btn" id="refreshAgentBtn">Refresh</button>
      </div>
      <div id="agentStatus" class="upload-detail"></div>
      <div id="agentTasks" class="agent-list"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function setAgentStatus(message) {
    const el = document.getElementById("agentStatus");
    if (el) el.textContent = message || "";
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

  function renderAgentTasks() {
    const wrap = document.getElementById("agentTasks");
    if (!wrap) return;
    if (!agentTasks.length) {
      wrap.innerHTML = '<div class="library-empty">No agent tasks yet.</div>';
      return;
    }

    wrap.innerHTML = agentTasks.map(task => {
      const budgetFailed = task.status === "failed" && String(task.error_text || "").startsWith("Step budget reached");\n      const terminal = ["completed","cancelled"].includes(task.status) || (task.status === "failed" && !budgetFailed);\n      const atBudget = budgetFailed || Number(task.step_count) >= Number(task.max_steps);
      return `
        <div class="agent-task">
          <div class="agent-task-top">
            <div>
              <div class="agent-title">${escapeHtml(task.title)}</div>
              <div class="agent-meta">${task.step_count}/${task.max_steps} persisted steps · updated ${escapeHtml(new Date(task.updated_at).toLocaleString())}</div>
            </div>
            <div class="agent-status ${escapeHtml(task.status)}">${escapeHtml(task.status)}</div>
          </div>
          <div class="agent-summary">${escapeHtml(taskSummary(task))}</div>
          ${task.status === "waiting_approval" ? '<div class="agent-summary">Waiting for a tool approval. Open Tools to review the exact action.</div>' : ""}
          <div class="agent-actions">
            ${!terminal && task.status !== "waiting_approval" && !atBudget ? `<button class="btn primary small-btn" data-agent-continue="${escapeHtml(task.id)}">Continue</button>` : ""}\n            ${!terminal && atBudget ? `<button class="btn primary small-btn" data-agent-extend="${escapeHtml(task.id)}">Add 30 steps & Continue</button>` : ""}
            ${task.status === "waiting_approval" ? '<button class="btn small-btn" data-open-tools="1">Open Tools</button>' : ""}
            ${!terminal ? `<button class="btn danger small-btn" data-agent-cancel="${escapeHtml(task.id)}">Cancel</button>` : ""}
            <button class="btn small-btn" data-agent-details="${escapeHtml(task.id)}">Details</button>
          </div>
        </div>`;
    }).join("");

    wrap.querySelectorAll("[data-agent-continue]").forEach(btn => btn.addEventListener("click", () => driveTask(btn.dataset.agentContinue, 4)));\n    wrap.querySelectorAll("[data-agent-extend]").forEach(btn => btn.addEventListener("click", () => extendAndContinue(btn.dataset.agentExtend)));
    wrap.querySelectorAll("[data-agent-cancel]").forEach(btn => btn.addEventListener("click", () => cancelTask(btn.dataset.agentCancel)));
    wrap.querySelectorAll("[data-agent-details]").forEach(btn => btn.addEventListener("click", () => showDetails(btn.dataset.agentDetails)));
    wrap.querySelectorAll("[data-open-tools]").forEach(btn => btn.addEventListener("click", () => {
      document.getElementById("agentOverlay")?.classList.add("hidden");
      document.getElementById("toolsBtn")?.click();
    }));
  }

  async function loadAgent(showMessage = true) {
    if (!getSecret()) return;
    if (showMessage) setAgentStatus("Loading agent tasks…");
    try {
      const data = await agentPost({action:"list"});
      agentTasks = Array.isArray(data.tasks) ? data.tasks : [];
      renderAgentTasks();
      if (showMessage) setAgentStatus(`${agentTasks.length} task(s).`);
    } catch (err) {
      setAgentStatus(`Agent unavailable: ${String(err?.message || err)}`);
    }
  }

  async function driveTask(taskId, maxCycles = 4) {
    if (agentBusy) return;
    agentBusy = true;
    try {
      for (let i = 0; i < maxCycles; i++) {
        setAgentStatus(`Agent working… pass ${i + 1}/${maxCycles}`);
        const data = await agentPost({action:"run",taskId});
        const task = data.task;
        if (!task) break;
        await loadAgent(false);
        if (["waiting_approval","completed","failed","cancelled"].includes(task.status)) {
          if (task.status === "waiting_approval") setAgentStatus("Agent paused for approval. Review the action in Tools.");
          else setAgentStatus(`Agent task ${task.status}.`);
          return;
        }
      }
      setAgentStatus("Agent checkpointed. Press Continue for another work pass.");
      await loadAgent(false);
    } catch (err) {
      setAgentStatus(`Agent run failed: ${String(err?.message || err)}`);
    } finally {
      agentBusy = false;
    }
  }

  async function extendAndContinue(taskId) {
    if (agentBusy) return;
    agentBusy = true;
    setAgentStatus("Extending task budget by 30 steps…");
    try {
      await agentPost({action:"extend_budget",taskId,addSteps:30});
      await loadAgent(false);
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
      const data = await agentPost({action:"create",goal,maxSteps:60,autoRun:true});
      document.getElementById("agentGoal").value = "";
      await loadAgent(false);
      const task = data.task;
      if (task?.status === "queued" || task?.status === "running") {
        agentBusy = false;
        await driveTask(task.id, 3);
        return;
      }
      if (task?.status === "waiting_approval") setAgentStatus("Agent paused for approval. Review Tools.");
      else setAgentStatus(`Agent task ${task?.status || "created"}.`);
    } catch (err) {
      setAgentStatus(`Could not start agent: ${String(err?.message || err)}`);
    } finally {
      agentBusy = false;
    }
  }

  async function cancelTask(taskId) {
    if (!confirm("Cancel this agent task? Persisted history will remain.")) return;
    try {
      await agentPost({action:"cancel",taskId});
      setAgentStatus("Agent task cancelled.");
      await loadAgent(false);
    } catch (err) {
      setAgentStatus(`Cancel failed: ${String(err?.message || err)}`);
    }
  }

  async function showDetails(taskId) {
    try {
      const data = await agentPost({action:"get",taskId});
      const task = data.task;
      const steps = Array.isArray(data.steps) ? data.steps : [];
      const lines = [
        task?.goal || "",
        "",
        ...steps.map(s => `#${s.sequence} ${s.actor} · ${s.kind} · ${s.status}\n${s.summary || ""}`)
      ];
      alert(lines.join("\n\n").slice(0,30000));
    } catch (err) {
      setAgentStatus(`Could not load task details: ${String(err?.message || err)}`);
    }
  }

  async function resumeForActivity(activityId) {
    try {
      const data = await agentPost({action:"resume_activity",activityId});
      if (data?.resumed) {
        setAgentStatus("Approved action completed. Agent resumed from its saved task state.");
        await loadAgent(false);
      }
      return data;
    } catch (err) {
      setAgentStatus(`Agent resume failed: ${String(err?.message || err)}`);
      return null;
    }
  }

  window.ThinkTankAgent = { load:loadAgent, resumeForActivity, driveTask };

  agentBtn.addEventListener("click", async () => {
    overlay.classList.remove("hidden");
    await loadAgent();
  });
  document.getElementById("closeAgentBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  document.getElementById("refreshAgentBtn").addEventListener("click", () => loadAgent());
  document.getElementById("startAgentBtn").addEventListener("click", startTask);

  if (getSecret()) loadAgent(false);
})();
