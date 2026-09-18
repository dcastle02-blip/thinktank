import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GPT_MODEL = "gpt-5.2";
const CLAUDE_MODEL = "claude-opus-5";
const MAX_DEBATE_OUTPUT_TOKENS = 3000;
const MAX_FINAL_OUTPUT_TOKENS = 6000;
const MAX_REVIEW_OUTPUT_TOKENS = 1500;
const MAX_FINAL_REVIEW_CYCLES = 20;
const MAX_TRANSCRIPT_TURNS = 40;
const MAX_INLINE_FILES = 3;
const MAX_INLINE_ATTACHMENT_CHARS = 60_000;
const MAX_KNOWLEDGE_CHARS = 32_000;
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";
const TOOLS_URL = `${SUPABASE_URL}/functions/v1/tools`;
const MAX_TOOL_STEPS_PER_MODEL = 6;
const MAX_TOOL_RESULT_CHARS = 30_000;

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-relay-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const CHARTER = `Three-way working session between Dylan, GPT, and Claude.

You are exactly one participant. Speak only as yourself. Never generate dialogue, opinions, decisions, or future turns on behalf of Dylan or the other AI.

The goal is not debate, agreement, or consensus for its own sake. The goal is to help Dylan reach the strongest useful answer. Form your own judgment from the evidence and context.

Do not agree merely to be agreeable. Do not disagree merely to create contrast. Do not search for flaws just because another participant spoke first. Treat prior contributions as working material: build on what is sound, add what is missing, and correct something only when the difference is material to facts, reasoning, risk, execution, or the outcome Dylan cares about.

If you substantially agree with a point, it is fine to say so briefly and then add value. If you disagree, explain the specific consequential difference without turning the exchange into a debate. Avoid nitpicking wording, optional preferences, or minor alternatives unless Dylan asked for that level of comparison.

Be willing to revise your own view when better reasoning or evidence appears. Do not defer automatically to Dylan or the other model; respectful correction is useful when warranted.

Distinguish facts, assumptions, hypotheses, and opinions when relevant. Agreement between the models is not proof; flag claims that still need outside verification.

When KNOWLEDGE LIBRARY excerpts are supplied, treat them as source material from Dylan's uploaded files. Ground file-specific claims in those excerpts. Do not claim to have read parts of a file that were not supplied in the current context.

Do not merely summarize the conversation. Give exactly one useful contribution as yourself, then stop. The relay controls who speaks next.`;

type Speaker = "Dylan" | "GPT" | "Claude" | "Consensus";
type AiSpeaker = "GPT" | "Claude";
type Attachment = { name: string; type?: string; size?: number; text: string };
type Turn = { speaker: Speaker; text: string; attachments?: Attachment[] };
type KnowledgeChunk = { document_id: string; document_name: string; chunk_index: number; content: string; rank: number };
type FinalizationState = {
  stage: "review" | "revise";
  cycle: number;
  drafter: AiSpeaker;
  reviewer: AiSpeaker;
  proposed: string;
  reviewText?: string;
};

function otherSpeaker(speaker: AiSpeaker): AiSpeaker { return speaker === "GPT" ? "Claude" : "GPT"; }
function formatAttachmentContext(attachments?: Attachment[]) {
  if (!attachments?.length) return "";
  return attachments.map((file, index) => `\n\n[ATTACHED FILE ${index + 1}: ${file.name}]\n${file.text}\n[END ATTACHED FILE: ${file.name}]`).join("");
}
function turnContent(turn: Turn, me: AiSpeaker) {
  const text = `${turn.text}${formatAttachmentContext(turn.attachments)}`;
  return turn.speaker === me ? text : `[${turn.speaker}]: ${text}`;
}
function toMessages(transcript: Turn[], me: AiSpeaker) {
  return transcript.map((turn) => ({ role: turn.speaker === me ? "assistant" : "user", content: turnContent(turn, me) }));
}

