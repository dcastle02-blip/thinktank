(() => {
  const ONBOARDING_URL = `${BASE}/onboarding`;
  let onboardingBusy = false;
  let onboardingStopRequested = false;
  let onboardingState = null;

  const style = document.createElement("style");
  style.textContent = `
    .onboard-shell{width:min(1100px,96vw);height:min(92vh,940px);background:var(--panel);border:1px solid var(--border);border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
    .onboard-header{padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .onboard-title{font-size:20px;font-weight:800}
    .onboard-sub{font-size:12px;color:var(--muted);margin-top:4px;max-width:760px;line-height:1.45}
    .onboard-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:16px}
    .onboard-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .onboard-stat{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--bg)}
    .onboard-stat strong{display:block;font-size:20px}
    .onboard-stat span{font-size:11px;color:var(--muted)}
    .onboard-panel{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--bg)}
    .onboard-panel h3{margin:0 0 7px;font-size:15px}
    .onboard-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .onboard-warning{border:1px solid #7f5e31;border-radius:12px;padding:12px;background:rgba(127,94,49,.08)}
    .onboard-good{border:1px solid #42664d;border-radius:12px;padding:12px;background:rgba(66,102,77,.08)}
    .onboard-gap{border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--panel)}
    .onboard-gap-badge{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
    .onboard-gap-title{font-size:16px;font-weight:800;margin-top:5px}
    .onboard-gap-question{font-size:14px;line-height:1.5;margin-top:8px}
    .onboard-gap-why{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px}
    .onboard-answer{width:100%;min-height:110px;resize:vertical;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel);color:var(--text);margin-top:12px}
    .onboard-docs{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    .onboard-doc{border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;justify-content:space-between;gap:12px}
    .onboard-doc-name{font-weight:700;word-break:break-word}
    .onboard-doc-meta{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.4}
    .onboard-pill{font-size:10px;border:1px solid var(--border);padding:4px 7px;border-radius:999px;height:max-content;white-space:nowrap}
    .onboard-progress{height:8px;border:1px solid var(--border);border-radius:999px;overflow:hidden;margin-top:10px}
    .onboard-progress>div{height:100%;background:var(--accent);transition:width .2s ease}
    .onboard-status{font-size:12px;color:var(--muted);min-height:18px;margin-top:8px}
    .onboard-agent-card{margin-bottom:16px}
    @media (min-width:760px){.onboard-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  const headerActions = document.querySelector(".header-actions");
  const onboardBtn = document.createElement("button");
  onboardBtn.id = "onboardingBtn";
  onboardBtn.className = "btn";
  onboardBtn.textContent = "Onboard";
  if (headerActions) headerActions.insertBefore(onboardBtn, document.getElementById("agentBtn") || document.getElementById("libraryBtn"));

  const overlay = document.createElement("div");
  overlay.id = "onboardingOverlay";
  overlay.className = "overlay hidden";
  overlay.innerHTML = `
    <div class="onboard-shell">
      <div class="onboard-header">
        <div>
          <div class="onboard-title">Knowledge Onboarding</div>
          <div class="onboard-sub">Teach Think Tank the operation from a curated library. It builds Process Memory, identifies gaps, and asks for specific SOPs or real-world clarification one item at a time.</div>
        </div>
        <div class="onboard-actions" style="margin-top:0">
          <button class="btn small-btn" id="refreshOnboardingBtn">Refresh</button>
          <button class="btn small-btn" id="closeOnboardingBtn">Close</button>
        </div>
      </div>
      <div id="onboardingBody" class="onboard-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const agentHome = document.getElementById("agentHome");
  if (agentHome) {
    const card = document.createElement("div");
    card.className = "agent-new onboard-agent-card";
    card.innerHTML = `
      <h3>Knowledge Onboarding</h3>
      <div class="small">Start here when teaching Think Tank a new operational knowledge base. It will read the library, build current-state Process Memory, and interview you for missing SOPs and real-world caveats.</div>
      <div class="agent-controls"><button class="btn primary" id="openOnboardingFromAgent">Open Knowledge Onboarding</button></div>
    `;
    agentHome.insertBefore(card, agentHome.firstChild);
  }

  async function onboardPost(payload) {
    return postJson(ONBOARDING_URL, payload);
  }

  function fmtScope(scope) {
    if (!scope || typeof scope !== "object") return "";
    const parts = Object.entries(scope).filter(([,v]) => String(v || "").trim()).map(([k,v]) => `${k}: ${v}`);
    return parts.join(" · ");
  }

  function pct(state) {
    const total = Number(state?.counts?.readyDocuments || 0);
    const done = Number(state?.counts?.analyzedDocuments || 0);
    return total ? Math.min(100, Math.round(done / total * 100)) : 0;
  }

  function categoryLabel(value) {
    return String(value || "").replaceAll("_"," ");
  }

  function renderOnboarding() {
    const body = document.getElementById("onboardingBody");
    if (!body) return;
    const state = onboardingState || {};
    const counts = state.counts || {};
    const session = state.session;
    const docs = Array.isArray(state.documents) ? state.documents : [];
    const gap = state.nextGap;
    const progress = pct(state);

    const freshWarning = !session && Number(counts.readyDocuments || 0) > 0 && Number(counts.activeClaims || 0) === 0;
    const noDocs = Number(counts.readyDocuments || 0) === 0;

    const docsHtml = docs.length ? docs.map(doc => {
      const pm = doc.process_memory;
      const meta = pm
        ? `${escapeHtml(pm.document_type || "reference")} · ${escapeHtml(pm.authority || "")}${fmtScope(pm.scope) ? " · " + escapeHtml(fmtScope(pm.scope)) : ""}`
        : "Not analyzed yet";
      return `
        <div class="onboard-doc">
          <div style="min-width:0">
            <div class="onboard-doc-name">${escapeHtml(doc.name)}</div>
            <div class="onboard-doc-meta">${meta}</div>
          </div>
          <div class="onboard-pill">${pm?.extraction_status === "ready" ? "learned" : pm?.extraction_status || "pending"}</div>
        </div>`;
    }).join("") : '<div class="library-empty">No curated documents uploaded yet.</div>';

    const gapHtml = gap ? `
      <div class="onboard-gap">
        <div class="onboard-gap-badge">${escapeHtml(categoryLabel(gap.category))} · priority ${Number(gap.priority || 0)}</div>
        <div class="onboard-gap-title">${escapeHtml(gap.title)}</div>
        <div class="onboard-gap-question">${escapeHtml(gap.question)}</div>
        ${gap.why_it_matters ? `<div class="onboard-gap-why">Why this matters: ${escapeHtml(gap.why_it_matters)}</div>` : ""}
        ${fmtScope(gap.scope) ? `<div class="onboard-gap-why">Scope: ${escapeHtml(fmtScope(gap.scope))}</div>` : ""}
        <textarea id="onboardingAnswer" class="onboard-answer" placeholder="Explain what actually happens here, or upload the SOP if one exists."></textarea>
        <div class="onboard-actions">
          <button class="btn primary" id="saveCurrentProcessBtn">Save as Current Process</button>
          <button class="btn" id="uploadGapSopBtn">I Have an SOP</button>
          <button class="btn" id="resolveGapBtn">Resolve Without Changing Process Memory</button>
          <button class="btn" id="dismissGapBtn">Dismiss</button>
        </div>
      </div>
    ` : `
      <div class="onboard-good">
        <strong>No open onboarding question is queued right now.</strong>
        <div class="small">If all documents have been analyzed, refresh the learning agenda to look for remaining gaps, contradictions, and missing physical/system transitions.</div>
      </div>
    `;

    body.innerHTML = `
      <div class="onboard-grid">
        <div class="onboard-stat"><strong>${Number(counts.readyDocuments || 0)}</strong><span>curated documents</span></div>
        <div class="onboard-stat"><strong>${Number(counts.analyzedDocuments || 0)}</strong><span>documents learned</span></div>
        <div class="onboard-stat"><strong>${Number(counts.activeClaims || 0)}</strong><span>current process facts</span></div>
        <div class="onboard-stat"><strong>${Number(counts.openGaps || 0)}</strong><span>open learning gaps</span></div>
        <div class="onboard-stat"><strong>${Number(counts.conflicts || 0)}</strong><span>unresolved conflicts</span></div>
      </div>

      ${freshWarning ? `
        <div class="onboard-warning">
          <strong>Existing library detected, but the new baseline has not started.</strong>
          <div class="small">You said you want the next onboarding to feel fresh. Use Start Fresh to remove only operational knowledge and library content. Agent infrastructure, Cortex, tools, and code stay intact.</div>
          <div class="onboard-actions"><button class="btn danger" id="resetKnowledgeBtn">Start Fresh</button></div>
        </div>` : ""}

      <div class="onboard-panel">
        <h3>1. Curate the source library</h3>
        <div class="small">Upload the best SOPs, process maps, system documentation, training material, and architecture references you have. Think Tank will classify them during learning.</div>
        <div class="onboard-actions">
          <button class="btn primary" id="onboardAddFilesBtn">Add Files / ZIP</button>
          <button class="btn" id="onboardAddFolderBtn">Add Folder</button>
          <button class="btn" id="openLibraryBtn">Open Library</button>
        </div>
      </div>

      <div class="onboard-panel">
        <h3>2. Let the Agent learn the baseline</h3>
        <div class="small">${session ? `Session: ${escapeHtml(session.baseline_label || session.name || "baseline")} · ${escapeHtml(session.status)}` : "No onboarding session started yet."}</div>
        <div class="onboard-progress"><div style="width:${progress}%"></div></div>
        <div class="onboard-status" id="onboardingRunStatus">${onboardingBusy ? "Agent is learning the library..." : `${progress}% analyzed`}</div>
        <div class="onboard-actions">
          <button class="btn primary" id="beginLearningBtn" ${noDocs || onboardingBusy ? "disabled" : ""}>${session ? "Continue Learning" : "Begin Learning"}</button>
          ${onboardingBusy ? '<button class="btn" id="pauseLearningBtn">Pause After Current Batch</button>' : ""}
          <button class="btn" id="refreshGapsBtn" ${Number(counts.activeClaims || 0) ? "" : "disabled"}>Rebuild Learning Agenda</button>
        </div>
      </div>

      <div class="onboard-panel">
        <h3>3. Fill the next important gap</h3>
        ${gapHtml}
      </div>

      <div class="onboard-panel">
        <h3>Document curation</h3>
        <div class="small">This is how Think Tank currently classified the source material it has learned.</div>
        <div class="onboard-docs">${docsHtml}</div>
      </div>

      <div class="onboard-panel">
        <h3>Baseline controls</h3>
        <div class="small">When the important gaps are filled, freeze this as the initial operational baseline. You can keep correcting it later through new SOPs and real-world updates.</div>
        <div class="onboard-actions">
          <button class="btn" id="exportBaselineBtn" ${Number(counts.activeClaims || 0) ? "" : "disabled"}>Export Portable Baseline</button>
          <button class="btn primary" id="markBaselineReadyBtn" ${session && Number(counts.activeClaims || 0) ? "" : "disabled"}>Mark Baseline Ready</button>
        </div>
      </div>
    `;

    bindOnboardingActions();
  }

  async function loadOnboarding() {
    try {
      onboardingState = await onboardPost({action:"status"});
      renderOnboarding();
    } catch (err) {
      const body = document.getElementById("onboardingBody");
      if (body) body.innerHTML = `<div class="onboard-warning">Could not load onboarding: ${escapeHtml(err?.message || err)}</div>`;
    }
  }

  async function startFresh() {
    const typed = window.prompt('This clears the current operational Library, Process Memory, onboarding gaps, and state snapshots.\n\nType exactly:\nRESET OPERATIONAL KNOWLEDGE');
    if (typed !== "RESET OPERATIONAL KNOWLEDGE") return;
    onboardingBusy = true;
    renderOnboarding();
    try {
      await onboardPost({action:"reset_operational_knowledge",confirmation:"RESET OPERATIONAL KNOWLEDGE"});
      localStorage.removeItem("thinktank_transcript_v1");
      localStorage.removeItem("thinktank_first_speaker_v1");
      localStorage.removeItem("thinktank_tokens_v1");
      window.location.reload();
    } catch (err) {
      onboardingBusy = false;
      alert("Reset failed: " + (err?.message || err));
      await loadOnboarding();
    }
  }

  async function runLearning() {
    if (onboardingBusy) return;
    onboardingBusy = true;
    onboardingStopRequested = false;
    renderOnboarding();

    try {
      let start = await onboardPost({action:"start"});
      let sessionId = start?.session?.id || onboardingState?.session?.id;
      if (!sessionId) throw new Error("Could not start onboarding session.");

      for (let cycle = 0; cycle < 250; cycle++) {
        if (onboardingStopRequested) break;
        const result = await onboardPost({action:"analyze_batch",sessionId,limit:2,generateGaps:true});
        onboardingState = await onboardPost({action:"status"});
        renderOnboarding();

        const failures = Array.isArray(result?.processed) ? result.processed.filter(x => x.status === "error") : [];
        if (failures.length && failures.length === (result?.processed?.length || 0)) {
          throw new Error("The current document batch could not be analyzed. Check the document status before continuing.");
        }
        if (Number(result?.remaining || 0) === 0) break;
      }
    } catch (err) {
      alert("Learning paused: " + (err?.message || err));
    } finally {
      onboardingBusy = false;
      onboardingStopRequested = false;
      await loadOnboarding();
    }
  }

  async function rebuildGaps() {
    const sessionId = onboardingState?.session?.id;
    if (!sessionId) {
      await onboardPost({action:"start"});
      onboardingState = await onboardPost({action:"status"});
    }
    const id = onboardingState?.session?.id;
    if (!id) return;
    onboardingBusy = true;
    renderOnboarding();
    try {
      await onboardPost({action:"generate_gaps",sessionId:id});
    } catch (err) {
      alert("Could not rebuild learning agenda: " + (err?.message || err));
    } finally {
      onboardingBusy = false;
      await loadOnboarding();
    }
  }

  async function answerGap(saveAsCorrection) {
    const gap = onboardingState?.nextGap;
    const input = document.getElementById("onboardingAnswer");
    const answer = String(input?.value || "").trim();
    if (!gap || !answer) {
      alert("Enter the clarification first.");
      return;
    }
    onboardingBusy = true;
    renderOnboarding();
    try {
      await onboardPost({action:"answer_gap",gapId:gap.id,answer,saveAsCorrection,resolve:true});
      if (saveAsCorrection) await onboardPost({action:"generate_gaps",sessionId:gap.session_id});
    } catch (err) {
      alert("Could not save clarification: " + (err?.message || err));
    } finally {
      onboardingBusy = false;
      await loadOnboarding();
    }
  }

  async function dismissGap() {
    const gap = onboardingState?.nextGap;
    if (!gap) return;
    await onboardPost({action:"dismiss_gap",gapId:gap.id});
    await loadOnboarding();
  }

  function openExistingLibrary(mode) {
    overlay.classList.add("hidden");
    if (mode === "files") document.getElementById("fileInput")?.click();
    else if (mode === "folder") document.getElementById("folderInput")?.click();
    else document.getElementById("libraryBtn")?.click();
  }

  async function exportBaseline() {
    try {
      const bundle = await onboardPost({action:"export_bundle"});
      const blob = new Blob([JSON.stringify(bundle,null,2)],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thinktank-process-memory-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err?.message || err));
    }
  }

  async function markReady() {
    const sessionId = onboardingState?.session?.id;
    if (!sessionId) return;
    if (!confirm("Mark this curated knowledge as the initial baseline? Open gaps will remain visible for later improvement.")) return;
    await onboardPost({action:"mark_ready",sessionId});
    await loadOnboarding();
  }

  function bindOnboardingActions() {
    document.getElementById("resetKnowledgeBtn")?.addEventListener("click", startFresh);
    document.getElementById("onboardAddFilesBtn")?.addEventListener("click", () => openExistingLibrary("files"));
    document.getElementById("onboardAddFolderBtn")?.addEventListener("click", () => openExistingLibrary("folder"));
    document.getElementById("openLibraryBtn")?.addEventListener("click", () => openExistingLibrary("library"));
    document.getElementById("beginLearningBtn")?.addEventListener("click", runLearning);
    document.getElementById("pauseLearningBtn")?.addEventListener("click", () => { onboardingStopRequested = true; });
    document.getElementById("refreshGapsBtn")?.addEventListener("click", rebuildGaps);
    document.getElementById("saveCurrentProcessBtn")?.addEventListener("click", () => answerGap(true));
    document.getElementById("resolveGapBtn")?.addEventListener("click", () => answerGap(false));
    document.getElementById("dismissGapBtn")?.addEventListener("click", dismissGap);
    document.getElementById("uploadGapSopBtn")?.addEventListener("click", () => openExistingLibrary("files"));
    document.getElementById("exportBaselineBtn")?.addEventListener("click", exportBaseline);
    document.getElementById("markBaselineReadyBtn")?.addEventListener("click", markReady);
  }

  async function openOnboarding() {
    overlay.classList.remove("hidden");
    await loadOnboarding();
  }

  onboardBtn.addEventListener("click", openOnboarding);
  document.getElementById("openOnboardingFromAgent")?.addEventListener("click", openOnboarding);
  document.getElementById("closeOnboardingBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  document.getElementById("refreshOnboardingBtn").addEventListener("click", loadOnboarding);

  window.ThinkTankOnboarding = {open:openOnboarding,refresh:loadOnboarding};
})();
