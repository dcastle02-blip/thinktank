(() => {
  const AGENT_URL = "https://ddxhpsgwxqoejghmsatg.supabase.co/functions/v1/agent";
  let agentTasks = [];
  let agentBusy = false;
  let activeTaskId = null;
  let activeTask = null;
  let activeSteps = [];
  let cortexOpen = false;

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
    .agent-chat.hidden,.agent-home.hidden,.cortex-view.hidden,#agentBackBtn.hidden{display:none}
    .cortex-view{flex:1;overflow:auto;padding:16px 14px 80px}
    .cortex-intro{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:14px;margin-bottom:16px;line-height:1.5}
    .cortex-section-title{font-size:13px;font-weight:800;margin:18px 2px 9px}
    .cortex-card{border:1px solid var(--border);border-radius:14px;background:var(--panel);padding:13px;margin-bottom:10px}
    .cortex-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .cortex-card-title{font-weight:800;font-size:14px;line-height:1.35}
    .cortex-status{font-size:10px;font-weight:800;border:1px solid var(--border);border-radius:999px;padding:4px 7px;white-space:nowrap;text-transform:uppercase}
    .cortex-status.approved{color:#bff5d6;border-color:#315c46;background:#102b21}
    .cortex-status.proposed{color:#f7dfac;border-color:#6f5a2d;background:#30250f}
    .cortex-status.rejected,.cortex-status.retired{color:#b7bec8}
    .cortex-text{font-size:13px;line-height:1.5;margin-top:7px;white-space:pre-wrap;word-break:break-word}
    .cortex-meta{font-size:11px;color:var(--muted);line-height:1.4;margin-top:7px}
    .agent-feed{flex:1;overflow:auto;padding:16px 14px 28px}
    .agent-feed .card{box-shadow:none}
    .agent-answer-wrap{border:1px solid #665494;border-radius:16px;background:var(--panel);padding:13px;margin-bottom:16px}
    .agent-answer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
    .agent-answer-title{font-size:12px;font-weight:800;letter-spacing:.06em}
    .agent-answer-box{width:100%;min-height:220px;max-height:48vh;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);padding:12px 13px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.45;white-space:pre;overflow:auto}
    .agent-answer-note{font-size:11px;color:var(--muted);margin-top:7px}
    .agent-activity-title{font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--muted);margin:18px 2px 10px}
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
    .agent-message-compose{display:flex;gap:8px;align-items:flex-end;margin-bottom:9px}
    .agent-message-input{flex:1;min-height:48px;max-height:120px;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text);padding:10px 11px;outline:none}
    .agent-message-input:focus{border-color:#4d6783}
    .agent-message-send{flex:0 0 auto;min-height:48px}
    .agent-message-compose.hidden{display:none}
    .agent-dock-status{font-size:12px;color:var(--muted);line-height:1.4;min-height:17px;margin-bottom:8px}
    .agent-dock-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .agent-dock-actions .btn{width:100%}
    .agent-dock-secondary{display:flex;gap:8px;margin-top:8px}
    .agent-dock-secondary .btn{flex:1}
    @media (min-width:700px){
      .agent-home,.agent-feed,.cortex-view{padding-left:24px;padding-right:24px}
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
            <button class="btn small-btn" id="cortexBtn">Cortex</button>
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
          <div id="agentMessageComposer" class="agent-message-compose">
            <textarea id="agentMessageInput" class="agent-message-input" placeholder="Tell the agent what to change, clarify, stop doing, or focus on..."></textarea>
            <button class="btn primary agent-message-send" id="sendAgentMessageBtn">Send</button>
          </div>
          <div id="agentChatStatus" class="agent-dock-status"></div>
          <div id="agentPrimaryActions" class="agent-dock-actions"></div>
          <div id="agentSecondaryActions" class="agent-dock-secondary"></div>
        </div>
      </div>

      <div id="cortexView" class="cortex-view hidden">
        <div class="cortex-intro">
          <strong>Think Tank Cortex</strong>
          <div class="small">Completed agent work becomes experience memory. Approved operating rules are injected into future agent runs. Proposed rules do nothing until you approve them.</div>
        </div>
        <div id="cortexContent"></div>
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
    if (step.kind === "message" || step.actor === "Dylan") {
      const when = step.created_at ? formatWhen(step.created_at) : "";
      const seq = Number(step.sequence || 0);
      return `
        <section class="card speaker-Dylan">
          <div class="card-head">DYLAN · GUIDANCE</div>
          <div class="card-body">${escapeHtml(step.summary || "")}<div class="agent-step-meta">Step #${seq}${when ? " · " + escapeHtml(when) : ""}</div></div>
        </section>`;
    }

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

  function bestAgentAnswer(task, steps) {
    if (String(task?.result || "").trim()) return String(task.result).trim();
    if (String(task?.working_state?.summary || "").trim()) return String(task.working_state.summary).trim();

    const candidates = [...(steps || [])].reverse();
    for (const step of candidates) {
      if (!["checkpoint","model"].includes(step?.kind)) continue;
      const text = String(step?.summary || "").trim();
      if (!text || text === "Task created") continue;
      return text;
    }
    return "";
  }

  async function copyAgentAnswer() {
    const box = document.getElementById("agentAnswerBox");
    if (!box) return;
    const text = box.value || "";
    try {
      await navigator.clipboard.writeText(text);
      setAgentStatus("Answer copied.");
    } catch {
      box.focus();
      box.select();
      document.execCommand("copy");
      setAgentStatus("Answer copied.");
    }
  }

  function renderTaskChat(scrollToBottom = false) {
    const feed = document.getElementById("agentFeed");
    const primary = document.getElementById("agentPrimaryActions");
    const secondary = document.getElementById("agentSecondaryActions");
    if (!feed || !activeTask) return;

    const answer = bestAgentAnswer(activeTask, activeSteps);
    const pieces = [
      `<section class="card speaker-Dylan"><div class="card-head">DYLAN · AGENT GOAL</div><div class="card-body">${escapeHtml(activeTask.goal || "")}</div></section>`
    ];

    if (answer) {
      pieces.push(`
        <section class="agent-answer-wrap">
          <div class="agent-answer-head">
            <div class="agent-answer-title">AGENT ANSWER</div>
            <button class="btn primary small-btn" data-copy-agent-answer="1">Copy Answer</button>
          </div>
          <textarea id="agentAnswerBox" class="agent-answer-box" readonly spellcheck="false">${escapeHtml(answer)}</textarea>
          <div class="agent-answer-note">One complete copy/paste box. Tool activity stays separate below.</div>
        </section>
        <div class="agent-activity-title">AGENT ACTIVITY</div>`);
    }

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
    const composer = document.getElementById("agentMessageComposer");
    if (composer) composer.classList.toggle("hidden", terminal);

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

    feed.querySelectorAll("[data-copy-agent-answer]").forEach(btn => btn.addEventListener("click", copyAgentAnswer));
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

  function renderCortex(data) {
    const wrap = document.getElementById("cortexContent");
    if (!wrap) return;
    const rules = Array.isArray(data?.rules) ? data.rules : [];
    const experiences = Array.isArray(data?.experiences) ? data.experiences : [];
    const proposed = rules.filter(r => r.status === "proposed");
    const approved = rules.filter(r => r.status === "approved");
    const inactive = rules.filter(r => !["proposed","approved"].includes(r.status));

    const ruleCard = (rule) => `
      <div class="cortex-card">
        <div class="cortex-card-top">
          <div class="cortex-card-title">${escapeHtml(rule.title || rule.rule_key)}</div>
          <div class="cortex-status ${escapeHtml(rule.status)}">${escapeHtml(rule.status)}</div>
        </div>
        <div class="cortex-text">${escapeHtml(rule.instruction || "")}</div>
        ${rule.rationale ? `<div class="cortex-meta">Why: ${escapeHtml(rule.rationale)}</div>` : ""}
        <div class="cortex-meta">Confidence: ${Math.round(Number(rule.confidence || 0) * 100)}% · used ${Number(rule.times_used || 0)} time(s)</div>
        <div class="agent-actions">
          ${rule.status === "proposed" ? `<button class="btn primary small-btn" data-cortex-rule="${escapeHtml(rule.id)}" data-cortex-status="approved">Approve</button><button class="btn small-btn" data-cortex-rule="${escapeHtml(rule.id)}" data-cortex-status="rejected">Reject</button>` : ""}
          ${rule.status === "approved" ? `<button class="btn small-btn" data-cortex-rule="${escapeHtml(rule.id)}" data-cortex-status="retired">Retire</button>` : ""}
        </div>
      </div>`;

    const experienceCards = experiences.length ? experiences.map(exp => `
      <div class="cortex-card">
        <div class="cortex-card-top">
          <div class="cortex-card-title">${escapeHtml(exp.summary || exp.goal || "Agent experience")}</div>
          <div class="cortex-status">${escapeHtml(exp.outcome || "")}</div>
        </div>
        <div class="cortex-text">${escapeHtml(exp.lesson || "")}</div>
        <div class="cortex-meta">Goal: ${escapeHtml(exp.goal || "")}${Array.isArray(exp.tags) && exp.tags.length ? " · " + exp.tags.map(x => escapeHtml(x)).join(" · ") : ""}</div>
      </div>
    `).join("") : '<div class="library-empty">No experience memory yet.</div>';

    wrap.innerHTML = `
      <div class="cortex-section-title">Proposed rules (${proposed.length})</div>
      ${proposed.length ? proposed.map(ruleCard).join("") : '<div class="library-empty">No proposed rules waiting for review.</div>'}
      <div class="cortex-section-title">Approved rules (${approved.length})</div>
      ${approved.length ? approved.map(ruleCard).join("") : '<div class="library-empty">No approved rules yet.</div>'}
      ${inactive.length ? `<div class="cortex-section-title">Inactive rules (${inactive.length})</div>${inactive.map(ruleCard).join("")}` : ""}
      <div class="cortex-section-title">Experience memory (${experiences.length})</div>
      ${experienceCards}
    `;

    wrap.querySelectorAll("[data-cortex-rule]").forEach(btn => btn.addEventListener("click", async () => {
      const ruleId = btn.dataset.cortexRule;
      const status = btn.dataset.cortexStatus;
      try {
        await agentPost({action:"cortex_rule_status",ruleId,status});
        await loadCortex();
      } catch (err) {
        setAgentStatus(`Cortex update failed: ${String(err?.message || err)}`);
      }
    }));
  }

  async function loadCortex() {
    try {
      const data = await agentPost({action:"cortex_list"});
      renderCortex(data);
      const proposed = Array.isArray(data?.rules) ? data.rules.filter(r => r.status === "proposed").length : 0;
      setAgentStatus(proposed ? `${proposed} proposed Cortex rule(s) waiting for review.` : "Cortex is up to date.");
    } catch (err) {
      setAgentStatus(`Cortex unavailable: ${String(err?.message || err)}`);
    }
  }

  async function showCortex() {
    cortexOpen = true;
    document.getElementById("agentHome")?.classList.add("hidden");
    document.getElementById("agentChat")?.classList.add("hidden");
    document.getElementById("cortexView")?.classList.remove("hidden");
    document.getElementById("agentBackBtn")?.classList.remove("hidden");
    const title = document.getElementById("agentHeaderTitle");
    const sub = document.getElementById("agentHeaderSub");
    if (title) title.textContent = "Think Tank Cortex";
    if (sub) sub.textContent = "Experience memory + human-approved operating rules.";
    await loadCortex();
  }

  function showAgentHome() {
    cortexOpen = false;
    activeTaskId = null;
    activeTask = null;
    activeSteps = [];
    document.getElementById("agentHome")?.classList.remove("hidden");
    document.getElementById("agentChat")?.classList.add("hidden");
    document.getElementById("cortexView")?.classList.add("hidden");
    document.getElementById("agentBackBtn")?.classList.add("hidden");
    const title = document.getElementById("agentHeaderTitle");
    const sub = document.getElementById("agentHeaderSub");
    if (title) title.textContent = "Think Tank Agent";
    if (sub) sub.textContent = "Outcome-driven work with persistent state and governed tools.";
  }

  async function openTaskChat(taskId) {
    cortexOpen = false;
    activeTaskId = taskId;
    document.getElementById("agentHome")?.classList.add("hidden");
    document.getElementById("cortexView")?.classList.add("hidden");
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

  async function sendTaskMessage() {
    if (agentBusy || !activeTaskId) return;
    const input = document.getElementById("agentMessageInput");
    const message = input?.value.trim();
    if (!message) return;

    agentBusy = true;
    setAgentStatus("Sending guidance to the agent…");
    try {
      const data = await agentPost({action:"message",taskId:activeTaskId,message});
      if (input) input.value = "";
      await loadAgent(false);
      await loadTaskChat(activeTaskId, true);

      if (data?.task?.status === "waiting_approval") {
        setAgentStatus("Guidance saved. The agent will use it after the pending approval is resolved.");
        return;
      }

      agentBusy = false;
      await driveTask(activeTaskId, 2);
      return;
    } catch (err) {
      setAgentStatus(`Could not send guidance: ${String(err?.message || err)}`);
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
  document.getElementById("cortexBtn").addEventListener("click", showCortex);
  document.getElementById("refreshAgentBtn").addEventListener("click", () => cortexOpen ? loadCortex() : activeTaskId ? loadTaskChat(activeTaskId, false) : loadAgent());
  document.getElementById("startAgentBtn").addEventListener("click", startTask);
  document.getElementById("sendAgentMessageBtn").addEventListener("click", sendTaskMessage);
  document.getElementById("agentMessageInput").addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendTaskMessage();
    }
  });

  if (getSecret()) loadAgent(false);
})();