const STOPWORDS = new Set(["the","and","that","this","with","from","have","what","when","where","which","would","could","should","about","into","your","you","they","them","their","there","then","than","just","like","want","need","also","been","were","will","does","did","for","are","but","not","can","how","why","who","our","out","all","any","some","more","most","much","many","make","made","use","using","used","discussion","response","answer","please"]);
function buildSearchText(text: string) {
  const words = (text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((word) => !STOPWORDS.has(word));
  const unique: string[] = [];
  for (let i = words.length - 1; i >= 0 && unique.length < 18; i--) if (!unique.includes(words[i])) unique.push(words[i]);
  unique.reverse();
  return unique.join(" OR ");
}
async function getKnowledgeContext(searchBasis: string) {
  const searchText = buildSearchText(searchBasis);
  if (!searchText) return { context: "", chunks: [] as KnowledgeChunk[] };
  const { data, error } = await supabase.rpc("search_thinktank_chunks", { search_text: searchText, match_count: 12 });
  if (error) { console.warn("Knowledge search failed:", error.message); return { context: "", chunks: [] as KnowledgeChunk[] }; }
  const chunks = (data ?? []) as KnowledgeChunk[];
  let total = 0;
  const sections: string[] = [];
  const used: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    const section = `[KNOWLEDGE FILE: ${chunk.document_name} | section ${chunk.chunk_index + 1}]\n${chunk.content}`;
    if (total + section.length > MAX_KNOWLEDGE_CHARS) break;
    sections.push(section); used.push(chunk); total += section.length;
  }
  return {
    context: sections.length ? `KNOWLEDGE LIBRARY EXCERPTS\nThe following excerpts were retrieved from Dylan's persistent uploaded library. Use only what is relevant.\n\n${sections.join("\n\n---\n\n")}` : "",
    chunks: used,
  };
}
function recentSearchBasis(transcript: Turn[], extra = "") {
  return [...transcript.slice(-6).map((turn) => turn.text), extra].join("\n").slice(-12_000);
}


type ToolMode = "all" | "read_only" | "none";
type BrokerTool = {
  name: string;
  description: string;
  capability: "read" | "write" | "destructive";
  input_schema: Record<string, unknown>;
};

