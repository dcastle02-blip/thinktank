import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOOLS_URL = `${SUPABASE_URL}/functions/v1/tools`;
const GPT_MODEL = "gpt-5.2";
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";
const MAX_ACTIONS_PER_RUN = 4;
const MAX_TOOL_RESULT_CHARS = 12000;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

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

const BROKER_TOOLS = [
  { name:"github_get_file", description:"Read a UTF-8 file from dcastle02-blip/thinktank.", parameters:{type:"object",properties:{path:{type:"string"},branch:{type:"string"}},required:["path"],additionalProperties:false}},
  { name:"github_list_contents", description:"List a directory in dcastle02-blip/thinktank.", parameters:{type:"object",properties:{path:{type:"string"},branch:{type:"string"}},additionalProperties:false}},
  { name:"github_create_file", description:"Create a UTF-8 file in dcastle02-blip/thinktank. May require Dylan approval.", parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"},message:{type:"string"},branch:{type:"string"}},required:["path","content","message"],additionalProperties:false}},
  { name:"github_update_file", description:"Replace an existing UTF-8 file. Requires current sha. May require approval.", parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"},message:{type:"string"},sha:{type:"string"},branch:{type:"string"}},required:["path","content","message","sha"],additionalProperties:false}},
  { name:"github_replace_text", description:"Patch one exact text segment in an existing UTF-8 file. Prefer for focused edits. May require approval.", parameters:{type:"object",properties:{path:{type:"string"},old_text:{type:"string"},new_text:{type:"string"},message:{type:"string"},branch:{type:"string"}},required:["path","old_text","new_text","message"],additionalProperties:false}},
  { name:"github_delete_file", description:"Delete a GitHub file. Destructive permission applies.", parameters:{type:"object",properties:{path:{type:"string"},sha:{type:"string"},message:{type:"string"},branch:{type:"string"}},required:["path","sha","message"],additionalProperties:false}},
  { name:"supabase_query_readonly", description:"Run read-only SQL against the live Think Tank Supabase project.", parameters:{type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false}},
  { name:"supabase_query", description:"Run SQL that changes the live Think Tank Supabase project. Broker permissions apply.", parameters:{type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false}},
  { name:"supabase_list_functions", description:"List deployed Edge Functions.", parameters:{type:"object",properties:{},additionalProperties:false}},
  { name:"supabase_get_function", description:"Read one deployed Edge Function.", parameters:{type:"object",properties:{slug:{type:"string"}},required:["slug"],additionalProperties:false}},
  { name:"supabase_deploy_function", description:"Deploy or update an Edge Function. Broker permissions apply.", parameters:{type:"object",properties:{slug:{type:"string"},source:{type:"string"},verifyJwt:{type:"boolean"}},required:["slug","source"],additionalProperties:false}},
  { name:"supabase_delete_function", description:"Delete a deployed Edge Function. Destructive permission applies.", parameters:{type:"object",properties:{slug:{type:"string"}},required:["slug"],additionalProperties:false}},
];

const LOCAL_TOOLS = [
  {
    name:"agent_checkpoint",
    description:"Persist concise working state after meaningful progress, then continue if more work remains.",
    parameters:{type:"object",properties:{
      summary:{type:"string"},
      next_step:{type:"string"},
      plan:{type:"array",items:{type:"string"}},
      verified:{type:"array",items:{type:"string"}}
    },required:["summary","next_step"],additionalProperties:false}
  },
  {
    name:"agent_complete",
    description:"Mark the task complete only after the requested outcome has been verified.",
    parameters:{type:"object",properties:{
      result:{type:"string"},
      verification:{type:"array",items:{type:"string"}}
    },required:["result","verification"],additionalProperties:false}
  }
];

const OPENAI_TOOLS = [...BROKER_TOOLS, ...LOCAL_TOOLS].map(t => ({type:"function",function:t}));

function compact(value: unknown, max = MAX_TOOL_RESULT_CHARS) {
  let s = "";
  try { s = JSON.stringify(value); } catch { s = String(value); }
  return s.length > max ? s.slice(0, max) + "\n[truncated]" : s;
}

async function createEmbedding(text: string) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:EMBEDDING_MODEL,input:text.slice(0,24000),encoding_format:"float"}),
  });
  const raw = await res.text();
  let data:any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${data?.error?.message || raw.slice(0,500)}`);
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) throw new Error("Unexpected Cortex embedding shape");
  return vector as number[];
}

async function callGPTJson(system: string, user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:GPT_MODEL,
      max_completion_tokens:1200,
      response_format:{type:"json_object"},
      messages:[{role:"system",content:system},{role:"user",content:user}],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content || "{}");
  return JSON.parse(raw);
}

async function loadCortexContext(goal: string) {
  const { data: rules, error: ruleErr } = await supabase
    .from("thinktank_cortex_rules")
    .select("id,rule_key,title,instruction,rationale,confidence,times_used")
    .eq("status","approved")
    .order("confidence",{ascending:false})
    .limit(20);
  if (ruleErr) throw ruleErr;

  let semantic:any[] = [];
  try {
    const queryEmbedding = await createEmbedding(goal);
    const { data, error } = await supabase.rpc("match_thinktank_cortex_experiences", {
      query_embedding: queryEmbedding,
      match_count: 6,
    });
    if (!error) semantic = data ?? [];
  } catch (err) {
    console.error("Cortex semantic retrieval failed", err);
  }

  const { data: recent, error: recentErr } = await supabase
    .from("thinktank_cortex_experiences")
    .select("id,source_task_id,goal,outcome,summary,lesson,evidence,tags,created_at")
    .order("created_at",{ascending:false})
    .limit(3);
  if (recentErr) throw recentErr;

  const merged:any[] = [];
  const seen = new Set<string>();
  for (const item of [...semantic, ...(recent ?? [])]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= 6) break;
  }

  for (const rule of rules ?? []) {
    await supabase.from("thinktank_cortex_rules").update({
      times_used:Number(rule.times_used || 0)+1,
      last_used_at:new Date().toISOString(),
    }).eq("id",rule.id);
  }

  return {rules:rules ?? [], experiences:merged};
}

function formatCortexContext(cortex:any) {
  const rules = (cortex?.rules ?? []).map((r:any) =>
    `- [${r.rule_key}] ${r.instruction}`
  ).join("\n");
  const experiences = (cortex?.experiences ?? []).map((e:any) =>
    `- Outcome: ${e.outcome}. Goal: ${e.goal}\n  Lesson: ${e.lesson}\n  Evidence: ${compact(e.evidence,1600)}`
  ).join("\n");
  return `APPROVED OPERATING RULES
