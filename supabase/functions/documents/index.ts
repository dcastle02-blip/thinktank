import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw
  ? JSON.parse(secretKeysRaw)["default"]
  : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";
const MAX_CHUNKS_PER_REQUEST = 50;
const MAX_CHARS_PER_REQUEST = 350_000;
const MAX_EMBED_INPUT_CHARS = 20_000;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-relay-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

type ChunkRow = {
  id: number;
  document_id: string;
  document_name: string;
  chunk_index: number;
  content: string;
  embedding_attempts: number | null;
};

async function createEmbeddings(inputs: string[]) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs.map((text) => text.slice(0, MAX_EMBED_INPUT_CHARS)),
      encoding_format: "float",
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}

  if (!response.ok) {
    throw new Error(`OpenAI embeddings ${response.status}: ${data?.error?.message || raw.slice(0, 1000)}`);
  }

  const items = Array.isArray(data?.data) ? [...data.data].sort((a, b) => Number(a.index) - Number(b.index)) : [];
  if (items.length !== inputs.length) throw new Error(`embedding count mismatch: expected ${inputs.length}, got ${items.length}`);

  return items.map((item, index) => {
    const vector = item?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
      throw new Error(`bad embedding shape at index ${index}`);
    }
    return vector as number[];
  });
}

async function persistAttemptRows(rows: ChunkRow[], embeddings: number[][] | null) {
  const now = new Date().toISOString();
  const updates = rows.map((row, index) => ({
    id: row.id,
    document_id: row.document_id,
    document_name: row.document_name,
    chunk_index: row.chunk_index,
    content: row.content,
    embedding: embeddings ? embeddings[index] : null,
    embedding_attempts: Number(row.embedding_attempts || 0) + 1,
    embedded_at: embeddings ? now : null,
  }));

  const { error } = await supabase
    .from("thinktank_document_chunks")
    .upsert(updates, { onConflict: "id" });
  if (error) throw error;
}