const BROKER_TOOLS: BrokerTool[] = [
  { name: "github_get_file", capability: "read", description: "Read a UTF-8 text file from the live GitHub repository dcastle02-blip/thinktank. Use this instead of asking Dylan to paste current code.", input_schema: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "github_list_contents", capability: "read", description: "List files or directories in the live GitHub repository dcastle02-blip/thinktank.", input_schema: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, additionalProperties: false } },
  { name: "github_create_file", capability: "write", description: "Create a new UTF-8 text file in dcastle02-blip/thinktank. This may require Dylan approval. Do not use if the path already exists.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["path", "content", "message"], additionalProperties: false } },
  { name: "github_update_file", capability: "write", description: "Replace an entire existing UTF-8 GitHub file. Requires the current blob sha from github_get_file. Prefer github_replace_text for small edits.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, sha: { type: "string" }, branch: { type: "string" } }, required: ["path", "content", "message", "sha"], additionalProperties: false } },
  { name: "github_replace_text", capability: "write", description: "Patch one exact text segment in an existing UTF-8 GitHub file. old_text must match exactly once. Prefer this for focused edits. May require Dylan approval.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["path", "old_text", "new_text", "message"], additionalProperties: false } },
  { name: "github_delete_file", capability: "destructive", description: "Delete a GitHub file. Requires current blob sha and destructive permission.", input_schema: { type: "object", properties: { path: { type: "string" }, sha: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["path", "sha", "message"], additionalProperties: false } },
  { name: "supabase_query_readonly", capability: "read", description: "Run read-only SQL against the live ThinkTank Supabase project ddxhpsgwxqoejghmsatg. Use for SELECT and inspection.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "supabase_query", capability: "write", description: "Run SQL that changes the live ThinkTank Supabase project. Writes require approval by default. Destructive SQL is escalated by the broker.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "supabase_list_functions", capability: "read", description: "List deployed Edge Functions in the live ThinkTank Supabase project.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "supabase_get_function", capability: "read", description: "Read metadata and source or body for one deployed Edge Function in the live ThinkTank Supabase project.", input_schema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false } },
  { name: "supabase_deploy_function", capability: "write", description: "Deploy or update one Edge Function in the live ThinkTank Supabase project. May require Dylan approval. source must be the complete TypeScript entrypoint.", input_schema: { type: "object", properties: { slug: { type: "string" }, source: { type: "string" }, verifyJwt: { type: "boolean" } }, required: ["slug", "source"], additionalProperties: false } },
  { name: "supabase_delete_function", capability: "destructive", description: "Delete a deployed Edge Function from the live ThinkTank Supabase project.", input_schema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false } },
];

function toolSpecs(mode: ToolMode) {
  if (mode === "none") return [];
  return mode === "read_only" ? BROKER_TOOLS.filter((tool) => tool.capability === "read") : BROKER_TOOLS;
}

function toolGuidance(mode: ToolMode) {
  if (mode === "none") return "";
  const access = mode === "read_only" ? "read-only tools" : "live read and write tools";
  return `LIVE TOOL ACCESS
You are running inside Dylan Think Tank, which has ${access} through a server-side Tool Broker.
GitHub is connected and scoped to dcastle02-blip/thinktank.
Supabase is connected and scoped to project ddxhpsgwxqoejghmsatg.

Use these tools when live repository, database, or function state would improve the answer. Do not claim that you lack network, filesystem, GitHub, Supabase, connector, MCP, or harness access when an available Think Tank tool can perform the needed action. Do not ask Dylan to run local commands merely because you need live state; inspect it yourself.

Read actions normally execute automatically. Write or destructive actions may return status "awaiting_approval". When that happens, the action has NOT executed yet. Do not resubmit the same action. Tell Dylan exactly what is queued and that he can approve it in Tools. If a prior participant already says an equivalent write is awaiting approval, do not create a duplicate request.

Never claim a queued write succeeded until a later read verifies the resulting live state. Prefer focused edits such as github_replace_text over whole-file rewrites when possible.`;
}

function openAiToolDefs(mode: ToolMode) {
  return toolSpecs(mode).map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
}

function claudeToolDefs(mode: ToolMode) {
  return toolSpecs(mode).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema }));
}

