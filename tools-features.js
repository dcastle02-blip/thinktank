(() => {
  const TOOLS_URL = "https://ddxhpsgwxqoejghmsatg.supabase.co/functions/v1/tools";
  let toolState = null;

  const style = document.createElement("style");
  style.textContent = `
    .tools-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
    .tool-provider{border:1px solid var(--border);border-radius:14px;background:var(--bg);padding:13px}
    .tool-provider-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
    .tool-provider-title{font-weight:800;font-size:16px}
    .tool-badge{font-size:11px;font-weight:800;border:1px solid var(--border);border-radius:999px;padding:5px 8px;color:var(--muted)}
    .tool-badge.on{color:#bff5d6;border-color:#315c46;background:#102b21}
    .tool-badge.off{color:#f3c0c0;border-color:#623737;background:#2c1717}
    .tool-scope{font-size:12px;color:var(--muted);margin-top:5px;word-break:break-word}
    .permission-row{display:grid;grid-template-columns:1fr 140px;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)}
    .permission-row:first-of-type{margin-top:10px}
    .permission-label{font-size:13px}.permission-label strong{display:block;color:var(--text)}.permission-label span{color:var(--muted);font-size:11px}
    .permission-select{width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px}
    .provider-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    .activity-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
    .activity-item{border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--bg)}
    .activity-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .activity-name{font-weight:720;font-size:13px;word-break:break-word}
    .activity-meta,.activity-result{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.4;word-break:break-word}
    .activity-actions{display:flex;gap:7px;margin-top:8px}
    .tools-warning{font-size:12px;color:var(--muted);line-height:1.5;border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--bg);margin-top:12px}
    @media(min-width:680px){.tools-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  const headerActions = document.querySelector(".header-actions");
  const toolsBtn = document.createElement("button");
  toolsBtn.id = "toolsBtn";
  toolsBtn.className = "btn";
  toolsBtn.textContent = "Tools";
  if (headerActions) headerActions.insertBefore(toolsBtn, document.getElementById("libraryBtn"));

  const overlay = document.createElement("div");
  overlay.id = "toolsOverlay";
  overlay.className = "overlay hidden";
  overlay.innerHTML = `
    <div class="setup">
      <div class="modal-top">
        <div>
          <h2>Tools</h2>
          <div class="small">Live systems GPT + Claude can inspect and modify through the Think Tank broker.</div>
        </div>
        <button class="btn" id="closeToolsBtn">Close</button>
      </div>

      <div class="tools-warning">
        Credentials stay in Supabase server-side secrets. They are never stored in this page or sent to GPT/Claude.
        Read actions can run automatically. Write and destructive actions currently require your approval.
      </div>

      <div id="toolProviders" class="tools-grid"></div>

      <div class="modal-top" style="margin-top:20px">
        <div><h2 style="font-size:17px">Activity</h2><div class="small">Every tool request and result is logged.</div></div>
        <button class="btn small-btn" id="refreshToolsBtn">Refresh</button>
      </div>
      <div id="toolStatus" class="upload-detail"></div>
      <div id="toolActivity" class="activity-list"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function setToolStatus(message) {
    const el = document.getElementById("toolStatus");
    if (el) el.textContent = message || "";
  }

  async function toolsPost(payload) {
    return postJson(TOOLS_URL, payload);
  }

  function permissionHelp(capability) {
    if (capability === "read") return "Inspect/search without changing anything";
    if (capability === "write") return "Create or modify code, SQL, or functions";
    return "Delete files/functions or other high-impact actions";
  }

  function renderProvider(name, provider) {
    const connected = Boolean(provider?.connected);
    const perms = (toolState?.permissions || []).filter(p => p.provider === name);
    const pretty = name === "github" ? "GitHub" : "Supabase";
    return `
      <div class="tool-provider">
        <div class="tool-provider-head">
          <div class="tool-provider-title">${pretty}</div>
          <div class="tool-badge ${connected ? "on" : "off"}">${connected ? "CONNECTED" : "NEEDS CREDENTIAL"}</div>
        </div>
        <div class="tool-scope">${escapeHtml(provider?.scope || "")}</div>
        ${["read","write","destructive"].map(cap => {
          const p = perms.find(x => x.capability === cap) || { mode: "disabled" };
          return `
            <div class="permission-row">
              <div class="permission-label"><strong>${cap[0].toUpperCase()+cap.slice(1)}</strong><span>${permissionHelp(cap)}</span></div>
              <select class="permission-select" data-provider="${name}" data-capability="${cap}">
                <option value="auto" ${p.mode === "auto" ? "selected" : ""}>Automatic</option>
                <option value="approval" ${p.mode === "approval" ? "selected" : ""}>Ask first</option>
                <option value="disabled" ${p.mode === "disabled" ? "selected" : ""}>Disabled</option>
              </select>
            </div>`;
        }).join("")}
        <div class="provider-actions">
          <button class="btn small-btn" data-test-provider="${name}" ${connected ? "" : "disabled"}>Test Read</button>
          <button class="btn small-btn" data-test-write="${name}" ${connected ? "" : "disabled"}>Test Write</button>
        </div>
      </div>`;
  }

  function renderTools() {
    const providers = toolState?.providers || {};
    const wrap = document.getElementById("toolProviders");
    if (wrap) wrap.innerHTML = renderProvider("github", providers.github) + renderProvider("supabase", providers.supabase);

    document.querySelectorAll(".permission-select").forEach(select => {
      select.addEventListener("change", async () => {
        const provider = select.dataset.provider;
        const capability = select.dataset.capability;
        const mode = select.value;
        setToolStatus(`Updating ${provider} ${capability} permission…`);
        try {
          await toolsPost({ action: "set_permission", provider, capability, mode });
          setToolStatus(`${provider} ${capability}: ${mode}`);
          await loadTools(false);
        } catch (err) {
          setToolStatus(`Permission update failed: ${String(err?.message || err)}`);
        }
      });
    });

    document.querySelectorAll("[data-test-provider]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const provider = btn.dataset.testProvider;
        setToolStatus(`Testing ${provider} read access…`);
        try {
          const payload = provider === "github"
            ? { action:"execute", toolName:"github_get_file", requestedBy:"Dylan", arguments:{ repo:"dcastle02-blip/thinktank", path:"index.html" } }
            : { action:"execute", toolName:"supabase_list_functions", requestedBy:"Dylan", arguments:{} };
          const data = await toolsPost(payload);
          setToolStatus(data.status === "succeeded" ? `${provider} read test succeeded.` : `${provider}: ${data.status || "request created"}`);
          await loadTools(false);
        } catch (err) {
          setToolStatus(`${provider} test failed: ${String(err?.message || err)}`);
        }
      });
    });

    document.querySelectorAll("[data-test-write]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const provider = btn.dataset.testWrite;
        setToolStatus(`Creating a ${provider} write request for approval…`);
        try {
          const payload = provider === "github"
            ? {
                action: "execute",
                toolName: "github_create_file",
                requestedBy: "Dylan",
                arguments: {
                  repo: "dcastle02-blip/thinktank",
                  path: "tool-broker-write-test.txt",
                  content: "Think Tank GitHub write test. Safe to delete after verification.\n",
                  message: "Test Think Tank GitHub write approval"
                }
              }
            : {
                action: "execute",
                toolName: "supabase_query",
                requestedBy: "Dylan",
                arguments: {
                  query: "update public.thinktank_tool_permissions set updated_at = now() where provider = 'supabase' and capability = 'read' returning provider, capability, mode, updated_at;"
                }
              };

          const data = await toolsPost(payload);
          if (data.status === "awaiting_approval") {
            setToolStatus(`${provider} write test is awaiting your approval below.`);
          } else {
            setToolStatus(`${provider} write test status: ${data.status || "request created"}`);
          }
          await loadTools(false);
        } catch (err) {
          setToolStatus(`${provider} write test failed: ${String(err?.message || err)}`);
        }
      });
    });

    const activity = toolState?.activity || [];
    const list = document.getElementById("toolActivity");
    if (!list) return;
    if (!activity.length) {
      list.innerHTML = '<div class="library-empty">No tool activity yet.</div>';
      return;
    }
    list.innerHTML = activity.map(item => `
      <div class="activity-item">
        <div class="activity-top">
          <div>
            <div class="activity-name">${escapeHtml(item.requested_by)} → ${escapeHtml(item.tool_name)}</div>
            <div class="activity-meta">${escapeHtml(item.provider)} · ${escapeHtml(item.capability)} · ${escapeHtml(new Date(item.created_at).toLocaleString())}</div>
          </div>
          <div class="tool-badge ${item.status === "succeeded" ? "on" : item.status === "failed" || item.status === "denied" ? "off" : ""}">${escapeHtml(item.status)}</div>
        </div>
        ${item.error_text ? `<div class="activity-result">Error: ${escapeHtml(item.error_text)}</div>` : ""}
        ${item.status === "awaiting_approval" ? `
          <div class="activity-actions">
            <button class="btn primary small-btn" data-approve-activity="${escapeHtml(item.id)}">Approve</button>
            <button class="btn danger small-btn" data-deny-activity="${escapeHtml(item.id)}">Deny</button>
          </div>` : ""}
      </div>`).join("");

    list.querySelectorAll("[data-approve-activity]").forEach(btn => btn.addEventListener("click", () => approveActivity(btn.dataset.approveActivity)));
    list.querySelectorAll("[data-deny-activity]").forEach(btn => btn.addEventListener("click", () => denyActivity(btn.dataset.denyActivity)));
  }

  async function loadTools(showMessage = true) {
    if (!getSecret()) return;
    if (showMessage) setToolStatus("Loading tool connections…");
    try {
      toolState = await toolsPost({ action: "status" });
      renderTools();
      if (showMessage) {
        const connected = Object.values(toolState.providers || {}).filter(x => x?.connected).length;
        setToolStatus(`${connected}/2 providers connected.`);
      }
    } catch (err) {
      setToolStatus(`Tools unavailable: ${String(err?.message || err)}`);
    }
  }

  async function approveActivity(id) {
    if (!confirm("Approve this tool action? It may modify a connected system.")) return;
    setToolStatus("Executing approved action…");
    try {
      const data = await toolsPost({ action: "approve", activityId: id });
      setToolStatus(data.status === "succeeded" ? "Approved action completed." : `Action status: ${data.status}`);
      if (window.ThinkTankAgent?.resumeForActivity) {
        const resumed = await window.ThinkTankAgent.resumeForActivity(id);
        if (resumed?.resumed) setToolStatus("Approved action completed. Agent resumed automatically.");
      }
    } catch (err) {
      setToolStatus(`Approved action failed: ${String(err?.message || err)}`);
    }
    await loadTools(false);
  }

  async function denyActivity(id) {
    try {
      await toolsPost({ action: "deny", activityId: id });
      setToolStatus("Action denied.");
      if (window.ThinkTankAgent?.resumeForActivity) {
        const resumed = await window.ThinkTankAgent.resumeForActivity(id);
        if (resumed?.resumed) setToolStatus("Action denied. Agent resumed and can choose another path.");
      }
    } catch (err) {
      setToolStatus(`Deny failed: ${String(err?.message || err)}`);
    }
    await loadTools(false);
  }

  toolsBtn.addEventListener("click", async () => {
    overlay.classList.remove("hidden");
    await loadTools();
  });
  document.getElementById("closeToolsBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  document.getElementById("refreshToolsBtn").addEventListener("click", () => loadTools());

  if (getSecret()) loadTools(false);
})();