async function embedRows(rows: ChunkRow[]) {
  if (!rows.length) return { attempted: 0, embedded: 0, failed: 0, error: null as string | null };
  try {
    const embeddings = await createEmbeddings(rows.map((row) => row.content));
    await persistAttemptRows(rows, embeddings);
    return { attempted: rows.length, embedded: rows.length, failed: 0, error: null as string | null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await persistAttemptRows(rows, null);
    } catch (persistErr) {
      return {
        attempted: rows.length,
        embedded: 0,
        failed: rows.length,
        error: `${message}; failed to record attempts: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
      };
    }
    return { attempted: rows.length, embedded: 0, failed: rows.length, error: message };
  }
}

async function remainingEmbeddingCount() {
  const { count, error } = await supabase
    .from("thinktank_document_chunks")
    .select("id", { head: true, count: "exact" })
    .is("embedding", null);
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-relay-secret") !== RELAY_SECRET) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "list") {
      const { data, error } = await supabase
        .from("thinktank_documents")
        .select("id,name,mime_type,size_bytes,chunk_count,status,created_at,updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const remaining = await remainingEmbeddingCount();
      return json({ documents: data ?? [], embeddingsRemaining: remaining });
    }

    if (action === "start") {
      const name = cleanName(body.name);
      const fileHash = typeof body.fileHash === "string" ? body.fileHash.trim() : "";
      const mimeType = typeof body.mimeType === "string" ? body.mimeType.slice(0, 200) : "text/plain";
      const sizeBytes = Number.isFinite(Number(body.sizeBytes)) ? Number(body.sizeBytes) : null;
      if (!name || !fileHash) return json({ error: "name and fileHash are required" }, 400);

      const { data: existing, error: existingError } = await supabase
        .from("thinktank_documents")
        .select("id,name,status,chunk_count")
        .eq("file_hash", fileHash)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing?.status === "ready") {
        return json({ documentId: existing.id, duplicate: true, document: existing });
      }

      if (existing) {
        const { error: deleteChunksError } = await supabase
          .from("thinktank_document_chunks")
          .delete()
          .eq("document_id", existing.id);
        if (deleteChunksError) throw deleteChunksError;

        const { data, error } = await supabase
          .from("thinktank_documents")
          .update({ name, mime_type: mimeType, size_bytes: sizeBytes, chunk_count: 0, status: "uploading" })
          .eq("id", existing.id)
          .select("id,name,status")
          .single();
        if (error) throw error;
        return json({ documentId: data.id, duplicate: false, document: data });
      }

      const { data, error } = await supabase
        .from("thinktank_documents")
        .insert({ name, file_hash: fileHash, mime_type: mimeType, size_bytes: sizeBytes, status: "uploading" })
        .select("id,name,status")
        .single();
      if (error) throw error;
      return json({ documentId: data.id, duplicate: false, document: data });
    }

    if (action === "chunks") {
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      const chunks = Array.isArray(body.chunks) ? body.chunks : [];
      if (!documentId || !chunks.length) return json({ error: "documentId and chunks are required" }, 400);
      if (chunks.length > MAX_CHUNKS_PER_REQUEST) return json({ error: `maximum ${MAX_CHUNKS_PER_REQUEST} chunks per request` }, 400);

      const normalized = chunks
        .filter((chunk) => chunk && typeof chunk === "object")
        .map((chunk) => ({ index: Number(chunk.index), content: typeof chunk.content === "string" ? chunk.content : "" }))
        .filter((chunk) => Number.isInteger(chunk.index) && chunk.index >= 0 && chunk.content.length > 0);
      const totalChars = normalized.reduce((sum, chunk) => sum + chunk.content.length, 0);
      if (!normalized.length) return json({ error: "no valid chunks supplied" }, 400);
      if (totalChars > MAX_CHARS_PER_REQUEST) return json({ error: `chunk batch exceeds ${MAX_CHARS_PER_REQUEST.toLocaleString()} characters` }, 400);

      const { data: document, error: docError } = await supabase
        .from("thinktank_documents")
        .select("id,name")
        .eq("id", documentId)
        .single();
      if (docError) throw docError;

      const rows = normalized.map((chunk) => ({
        document_id: documentId,
        document_name: document.name,
        chunk_index: chunk.index,
        content: chunk.content,
        embedding: null,
        embedding_attempts: 0,
        embedded_at: null,
      }));

      const { data: inserted, error } = await supabase
        .from("thinktank_document_chunks")
        .upsert(rows, { onConflict: "document_id,chunk_index" })
        .select("id,document_id,document_name,chunk_index,content,embedding_attempts");
      if (error) throw error;

      const embedding = await embedRows((inserted ?? []) as ChunkRow[]);
      return json({ inserted: rows.length, embedding });
    }

    if (action === "backfill") {
      const limit = Math.max(1, Math.min(MAX_CHUNKS_PER_REQUEST, Number(body.limit || MAX_CHUNKS_PER_REQUEST)));
      const { data: rows, error } = await supabase
        .from("thinktank_document_chunks")
        .select("id,document_id,document_name,chunk_index,content,embedding_attempts")
        .is("embedding", null)
        .lt("embedding_attempts", 5)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw error;

      const embedding = await embedRows((rows ?? []) as ChunkRow[]);
      const remaining = await remainingEmbeddingCount();
      return json({ ...embedding, remaining });
    }

    if (action === "complete") {
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      const chunkCount = Number(body.chunkCount);
      if (!documentId || !Number.isInteger(chunkCount) || chunkCount < 1) {
        return json({ error: "documentId and positive chunkCount are required" }, 400);
      }

      const { data, error } = await supabase
        .from("thinktank_documents")
        .update({ chunk_count: chunkCount, status: "ready" })
        .eq("id", documentId)
        .select("id,name,chunk_count,status")
        .single();
      if (error) throw error;
      return json({ document: data });
    }

    if (action === "delete") {
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      if (!documentId) return json({ error: "documentId is required" }, 400);
      const { error } = await supabase.from("thinktank_documents").delete().eq("id", documentId);
      if (error) throw error;
      return json({ deleted: true });
    }

    return json({ error: `unsupported action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