function parseToolArgs(raw: unknown) {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function compactToolResult(value: unknown) {
  let text = "";
  try { text = JSON.stringify(value); } catch { text = String(value); }
  return text.length > MAX_TOOL_RESULT_CHARS
    ? text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n[tool result truncated]"
    : text;
}

async function executeBrokerTool(speaker: AiSpeaker, toolName: string, args: Record<string, unknown>) {
  try {
    const res = await fetch(TOOLS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": RELAY_SECRET },
      body: JSON.stringify({ action: "execute", toolName, requestedBy: speaker, arguments: args }),
    });
    const raw = await res.text();
    let data: unknown = raw;
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!res.ok) {
      return { status: "failed", error: typeof data === "object" && data && "error" in data ? String((data as Record<string, unknown>).error) : raw.slice(0, 2000) };
    }
    return data;
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function callGPT(transcript: Turn[], instruction = "", maxTokens = MAX_DEBATE_OUTPUT_TOKENS, knowledgeContext = "", toolMode: ToolMode = "all") {
  const defs = openAiToolDefs(toolMode);
  const guidance = toolGuidance(toolMode);
  const system = `${CHARTER}\n\nYou are GPT.${instruction ? `\n\n${instruction}` : ""}${guidance ? `\n\n${guidance}` : ""}${knowledgeContext ? `\n\n${knowledgeContext}` : ""}`;
  const messages: any[] = [{ role: "system", content: system }, ...toMessages(transcript, "GPT")];
  let tokens = 0;

  for (let step = 0; step <= MAX_TOOL_STEPS_PER_MODEL; step++) {
    const allowTools = defs.length > 0 && step < MAX_TOOL_STEPS_PER_MODEL;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GPT_MODEL, max_completion_tokens: maxTokens, messages, ...(allowTools ? { tools: defs, tool_choice: "auto" } : {}) }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    tokens += Number(data.usage?.total_tokens ?? 0);
    const message = data.choices?.[0]?.message ?? {};
    const calls = allowTools && Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (calls.length) {
      messages.push(message);
      for (const call of calls) {
        const result = await executeBrokerTool("GPT", String(call?.function?.name ?? ""), parseToolArgs(call?.function?.arguments));
        messages.push({ role: "tool", tool_call_id: String(call.id ?? ""), content: compactToolResult(result) });
      }
      continue;
    }

    const text = String(message.content ?? "").trim();
    if (!text) throw new Error(`OpenAI returned no visible text (finish_reason=${String(data.choices?.[0]?.finish_reason ?? "unknown")}).`);
    return { text, tokens };
  }

  throw new Error("OpenAI exceeded the Think Tank tool-step limit.");
}