${rules || "(none yet)"}

RELEVANT EXPERIENCE MEMORY
${experiences || "(none yet)"}`;
}

async function captureCortexExperience(task:any, outcome:"success"|"partial"|"failure"|"cancelled", result:string, verification:any[] = []) {
  const { data: existing } = await supabase
    .from("thinktank_cortex_experiences")
    .select("id")
    .eq("source_task_id",task.id)
    .maybeSingle();
  if (existing?.id) return {experienceId:existing.id,created:false};

  const steps = await recentSteps(task.id,50);
  const evidence = steps.slice(-16).map((s:any) => ({
    sequence:s.sequence, kind:s.kind, status:s.status, summary:s.summary
  }));
  const extraction = await callGPTJson(
    "You extract durable experience from a supervised software-agent task. Use only the supplied evidence. Do not invent user preferences, motives, or facts. A candidate rule should be proposed only when the evidence supports a reusable behavior change for future agent work. Return strict JSON with keys summary, lesson, tags, candidate_rule. candidate_rule must be null or an object with title, instruction, rationale, confidence from 0 to 1.",
    `Goal:\n${task.goal}\n\nOutcome: ${outcome}\n\nResult:\n${result}\n\nVerification:\n${compact(verification,4000)}\n\nRecent evidence:\n${compact(evidence,9000)}`
  );

  const summary = String(extraction?.summary || result || task.goal).slice(0,4000);
  const lesson = String(extraction?.lesson || "No durable lesson extracted.").slice(0,6000);
  const tags = Array.isArray(extraction?.tags) ? extraction.tags.map((x:any)=>String(x).slice(0,80)).slice(0,12) : [];
  let embedding:number[]|null = null;
  try { embedding = await createEmbedding(`${task.goal}\n${summary}\n${lesson}`); } catch (err) { console.error("Cortex experience embedding failed",err); }

  const { data: experience, error } = await supabase.from("thinktank_cortex_experiences").insert({
    source_task_id:task.id,
    goal:task.goal,
    outcome,
    summary,
    lesson,
    evidence,
    tags,
    embedding,
  }).select("id").single();
  if (error) throw error;

  const candidate = extraction?.candidate_rule;
  let proposedRuleId:string|null = null;
  if (candidate && typeof candidate === "object" && String(candidate.instruction || "").trim()) {
    const confidence = Math.max(0,Math.min(1,Number(candidate.confidence ?? 0.5)));
    const ruleKey = `task-${task.id}`;
    const { data: rule, error: ruleErr } = await supabase.from("thinktank_cortex_rules").upsert({
      rule_key:ruleKey,
      title:String(candidate.title || "Proposed operating rule").slice(0,180),
      instruction:String(candidate.instruction).slice(0,4000),
      rationale:String(candidate.rationale || lesson).slice(0,4000),
      status:"proposed",
      source_task_id:task.id,
      confidence,
      updated_at:new Date().toISOString(),
    },{onConflict:"rule_key"}).select("id").single();
    if (ruleErr) throw ruleErr;
    proposedRuleId = rule.id;
  }

  return {experienceId:experience.id,proposedRuleId,created:true};
}

async function broker(toolName: string, args: Record<string, unknown>) {
  const res = await fetch(TOOLS_URL, {
    method:"POST",
    headers:{"Content-Type":"application/json","x-relay-secret":RELAY_SECRET},
    body:JSON.stringify({action:"execute",toolName,requestedBy:"GPT",arguments:args}),
  });
  const raw = await res.text();
  let data: any = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!res.ok) throw new Error(typeof data === "object" && data?.error ? String(data.error) : `Tool broker HTTP ${res.status}: ${raw.slice(0,1000)}`);
  return data;
}

async function loadTask(id: string) {
  const { data, error } = await supabase.from("thinktank_agent_tasks").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function recentSteps(taskId: string, limit = 12) {
  const { data, error } = await supabase.from("thinktank_agent_steps").select("*").eq("task_id", taskId).order("sequence", {ascending:false}).limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

async function recordStep(task: any, actor: "Dylan"|"GPT"|"System", kind: string, status: string, summary: string, detail: Record<string,unknown> = {}) {
  const sequence = Number(task.step_count || 0) + 1;
  const { error } = await supabase.from("thinktank_agent_steps").insert({
    task_id:task.id, sequence, actor, kind, status, summary:summary.slice(0,12000), detail
  });
  if (error) throw error;
  const now = new Date().toISOString();
  const { data, error: updateError } = await supabase.from("thinktank_agent_tasks")
    .update({step_count:sequence,updated_at:now,started_at:task.started_at || now})
    .eq("id",task.id).select().single();
  if (updateError) throw updateError;
  Object.assign(task, data);
}

function taskContext(task: any, steps: any[], cortex: any) {
  const history = steps.map(s => `#${s.sequence} ${s.actor}/${s.kind}/${s.status}: ${s.summary}\n${compact(s.detail,3000)}`).join("\n\n");
  return `TASK GOAL
${task.goal}

CURRENT STATUS
${task.status}

PERSISTED WORKING STATE
${compact(task.working_state || {},6000)}

RECENT STEPS
${history || "(none)"}

IMPORTANT: Any recent step from Dylan with kind=message is live user guidance for this same task. Treat the newest Dylan message as higher priority than older task assumptions unless it conflicts with safety or tool permissions. Do not restart the task; adjust the current plan and continue.

${formatCortexContext(cortex)}

Treat approved Cortex rules as persistent operating instructions unless the current user goal, tool permissions, or safety constraints require otherwise. Treat experience memory as evidence to reuse, not as infallible truth.

Operate as Dylan's supervised software agent. Work toward the task outcome, not toward producing conversation.
Use live tools whenever current GitHub or Supabase state matters. Inspect before modifying. Prefer focused edits. Never claim a write succeeded until a later read verifies it.
Writes/destructive actions may return awaiting_approval. If that happens, stop immediately; do not duplicate the request. The task engine will resume after approval.
Do not ask Dylan to run commands when a connected tool can do the work.
Keep context compact. Use agent_checkpoint after meaningful progress. Use agent_complete only when the requested outcome is actually verified live.
If a tool fails, diagnose and try a materially different next step when appropriate.
Avoid redundant inspection. Once live state is sufficiently understood, make material progress toward the goal instead of repeatedly inventorying the same repo, schema, functions, or task history.
Use the smallest set of reads needed to justify an action. Reuse facts established by recent tool results instead of guessing table, function, or path names. For implementation tasks, form a plan quickly and spend most steps implementing, testing, and verifying.
You have a finite step budget of ${task.max_steps}; current persisted step count is ${task.step_count}. Reaching the budget is a pause point, not task failure.`;
}

