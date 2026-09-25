// Conversation attachments are extracted in the browser and carried only in this chat's transcript.
const chatAttachInput = document.getElementById('chatAttachInput');
function renderChatAttachmentSummary() {
  document.getElementById('chatAttachSummary').textContent = pendingChatAttachments.length
    ? `${pendingChatAttachments.length} chat file(s): ${pendingChatAttachments.map(f => f.name).join(', ')}` : '';
  document.getElementById('chatAttachClear').classList.toggle('hidden', !pendingChatAttachments.length);
}
document.getElementById('chatAttachBtn').addEventListener('click', () => chatAttachInput.click());
document.getElementById('chatAttachClear').addEventListener('click', () => { pendingChatAttachments = []; renderChatAttachmentSummary(); });
chatAttachInput.addEventListener('change', async event => {
  const selected = Array.from(event.target.files || []);
  if (selected.length + pendingChatAttachments.length > 3) { document.getElementById('status').textContent = 'Up to 3 files per message.'; return; }
  document.getElementById('status').textContent = 'Reading chat attachments…';
  try {
    const parsed = [];
    for (const file of selected) {
      if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} exceeds the 15 MB chat file limit.`);
      const ext = file.name.split('.').pop().toLowerCase();
      let content;
      if (ext === 'pdf') {
        const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        const pdf = await pdfjs.getDocument({data: await file.arrayBuffer()}).promise;
        const pages = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const text = await page.getTextContent();
          pages.push(`[Page ${n}]\n${text.items.map(item => item.str || '').join(' ')}`);
        }
        content = pages.join('\n\n');
      } else if (ext === 'docx') {
        content = (await mammoth.extractRawText({arrayBuffer: await file.arrayBuffer()})).value;
      } else if (['txt','md','csv','json'].includes(ext)) content = await file.text();
      else throw new Error(`${file.name}: unsupported format.`);
      if (!content?.trim()) throw new Error(`${file.name} has no extractable text. Scanned PDFs need OCR.`);
      parsed.push({name:file.name,type:file.type,size:file.size,text:content});
    }
    const combined = [...pendingChatAttachments, ...parsed];
    if (combined.reduce((n,f) => n + f.text.length,0) > 1000000) throw new Error('Chat attachments exceed 1,000,000 extracted characters. Split the documents across chats.');
    pendingChatAttachments = combined;
    renderChatAttachmentSummary();
    document.getElementById('status').textContent = 'Attached to this chat. Send a message to share with GPT and Claude.';
  } catch (error) { document.getElementById('status').textContent = `Attachment error: ${error.message}`; }
  finally { chatAttachInput.value = ''; }
});