async function callClaude(transcript: Turn[], instruction = "", maxTokens = MAX_DEBATE_OUTPUT_TOKENS, knowledgeContext = "", toolMode: ToolMode = "all") {
  const defs = claudeToolDefs(toolMode);
  const guidance = toolGuidance(toolMode);
  const messages: any[] = [...toMessages(transcript, "Claude")];
  const system = `${CHARTER}\n\nYou are Claude.${instruction ? `\n\n${instruction}` : ""}${guidance ? `\n\n${guidance}` : ""}${knowledgeContext ? `\n\n${knowledgeContext}` : ""}`;
  let tokens = 0;

  for (let step = 0; step <= MAX_TOOL_STEPS_PER_MODEL; step++) {
    const allowTools = defs.length > 0 && step < MAX_TOOL_STEPS_PER_MODEL;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, output_config: { effort: "high" }, system, messages, ...(allowTools ? { tools: defs } : {}) }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const usage = data.usage ?? {};
    tokens += Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0);
    const content = Array.isArray(data.content) ? data.content : [];
    const uses = allowTools ? content.filter((block: any) => block?.type === "tool_use") : [];

    if (uses.length) {
      messages.push({ role: "assistant", content });
      const results = [];
      for (const use of uses) {
        const result = await executeBrokerTool("Claude", String(use.name ?? ""), parseToolArgs(use.input));
        results.push({ type: "tool_result", tool_use_id: String(use.id ?? ""), content: compactToolResult(result) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = content.filter((block: any) => block?.type === "text" && typeof block.text === "string").map((block: any) => block.text).join("").trim();
    if (!text) {
      const contentTypes = content.map((block: any) => block?.type ?? "unknown").join(",") || "none";
      throw new Error(`Anthropic returned no visible text (stop_reason=${String(data.stop_reason ?? "unknown")}; content_types=${contentTypes}).`);
    }
    return { text, tokens };
  }

  throw new Error("Anthropic exceeded the Think Tank tool-step limit.");
}

async function callModel(speaker: AiSpeaker, transcript: Turn[], instruction = "", maxTokens = MAX_DEBATE_OUTPUT_TOKENS, knowledgeContext = "", toolMode: ToolMode = "all") {
  return speaker === "GPT"
    ? callGPT(transcript, instruction, maxTokens, knowledgeContext, toolMode)
    : callClaude(transcript, instruction, maxTokens, knowledgeContext, toolMode);
}

function normalizeTranscript(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<Speaker>(["Dylan", "GPT", "Claude", "Consensus"]);
  return value.filter((turn) => turn && typeof turn === "object").map((turn) => turn as Record<string, unknown>)
    .filter((turn) => allowed.has(turn.speaker as Speaker) && typeof turn.text === "string")
    .map((turn) => ({
      speaker: turn.speaker as Speaker,
      text: String(turn.text),
      attachments: Array.isArray(turn.attachments) ? turn.attachments.filter((file) => file && typeof file === "object").map((file) => file as Record<string, unknown>)
        .filter((file) => typeof file.name === "string" && typeof file.text === "string")
        .map((file) => ({ name: String(file.name), type: typeof file.type === "string" ? file.type : undefined, size: typeof file.size === "number" ? file.size : undefined, text: String(file.text) })) : undefined,
    }))
    .filter((turn) => turn.speaker === "Dylan" || turn.text.trim().length > 0);
}
function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const attachments = value.filter((file) => file && typeof file === "object").map((file) => file as Record<string, unknown>)
    .filter((file) => typeof file.name === "string" && typeof file.text === "string")
    .map((file) => ({ name: String(file.name).slice(0, 200), type: typeof file.type === "string" ? file.type.slice(0, 100) : undefined, size: typeof file.size === "number" ? file.size : undefined, text: String(file.text) }));
  if (attachments.length > MAX_INLINE_FILES) throw new Error(`A maximum of ${MAX_INLINE_FILES} inline files can be attached at once.`);
  const totalChars = attachments.reduce((sum, file) => sum + file.text.length, 0);
  if (totalChars > MAX_INLINE_ATTACHMENT_CHARS) throw new Error(`Inline attached text exceeds the ${MAX_INLINE_ATTACHMENT_CHARS.toLocaleString()} character limit.`);
  return attachments;
}
function reviewAgrees(text: string) { return /^AGREE(?:\s|$)/i.test(text.trim()); }
function normalizeFinalizationState(value: unknown): FinalizationState | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (s.stage !== "review" && s.stage !== "revise") return null;
  if (s.drafter !== "GPT" && s.drafter !== "Claude") return null;
  if (s.reviewer !== "GPT" && s.reviewer !== "Claude") return null;
  if (s.drafter === s.reviewer) return null;
  const cycle = Math.max(0, Math.min(MAX_FINAL_REVIEW_CYCLES - 1, Math.floor(Number(s.cycle ?? 0))));
  const proposed = typeof s.proposed === "string" ? s.proposed.slice(0, 100_000) : "";
  const reviewText = typeof s.reviewText === "string" ? s.reviewText.slice(0, 40_000) : undefined;
  if (!proposed.trim()) return null;
  if (s.stage === "revise" && !reviewText?.trim()) return null;
  return { stage: s.stage, cycle, drafter: s.drafter, reviewer: s.reviewer, proposed, reviewText } as FinalizationState;
}

const draftInstruction = `FINALIZATION MODE.\nCreate the best final output Dylan can directly use, based on the full discussion and relevant knowledge excerpts. Synthesize the strongest supported material without forcing artificial compromise. Preserve genuine uncertainty or meaningful alternatives when they matter. Follow Dylan's requested output format exactly. Produce only the proposed final output, not commentary about the process.`;
const reviewInstruction = `FINALIZATION REVIEW MODE.\nAct as a quality reviewer, not an adversary. Review the proposed final output against Dylan's actual request, the discussion, and relevant knowledge excerpts. Your job is to catch MATERIAL problems, not to create disagreement. Do not reject because you could phrase it differently, prefer another valid approach, or can imagine an optional enhancement. Do not invent new requirements after earlier issues are fixed. If the candidate is directly usable, faithful to Dylan's request, and has no consequential factual, logical, completeness, source-grounding, execution, or user-intent problem, return AGREE even if you would personally write it differently.\n\nReturn exactly one of these formats:\nAGREE\nor\nREVISE\n- concise blocking change 1\n- concise blocking change 2`;
const reviseInstruction = `FINALIZATION REVISION MODE.\nRevise the proposed final output to address the other model's MATERIAL blocking review points while preserving Dylan's requested format and all sound content. Do not make changes merely to appease the reviewer when its objection is optional, stylistic, or contrary to Dylan's request or supplied evidence. The goal is a correct, useful final answer, not agreement for its own sake. Produce only the revised final output.`;

