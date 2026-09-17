(() => {
  const CONVERSATIONS_URL = "https://ddxhpsgwxqoejghmsatg.supabase.co/functions/v1/conversations";
  let savedConversations = [];

  const style = document.createElement("style");
  style.textContent = `
    .latest-jump{position:fixed;z-index:45;right:max(18px,calc((100vw - 820px)/2 + 18px));display:none;border:1px solid #3c4c5e;border-radius:999px;padding:9px 13px;background:#1a2531;color:#edf3f8;font-weight:750;box-shadow:0 8px 28px rgba(0,0,0,.4)}
    .latest-jump.show{display:block}
    .saved-list{display:flex;flex-direction:column;gap:9px;margin-top:12px}
    .saved-chat{border:1px solid var(--border);border-radius:13px;background:var(--bg);padding:11px}
    .saved-chat-title{font-weight:750;line-height:1.3;word-break:break-word}
    .saved-chat-meta{font-size:11px;color:var(--muted);margin-top:4px}
    .saved-chat-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    .saved-chat-actions .btn{padding:7px 9px;font-size:12px}
    .archive-tools{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
    .archive-note{font-size:12px;color:var(--muted);line-height:1.45}
    @media(max-width:560px){.latest-jump{right:14px}.header-actions .btn{padding:9px 10px}}
  `;
  document.head.appendChild(style);

  const latestBtn = document.createElement("button");
  latestBtn.id = "latestBtn";
  latestBtn.className = "latest-jump";
  latestBtn.textContent = "↓ Latest";
  latestBtn.setAttribute("aria-label", "Go to latest response");
  document.body.appendChild(latestBtn);

  const headerActions = document.querySelector(".header-actions");
  const savedBtn = document.createElement("button");
  savedBtn.id = "savedChatsBtn";
  savedBtn.className = "btn";
  savedBtn.textContent = "Saved";
  if (headerActions) headerActions.insertBefore(savedBtn, document.getElementById("settingsBtn"));

  const overlay = document.createElement("div");
  overlay.id = "savedChatsOverlay";
  overlay.className = "overlay hidden";
  overlay.innerHTML = `
    <div class="setup">
      <div class="modal-top">
        <div><h2>Saved Conversations</h2><div class="small">Archived snapshots stay unchanged when you resume them.</div></div>
        <button class="btn" id="closeSavedChatsBtn">Close</button>
      </div>
      <div class="archive-tools">
        <button class="btn primary" id="saveCurrentChatBtn">Save Current</button>
        <button class="btn" id="importChatBtn">Import Chat</button>
        <button class="btn" id="refreshSavedChatsBtn">Refresh</button>
        <input id="importChatInput" type="file" hidden accept=".thinktank,.json,application/json" />
      </div>
      <div class="archive-note">Resume loads a copy into the active Think Tank. Export creates a portable <strong>.thinktank</strong> file you can import later. Your Knowledge Library is separate and is not duplicated into the chat archive.</div>
      <div id="savedChatStatus" class="upload-detail"></div>
      <div id="savedChatsList" class="saved-list"></div>
    </div>`;
  document.body.appendChild(overlay);

  function formatDate(value) {
    try { return new Date(value).toLocaleString(); } catch { return String(value || ""); }
  }

  function deriveTitle(turns) {
    const first = (turns || []).find(t => t?.speaker === "Dylan" && String(t?.text || "").trim());
    const text = String(first?.text || "Saved Think Tank conversation").replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  function sanitizeFilename(value) {
    return String(value || "think-tank-chat")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "think-tank-chat";
  }

  function setArchiveStatus(message) {
    const el = document.getElementById("savedChatStatus");
    if (el) el.textContent = message || "";
  }

  async function conversationsPost(payload) {
    return postJson(CONVERSATIONS_URL, payload);
  }

  async function loadSavedConversations() {
    if (!getSecret()) return;
    setArchiveStatus("Loading saved conversations…");
    try {
      const data = await conversationsPost({ action: "list" });
      savedConversations = Array.isArray(data.conversations) ? data.conversations : [];
      renderSavedConversations();
      setArchiveStatus(savedConversations.length ? `${savedConversations.length} saved conversation(s).` : "No saved conversations yet.");
    } catch (err) {
      setArchiveStatus(`Archive error: ${String(err?.message || err)}`);
    }
  }

  function renderSavedConversations() {
    const list = document.getElementById("savedChatsList");
    if (!list) return;
    if (!savedConversations.length) {
      list.innerHTML = `<div class="library-empty">No saved conversations yet.</div>`;
      return;
    }
    list.innerHTML = savedConversations.map(chat => `
      <div class="saved-chat">
        <div class="saved-chat-title">${escapeHtml(chat.title)}</div>
        <div class="saved-chat-meta">${Number(chat.turn_count || 0)} turns · ${Number(chat.token_count || 0).toLocaleString()} tokens · ${escapeHtml(formatDate(chat.created_at))}</div>
        <div class="saved-chat-actions">
          <button class="btn primary" data-resume-chat="${escapeHtml(chat.id)}">Resume</button>
          <button class="btn" data-export-chat="${escapeHtml(chat.id)}">Export</button>
          <button class="btn danger" data-delete-chat="${escapeHtml(chat.id)}">Delete</button>
        </div>
      </div>`).join("");
    list.querySelectorAll("[data-resume-chat]").forEach(btn => btn.addEventListener("click", () => resumeConversation(btn.dataset.resumeChat)));
    list.querySelectorAll("[data-export-chat]").forEach(btn => btn.addEventListener("click", () => exportConversation(btn.dataset.exportChat)));
    list.querySelectorAll("[data-delete-chat]").forEach(btn => btn.addEventListener("click", () => deleteSavedConversation(btn.dataset.deleteChat)));
  }

  async function saveCurrentConversation() {
    if (!Array.isArray(transcript) || !transcript.length) {
      setArchiveStatus("There is no active conversation to save.");
      return;
    }
    const suggested = deriveTitle(transcript);
    const title = prompt("Name this saved conversation:", suggested);
    if (title === null) return;
    setArchiveStatus("Saving snapshot…");
    try {
      const data = await conversationsPost({
        action: "save",
        title: title.trim() || suggested,
        transcript,
        nextSpeaker,
        tokenCount: totalTokens,
      });
      setArchiveStatus(`Saved: ${data.conversation?.title || suggested}`);
      await loadSavedConversations();
    } catch (err) {
      setArchiveStatus(`Save failed: ${String(err?.message || err)}`);
    }
  }

  async function getSavedConversation(id) {
    const data = await conversationsPost({ action: "get", id });
    if (!data?.conversation) throw new Error("Saved conversation was not found.");
    return data.conversation;
  }

  async function resumeConversation(id) {
    try {
      const chat = await getSavedConversation(id);
      if (Array.isArray(transcript) && transcript.length) {
        const ok = confirm("Resume this saved conversation? Your current active chat will be replaced. The saved snapshot will remain archived.");
        if (!ok) return;
      }
      transcript = Array.isArray(chat.transcript) ? chat.transcript : [];
      nextSpeaker = chat.next_speaker === "Claude" ? "Claude" : "GPT";
      totalTokens = Number(chat.token_count || 0);
      saveState();
      render();
      overlay.classList.add("hidden");
      const status = document.getElementById("status");
      if (status) status.textContent = `Resumed saved conversation: ${chat.title}`;
      requestAnimationFrame(() => goLatest(false));
    } catch (err) {
      setArchiveStatus(`Resume failed: ${String(err?.message || err)}`);
    }
  }

  async function exportConversation(id) {
    try {
      const chat = await getSavedConversation(id);
      const payload = {
        format: "thinktank-conversation",
        version: 1,
        title: chat.title,
        archivedAt: chat.created_at,
        transcript: chat.transcript,
        nextSpeaker: chat.next_speaker,
        totalTokens: Number(chat.token_count || 0),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(chat.title)}.thinktank`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setArchiveStatus(`Exported: ${chat.title}`);
    } catch (err) {
      setArchiveStatus(`Export failed: ${String(err?.message || err)}`);
    }
  }

  function validateImportedTranscript(value) {
    if (!Array.isArray(value) || !value.length) throw new Error("This file does not contain a conversation transcript.");
    const allowed = new Set(["Dylan", "GPT", "Claude", "Consensus"]);
    const turns = value
      .filter(t => t && allowed.has(String(t.speaker)) && typeof t.text === "string")
      .map(t => ({ speaker: t.speaker, text: t.text }));
    if (!turns.length) throw new Error("No valid Think Tank turns were found in this file.");
    return turns;
  }

  async function importConversationFile(file) {
    if (!file) return;
    setArchiveStatus(`Importing ${file.name}…`);
    try {
      const parsed = JSON.parse(await file.text());
      const importedTranscript = validateImportedTranscript(parsed.transcript);
      const importedTitle = String(parsed.title || deriveTitle(importedTranscript)).slice(0, 160);
      const importedNext = parsed.nextSpeaker === "Claude" ? "Claude" : "GPT";
      const importedTokens = Math.max(0, Number(parsed.totalTokens || 0));

      await conversationsPost({
        action: "save",
        title: importedTitle,
        transcript: importedTranscript,
        nextSpeaker: importedNext,
        tokenCount: importedTokens,
      });

      if (Array.isArray(transcript) && transcript.length) {
        const ok = confirm("The imported chat has been archived. Load it as your active conversation now?");
        if (!ok) { await loadSavedConversations(); return; }
      }
      transcript = importedTranscript;
      nextSpeaker = importedNext;
      totalTokens = importedTokens;
      saveState();
      render();
      overlay.classList.add("hidden");
      const status = document.getElementById("status");
      if (status) status.textContent = `Imported and archived: ${importedTitle}`;
      requestAnimationFrame(() => goLatest(false));
      await loadSavedConversations();
    } catch (err) {
      setArchiveStatus(`Import failed: ${String(err?.message || err)}`);
    } finally {
      const input = document.getElementById("importChatInput");
      if (input) input.value = "";
    }
  }

  async function deleteSavedConversation(id) {
    const chat = savedConversations.find(c => c.id === id);
    if (!chat) return;
    if (!confirm(`Delete the archived snapshot “${chat.title}”? This does not affect your active conversation.`)) return;
    try {
      await conversationsPost({ action: "delete", id });
      await loadSavedConversations();
      setArchiveStatus(`Deleted archived snapshot: ${chat.title}`);
    } catch (err) {
      setArchiveStatus(`Delete failed: ${String(err?.message || err)}`);
    }
  }

  function positionLatestButton() {
    const composer = document.querySelector(".composer");
    if (!composer) return;
    const top = composer.getBoundingClientRect().top;
    latestBtn.style.top = `${Math.max(72, top - 48)}px`;
  }

  function updateLatestButton() {
    positionLatestButton();
    const doc = document.documentElement;
    const distance = doc.scrollHeight - (window.scrollY + window.innerHeight);
    latestBtn.classList.toggle("show", Array.isArray(transcript) && transcript.length > 0 && distance > 420);
  }

  function goLatest(smooth = true) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setTimeout(updateLatestButton, smooth ? 450 : 20);
  }

  async function runConsensusFinalization(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    const status = document.getElementById("status");
    if (!Array.isArray(transcript) || !transcript.length) {
      if (status) status.textContent = "Start a conversation first.";
      return;
    }
    if (!confirm("Finalize this discussion? GPT and Claude will keep drafting, reviewing, and revising until they agree on a shared final output.")) return;

    let finalizationState = null;
    let steps = 0;
    setBusy(true, "Starting consensus draft…");
    try {
      while (true) {
        const data = await postJson(RELAY_URL, {
          action: "finalize_step",
          transcript,
          nextSpeaker,
          finalizationState,
        });
        totalTokens += Number(data?.usage?.roundTokens || 0);
        const f = data?.finalization;
        if (!f) throw new Error("Finalization returned no progress state.");

        if (f.status === "agreed") {
          transcript = Array.isArray(data.transcript) ? data.transcript : transcript;
          nextSpeaker = data.nextSpeaker === "Claude" ? "Claude" : "GPT";
          saveState();
          render();
          if (status) status.textContent = `Consensus reached after ${Number(f.cycle || 1)} review cycle(s).`;
          requestAnimationFrame(() => goLatest(true));
          break;
        }

        if (f.status === "unresolved") {
          saveState();
          if (status) status.textContent = `Consensus did not converge after the ${Number(f.maxCycles || 20)}-cycle emergency safety limit. No consensus output was added.`;
          break;
        }

        finalizationState = f.state;
        if (!finalizationState) throw new Error("Finalization progress state was missing.");
        steps++;
        if (steps > 45) throw new Error("Finalization exceeded the browser safety limit.");

        const cycle = Number(f.cycle || 1);
        if (status) {
          if (f.phase === "drafted") status.textContent = `Draft complete. ${finalizationState.reviewer} is reviewing…`;
          else if (f.phase === "needs_revision") status.textContent = `Review ${cycle}: changes requested. ${finalizationState.drafter} is revising…`;
          else if (f.phase === "revised") status.textContent = `Revision ${cycle} complete. ${finalizationState.reviewer} is reviewing…`;
          else status.textContent = `Finalizing… review cycle ${cycle}.`;
        }
      }
    } catch (err) {
      if (status) status.textContent = `Finalization error: ${String(err?.message || err)}`;
    } finally {
      setBusy(false);
    }
  }

  latestBtn.addEventListener("click", () => goLatest(true));
  window.addEventListener("scroll", updateLatestButton, { passive: true });
  window.addEventListener("resize", updateLatestButton);
  const composerTextarea = document.getElementById("question");
  if (composerTextarea) composerTextarea.addEventListener("input", positionLatestButton);
  const messages = document.getElementById("messages");
  if (messages) new MutationObserver(updateLatestButton).observe(messages, { childList: true, subtree: true });

  const finalizeButton = document.getElementById("finalizeBtn");
  if (finalizeButton) finalizeButton.addEventListener("click", runConsensusFinalization, true);

  savedBtn.addEventListener("click", async () => {
    overlay.classList.remove("hidden");
    await loadSavedConversations();
  });
  document.getElementById("closeSavedChatsBtn").addEventListener("click", () => overlay.classList.add("hidden"));
  document.getElementById("saveCurrentChatBtn").addEventListener("click", saveCurrentConversation);
  document.getElementById("refreshSavedChatsBtn").addEventListener("click", loadSavedConversations);
  document.getElementById("importChatBtn").addEventListener("click", () => document.getElementById("importChatInput").click());
  document.getElementById("importChatInput").addEventListener("change", e => importConversationFile(e.target.files?.[0]));

  requestAnimationFrame(updateLatestButton);
})();