async function callGPT(messages: any[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:GPT_MODEL,
      max_completion_tokens:1800,
      messages,
      tools:OPENAI_TOOLS,
      tool_choice:"auto",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function refreshWaitingTask(task: any) {
  if (task.status !== "waiting_approval" || !task.pending_activity_id) return task;
  const { data: activity, error } = await supabase.from("thinktank_tool_activity")
    .select("id,tool_name,status,result_summary,error_text,completed_at")
    .eq("id",task.pending_activity_id).single();
  if (error) throw error;
  if (activity.status === "awaiting_approval" || activity.status === "approved" || activity.status === "running") return task;

  const outcome = activity.status === "succeeded" ? "succeeded" : activity.status === "denied" ? "denied" : "failed";
  await recordStep(task,"System","tool",outcome,
    `Approval result for ${activity.tool_name}: ${activity.status}`,
    {activityId:activity.id,result:activity.result_summary,error:activity.error_text});
  const state = {...(task.working_state || {}), last_approval_result:{activityId:activity.id,tool:activity.tool_name,status:activity.status,result:activity.result_summary,error:activity.error_text}};
  const { data, error: uErr } = await supabase.from("thinktank_agent_tasks").update({
    status:"running", pending_activity_id:null, working_state:state, updated_at:new Date().toISOString()
  }).eq("id",task.id).select().single();
  if (uErr) throw uErr;
  return data;
}

async function runTask(taskId: string) {
  let task = await loadTask(taskId);
  if (["completed","cancelled"].includes(task.status)) return task;
  if (task.status === "failed" && !String(task.error_text || "").startsWith("Step budget reached")) return task;
  task = await refreshWaitingTask(task);
  if (task.status === "waiting_approval") return task;

  if (Number(task.step_count) >= Number(task.max_steps)) {
    const state = {...(task.working_state || {}), budget_exhausted:true, next_step:task.working_state?.next_step || "Extend the task budget to continue."};
    const { data, error } = await supabase.from("thinktank_agent_tasks").update({
      status:"queued", working_state:state, error_text:null, completed_at:null, updated_at:new Date().toISOString()
    }).eq("id",task.id).select().single();
    if (error) throw error;
    return data;
  }

  const { data: started, error: startErr } = await supabase.from("thinktank_agent_tasks").update({
    status:"running",
    working_state:{...(task.working_state || {}),awaiting_user:false},
    updated_at:new Date().toISOString(),
    started_at:task.started_at || new Date().toISOString(),
    error_text:null
  }).eq("id",task.id).select().single();
  if (startErr) throw startErr;
  task = started;

  const steps = await recentSteps(task.id);
  const cortex = await loadCortexContext(task.goal);
  const messages:any[] = [
    {role:"system",content:"You are the execution engine for Dylan's Think Tank Agent. Take concrete actions through the provided tools. Human approval boundaries are enforced by the Tool Broker."},
    {role:"user",content:taskContext(task,steps,cortex)}
  ];

  let budgetReached = false;
  for (let action = 0; action < MAX_ACTIONS_PER_RUN; action++) {
    if (Number(task.step_count) >= Number(task.max_steps)) { budgetReached = true; break; }
    const data = await callGPT(messages);
    const message = data.choices?.[0]?.message ?? {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!calls.length) {
      const text = String(message.content || "").trim() || "No tool action selected.";
      const state = {
        ...(task.working_state || {}),
        summary:text,
        next_step:"Wait for Dylan guidance or an explicit Continue.",
        awaiting_user:true
      };
      await recordStep(task,"GPT","checkpoint","succeeded",text,{awaiting_user:true});
      const { data: queued, error } = await supabase.from("thinktank_agent_tasks").update({
        status:"queued",working_state:state,updated_at:new Date().toISOString()
      }).eq("id",task.id).select().single();
      if (error) throw error;
      return queued;
    }

    messages.push(message);
    for (const call of calls) {
      if (Number(task.step_count) >= Number(task.max_steps)) { budgetReached = true; break; }
      const name = String(call?.function?.name || "");
      let args:any = {};
      try { args = JSON.parse(String(call?.function?.arguments || "{}")); } catch {}

      if (name === "agent_checkpoint") {
        const state = {
          ...(task.working_state || {}),
          summary:String(args.summary || ""),
          next_step:String(args.next_step || ""),
          plan:Array.isArray(args.plan) ? args.plan : task.working_state?.plan || [],
          verified:Array.isArray(args.verified) ? args.verified : task.working_state?.verified || [],
        };
        await recordStep(task,"GPT","checkpoint","succeeded",state.summary,{next_step:state.next_step,plan:state.plan,verified:state.verified});
        const { data: updated, error } = await supabase.from("thinktank_agent_tasks").update({working_state:state,updated_at:new Date().toISOString()}).eq("id",task.id).select().single();
        if (error) throw error;
        task = updated;
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify({status:"saved"})});
        continue;
      }

      if (name === "agent_complete") {
        const result = String(args.result || "").trim();
        const verification = Array.isArray(args.verification) ? args.verification : [];
        await recordStep(task,"GPT","checkpoint","succeeded",`Completed: ${result}`,{verification});
        const { data: completed, error } = await supabase.from("thinktank_agent_tasks").update({
          status:"completed",result,working_state:{...(task.working_state || {}),verification},updated_at:new Date().toISOString(),completed_at:new Date().toISOString()
        }).eq("id",task.id).select().single();
        if (error) throw error;
        try {
          const cortexCapture = await captureCortexExperience(completed,"success",result,verification);
          const state = {...(completed.working_state || {}),cortex:cortexCapture};
          const { data:withCortex } = await supabase.from("thinktank_agent_tasks").update({working_state:state}).eq("id",task.id).select().single();
          return withCortex || completed;
        } catch (err) {
          console.error("Cortex capture failed",err);
          return completed;
        }
      }

      let toolResult:any;
      try {
        toolResult = await broker(name,args);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await recordStep(task,"GPT","tool","failed",`${name} failed`,{arguments:args,error});
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify({status:"failed",error})});
        continue;
      }

      if (toolResult?.status === "awaiting_approval") {
        await recordStep(task,"GPT","tool","waiting",`${name} is awaiting Dylan approval`,{arguments:args,activityId:toolResult.activityId});
        const state = {...(task.working_state || {}), pending_tool:{name,activityId:toolResult.activityId}};
        const { data: waiting, error } = await supabase.from("thinktank_agent_tasks").update({
          status:"waiting_approval",pending_activity_id:toolResult.activityId,working_state:state,updated_at:new Date().toISOString()
        }).eq("id",task.id).select().single();
        if (error) throw error;
        return waiting;
      }

      const status = toolResult?.status === "succeeded" ? "succeeded" : "failed";
      await recordStep(task,"GPT","tool",status,`${name}: ${toolResult?.status || "completed"}`,{arguments:args,result:compact(toolResult,8000)});
      task = await loadTask(task.id);
      messages.push({role:"tool",tool_call_id:call.id,content:compact(toolResult)});
    }
    if (budgetReached) break;
  }

  const exhausted = budgetReached || Number(task.step_count) >= Number(task.max_steps);
  const state = exhausted ? {...(task.working_state || {}), budget_exhausted:true, next_step:task.working_state?.next_step || "Extend the task budget to continue."} : task.working_state;
  const { data: queued, error } = await supabase.from("thinktank_agent_tasks").update({
    status:"queued", working_state:state, error_text:null, completed_at:null, updated_at:new Date().toISOString()
  }).eq("id",task.id).select().single();
  if (error) throw error;
  return queued;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:CORS_HEADERS});
  if (req.method !== "POST") return json({error:"POST only"},405);
  if (req.headers.get("x-relay-secret") !== RELAY_SECRET) return json({error:"unauthorized"},401);

  try {
    const body = await req.json();
    const action = String(body.action || "list");

    if (action === "list") {
      const { data, error } = await supabase.from("thinktank_agent_tasks")
        .select("id,title,goal,status,max_steps,step_count,working_state,pending_activity_id,result,error_text,created_at,updated_at,completed_at")
        .order("updated_at",{ascending:false}).limit(50);
      if (error) throw error;
      return json({tasks:data ?? []});
    }

    if (action === "get") {
      const task = await loadTask(String(body.taskId || ""));
      const steps = await recentSteps(task.id,50);
      return json({task,steps});
    }

    if (action === "create") {
      const goal = String(body.goal || "").trim();
      if (!goal) return json({error:"goal is required"},400);
      const title = String(body.title || goal.slice(0,80)).trim().slice(0,120);
      const maxSteps = Math.max(1,Math.min(100,Number(body.maxSteps || 60)));
      const { data:task, error } = await supabase.from("thinktank_agent_tasks").insert({title,goal,max_steps:maxSteps,status:"queued"}).select().single();
      if (error) throw error;
      await recordStep(task,"System","system","succeeded","Task created",{goal});
      const finalTask = body.autoRun === false ? await loadTask(task.id) : await runTask(task.id);
      return json({task:finalTask});
    }

    if (action === "run" || action === "resume") {
      const task = await runTask(String(body.taskId || ""));
      return json({task});
    }

    if (action === "extend_budget") {
      const id = String(body.taskId || "");
      const task = await loadTask(id);
      if (["completed","cancelled"].includes(task.status)) return json({error:"completed or cancelled tasks cannot be extended"},409);
      if (task.status === "failed" && !String(task.error_text || "").startsWith("Step budget reached")) return json({error:"only budget-exhausted failed tasks can be reopened automatically"},409);
      const add = Math.max(1,Math.min(50,Number(body.addSteps || 30)));
      const maxSteps = Math.min(100,Math.max(Number(task.max_steps || 0),Number(task.step_count || 0)) + add);
      if (maxSteps <= Number(task.step_count || 0)) return json({error:"task is already at the maximum 100-step budget"},409);
      const state = {...(task.working_state || {}), budget_exhausted:false};
      const { data, error } = await supabase.from("thinktank_agent_tasks").update({
        max_steps:maxSteps,status:"queued",working_state:state,error_text:null,completed_at:null,updated_at:new Date().toISOString()
      }).eq("id",id).select().single();
      if (error) throw error;
      return json({task:data});
    }

    if (action === "resume_activity") {
      const activityId = String(body.activityId || "");
      const { data:task, error } = await supabase.from("thinktank_agent_tasks")
        .select("*").eq("pending_activity_id",activityId).eq("status","waiting_approval").maybeSingle();
      if (error) throw error;
      if (!task) return json({resumed:false});
      const resumed = await runTask(task.id);
      return json({resumed:true,task:resumed});
    }

    if (action === "message") {
      const id = String(body.taskId || "");
      const message = String(body.message || "").trim();
      if (!message) return json({error:"message is required"},400);

      let task = await loadTask(id);
      if (["completed","cancelled"].includes(task.status)) {
        return json({error:"This task is closed. Start a follow-up task to continue work."},409);
      }

      await recordStep(task,"Dylan","message","succeeded",message,{source:"task_composer"});
      const state = {
        ...(task.working_state || {}),
        latest_user_guidance:message,
        latest_user_guidance_at:new Date().toISOString(),
        awaiting_user:false,
        next_step:"Incorporate Dylan's latest guidance and continue the existing task."
      };
      const nextStatus = task.status === "waiting_approval" ? "waiting_approval" : "queued";
      const { data, error } = await supabase.from("thinktank_agent_tasks").update({
        status:nextStatus,
        working_state:state,
        updated_at:new Date().toISOString()
      }).eq("id",id).select().single();
      if (error) throw error;
      return json({task:data});
    }

    if (action === "cancel") {
      const id = String(body.taskId || "");
      const { data, error } = await supabase.from("thinktank_agent_tasks").update({
        status:"cancelled",updated_at:new Date().toISOString(),completed_at:new Date().toISOString()
      }).eq("id",id).select().single();
      if (error) throw error;
      return json({task:data});
    }

    if (action === "cortex_list") {
      const [rulesRes, experiencesRes] = await Promise.all([
        supabase.from("thinktank_cortex_rules").select("*").order("updated_at",{ascending:false}).limit(100),
        supabase.from("thinktank_cortex_experiences").select("id,source_task_id,goal,outcome,summary,lesson,evidence,tags,created_at").order("created_at",{ascending:false}).limit(100),
      ]);
      if (rulesRes.error) throw rulesRes.error;
      if (experiencesRes.error) throw experiencesRes.error;
      return json({rules:rulesRes.data ?? [],experiences:experiencesRes.data ?? []});
    }

    if (action === "cortex_rule_status") {
      const id = String(body.ruleId || "");
      const status = String(body.status || "");
      if (!["approved","rejected","retired"].includes(status)) return json({error:"invalid Cortex rule status"},400);
      const { data, error } = await supabase.from("thinktank_cortex_rules").update({
        status,updated_at:new Date().toISOString()
      }).eq("id",id).select().single();
      if (error) throw error;
      return json({rule:data});
    }

    if (action === "cortex_capture_task") {
      const task = await loadTask(String(body.taskId || ""));
      const outcome = task.status === "completed" ? "success" : task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failure" : "partial";
      const captured = await captureCortexExperience(task,outcome,String(task.result || task.error_text || task.working_state?.summary || ""),Array.isArray(task.working_state?.verification) ? task.working_state.verification : []);
      return json({captured});
    }

    return json({error:`unsupported action: ${action}`},400);
  } catch (err) {
    return json({error:err instanceof Error ? err.message : String(err)},500);
  }
});