async function finalizeStep(baseTranscript: Turn[], requestedSpeaker: AiSpeaker, rawState: unknown, knowledgeContext: string) {
  const state = normalizeFinalizationState(rawState);
  if (!state) {
    const drafter = requestedSpeaker;
    const reviewer = otherSpeaker(drafter);
    const draft = await callModel(drafter, baseTranscript, draftInstruction, MAX_FINAL_OUTPUT_TOKENS, knowledgeContext, "read_only");
    const nextState: FinalizationState = { stage: "review", cycle: 0, drafter, reviewer, proposed: draft.text };
    return {
      transcript: baseTranscript,
      nextSpeaker: drafter,
      finalization: { status: "continue", phase: "drafted", cycle: 1, maxCycles: MAX_FINAL_REVIEW_CYCLES, state: nextState },
      usage: { gptTokens: drafter === "GPT" ? draft.tokens : 0, claudeTokens: drafter === "Claude" ? draft.tokens : 0, roundTokens: draft.tokens },
    };
  }

  if (state.stage === "review") {
    const working: Turn[] = [...baseTranscript, { speaker: state.drafter, text: `[PROPOSED FINAL OUTPUT]\n${state.proposed}` }];
    const review = await callModel(state.reviewer, working, reviewInstruction, MAX_REVIEW_OUTPUT_TOKENS, knowledgeContext, "read_only");
    const usage = { gptTokens: state.reviewer === "GPT" ? review.tokens : 0, claudeTokens: state.reviewer === "Claude" ? review.tokens : 0, roundTokens: review.tokens };
    if (reviewAgrees(review.text)) {
      return {
        transcript: [...baseTranscript, { speaker: "Consensus", text: state.proposed } as Turn],
        nextSpeaker: state.drafter,
        finalization: { status: "agreed", cycle: state.cycle + 1, maxCycles: MAX_FINAL_REVIEW_CYCLES, drafter: state.drafter, reviewer: state.reviewer },
        usage,
      };
    }
    if (state.cycle >= MAX_FINAL_REVIEW_CYCLES - 1) {
      return {
        transcript: baseTranscript,
        nextSpeaker: state.drafter,
        finalization: { status: "unresolved", reason: "safety_limit", cycle: state.cycle + 1, maxCycles: MAX_FINAL_REVIEW_CYCLES, proposed: state.proposed, review: review.text, drafter: state.drafter, reviewer: state.reviewer },
        usage,
      };
    }
    const nextState: FinalizationState = { ...state, stage: "revise", reviewText: review.text };
    return { transcript: baseTranscript, nextSpeaker: state.drafter, finalization: { status: "continue", phase: "needs_revision", cycle: state.cycle + 1, maxCycles: MAX_FINAL_REVIEW_CYCLES, state: nextState }, usage };
  }

  const working: Turn[] = [
    ...baseTranscript,
    { speaker: state.drafter, text: `[PROPOSED FINAL OUTPUT]\n${state.proposed}` },
    { speaker: state.reviewer, text: `[FINAL REVIEW]\n${state.reviewText}` },
  ];
  const revision = await callModel(state.drafter, working, reviseInstruction, MAX_FINAL_OUTPUT_TOKENS, knowledgeContext, "read_only");
  const nextState: FinalizationState = { stage: "review", cycle: state.cycle + 1, drafter: state.drafter, reviewer: state.reviewer, proposed: revision.text };
  return {
    transcript: baseTranscript,
    nextSpeaker: state.drafter,
    finalization: { status: "continue", phase: "revised", cycle: nextState.cycle + 1, maxCycles: MAX_FINAL_REVIEW_CYCLES, state: nextState },
    usage: { gptTokens: state.drafter === "GPT" ? revision.tokens : 0, claudeTokens: state.drafter === "Claude" ? revision.tokens : 0, roundTokens: revision.tokens },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-relay-secret") !== RELAY_SECRET) return json({ error: "unauthorized" }, 401);
  try {
    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "message";
    const transcript = normalizeTranscript(body.transcript);
    const requestedSpeaker: AiSpeaker = body.nextSpeaker === "Claude" || body.firstSpeaker === "Claude" ? "Claude" : "GPT";
    if (transcript.length > MAX_TRANSCRIPT_TURNS) return json({ error: `transcript exceeds ${MAX_TRANSCRIPT_TURNS} turns; start a new session` }, 400);

    if (action === "message") {
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const attachments = normalizeAttachments(body.attachments);
      if (!message && attachments.length === 0) return json({ error: "message is required" }, 400);
      const working: Turn[] = [...transcript, { speaker: "Dylan", text: message || "Please review the attached file(s).", attachments: attachments.length ? attachments : undefined }];
      const knowledge = await getKnowledgeContext(recentSearchBasis(working, message));
      let gptTokens = 0, claudeTokens = 0, speaker = requestedSpeaker;
      for (let i = 0; i < 2; i++) {
        const result = await callModel(speaker, working, "", MAX_DEBATE_OUTPUT_TOKENS, knowledge.context);
        working.push({ speaker, text: result.text });
        if (speaker === "GPT") gptTokens += result.tokens; else claudeTokens += result.tokens;
        speaker = otherSpeaker(speaker);
      }
      return json({ transcript: working, nextSpeaker: speaker, knowledge: { chunksUsed: knowledge.chunks.length, filesUsed: [...new Set(knowledge.chunks.map((c) => c.document_name))] }, usage: { gptTokens, claudeTokens, roundTokens: gptTokens + claudeTokens } });
    }

    if (action === "next") {
      if (!transcript.length) return json({ error: "start a conversation before requesting the next response" }, 400);
      const knowledge = await getKnowledgeContext(recentSearchBasis(transcript));
      const result = await callModel(requestedSpeaker, transcript, "Continue the discussion from the exact point it currently stands. Do not pretend Dylan spoke again. Make the most useful next contribution. You may extend a sound idea, add missing analysis, correct a material issue, reframe the problem, or briefly confirm something that is already right. Do not manufacture disagreement or repeat points that are already settled.", MAX_DEBATE_OUTPUT_TOKENS, knowledge.context);
      const working = [...transcript, { speaker: requestedSpeaker, text: result.text } as Turn];
      const gptTokens = requestedSpeaker === "GPT" ? result.tokens : 0;
      const claudeTokens = requestedSpeaker === "Claude" ? result.tokens : 0;
      return json({ transcript: working, nextSpeaker: otherSpeaker(requestedSpeaker), knowledge: { chunksUsed: knowledge.chunks.length, filesUsed: [...new Set(knowledge.chunks.map((c) => c.document_name))] }, usage: { gptTokens, claudeTokens, roundTokens: result.tokens } });
    }

    if (action === "finalize_step" || action === "finalize") {
      if (!transcript.length) return json({ error: "start a conversation before finalizing" }, 400);
      const knowledge = await getKnowledgeContext(recentSearchBasis(transcript));
      const result = await finalizeStep(transcript, requestedSpeaker, body.finalizationState, knowledge.context);
      return json({ ...result, knowledge: { chunksUsed: knowledge.chunks.length, filesUsed: [...new Set(knowledge.chunks.map((c) => c.document_name))] } });
    }

    return json({ error: `unsupported action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
