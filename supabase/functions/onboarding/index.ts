import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROCESS_MEMORY_URL = `${SUPABASE_URL}/functions/v1/process-memory`;
const GPT_MODEL = "gpt-5.2";
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-relay-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...CORS_HEADERS,"Content-Type":"application/json"}});
}
function errText(err:unknown){return err instanceof Error ? err.message : String(err);}
function clean(v:unknown){return String(v ?? "").trim();}
function slug(v:unknown){return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,180);}

async function pm(payload:Record<string,unknown>){
  const res=await fetch(PROCESS_MEMORY_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json","x-relay-secret":RELAY_SECRET},
    body:JSON.stringify(payload),
  });
  const raw=await res.text();
  let data:any={};
  try{data=raw?JSON.parse(raw):{}}catch{}
  if(!res.ok) throw new Error(data?.error || `Process Memory HTTP ${res.status}`);
  return data;
}

async function gptJson(system:string,user:string,maxTokens=5000){
  const res=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:GPT_MODEL,
      max_completion_tokens:maxTokens,
      response_format:{type:"json_object"},
      messages:[{role:"system",content:system},{role:"user",content:user}],
    }),
  });
  if(!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data=await res.json();
  return JSON.parse(String(data?.choices?.[0]?.message?.content || "{}"));
}

async function latestSession(){
  const {data,error}=await supabase.from("thinktank_onboarding_sessions")
    .select("*").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  return data;
}

async function ensureSession(){
  const existing=await latestSession();
  if(existing && existing.status!=="ready") return existing;
  const {data,error}=await supabase.from("thinktank_onboarding_sessions").insert({
    name:"Operational Knowledge Baseline",
    status:"setup",
    baseline_label:`baseline-${new Date().toISOString().slice(0,10)}`,
    summary:{}
  }).select().single();
  if(error) throw error;
  return data;
}

async function counts(sessionId?:string){
  const [docs,src,claims,corr,snaps,gaps]=await Promise.all([
    supabase.from("thinktank_documents").select("id",{head:true,count:"exact"}).eq("status","ready"),
    supabase.from("thinktank_knowledge_sources").select("document_id",{head:true,count:"exact"}).eq("extraction_status","ready"),
    supabase.from("thinktank_process_claims").select("id",{head:true,count:"exact"}).eq("status","active"),
    supabase.from("thinktank_process_corrections").select("id",{head:true,count:"exact"}).eq("status","conflict"),
    supabase.from("thinktank_state_snapshots").select("id",{head:true,count:"exact"}),
    sessionId
      ? supabase.from("thinktank_onboarding_gaps").select("id",{head:true,count:"exact"}).eq("session_id",sessionId).eq("status","open")
      : Promise.resolve({count:0,error:null} as any),
  ]);
  for(const r of [docs,src,claims,corr,snaps,gaps]) if(r.error) throw r.error;
  return {
    readyDocuments:docs.count ?? 0,
    analyzedDocuments:src.count ?? 0,
    activeClaims:claims.count ?? 0,
    conflicts:corr.count ?? 0,
    snapshots:snaps.count ?? 0,
    openGaps:gaps.count ?? 0,
  };
}

async function getStatus(){
  const session=await latestSession();
  const c=await counts(session?.id);
  let nextGap=null;
  if(session){
    const {data,error}=await supabase.from("thinktank_onboarding_gaps")
      .select("*").eq("session_id",session.id).eq("status","open")
      .order("priority",{ascending:false}).order("created_at",{ascending:true}).limit(1).maybeSingle();
    if(error) throw error;
    nextGap=data;
  }
  return {session,counts:c,nextGap};
}

async function startSession(body:any){
  const latest=await latestSession();
  if(latest && latest.status!=="ready") return {session:latest,reused:true,counts:await counts(latest.id)};
  const {data,error}=await supabase.from("thinktank_onboarding_sessions").insert({
    name:clean(body.name || "Operational Knowledge Baseline"),
    status:"setup",
    baseline_label:clean(body.baselineLabel || `baseline-${new Date().toISOString().slice(0,10)}`),
    summary:{}
  }).select().single();
  if(error) throw error;
  return {session:data,reused:false,counts:await counts(data.id)};
}

async function pendingDocuments(limit:number){
  const {data:docs,error}=await supabase.from("thinktank_documents")
    .select("id,name,status,created_at").eq("status","ready").order("created_at",{ascending:true});
  if(error) throw error;
  const {data:sources,error:sErr}=await supabase.from("thinktank_knowledge_sources")
    .select("document_id,extraction_status");
  if(sErr) throw sErr;
  const analyzed=new Set((sources ?? []).filter((s:any)=>s.extraction_status==="ready").map((s:any)=>s.document_id));
  return (docs ?? []).filter((d:any)=>!analyzed.has(d.id)).slice(0,limit);
}

async function analyzeBatch(body:any){
  const session=body.sessionId
    ? (await supabase.from("thinktank_onboarding_sessions").select("*").eq("id",body.sessionId).single()).data
    : await ensureSession();
  if(!session) throw new Error("onboarding session not found");

  const limit=Math.max(1,Math.min(5,Number(body.limit || 2)));
  await supabase.from("thinktank_onboarding_sessions").update({
    status:"analyzing",updated_at:new Date().toISOString()
  }).eq("id",session.id);

  const docs=await pendingDocuments(limit);
  const results:any[]=[];
  for(const doc of docs){
    try{
      const result=await pm({action:"analyze_document",documentId:doc.id});
      results.push({documentId:doc.id,name:doc.name,status:"ready",result});
    }catch(err){
      results.push({documentId:doc.id,name:doc.name,status:"error",error:errText(err)});
    }
  }

  const remaining=(await pendingDocuments(10000)).length;
  const nextStatus=remaining===0 ? "interview" : "analyzing";
  await supabase.from("thinktank_onboarding_sessions").update({
    status:nextStatus,
    updated_at:new Date().toISOString(),
    summary:{last_batch:results.length,remaining_documents:remaining}
  }).eq("id",session.id);

  let gaps=null;
  if(remaining===0 && body.generateGaps!==false) gaps=await generateGaps({sessionId:session.id});
  return {sessionId:session.id,processed:results,remaining,gaps,counts:await counts(session.id)};
}

const GAP_SYSTEM = `You are the onboarding lead for an operational knowledge system.
Your job is to behave like an excellent new employee learning a complex distribution-center operation from curated documents.

Do NOT invent missing process links. Identify what the current evidence establishes and what is still missing.
Prefer asking for an SOP, architecture document, process map, or training document before asking the human to explain from memory.
When a document probably exists for a gap, category should be needs_sop.
When the answer is likely a real-world customization, undocumented exception, physical associate behavior, or implementation caveat, category should be needs_clarification.
Use conflict when sources disagree.
Use partial when a process is documented but an important transition/exception/physical step remains incomplete.
Use coverage for a major process area that has little or no supporting evidence.

Pay special attention to:
- system-to-system transitions
- physical human actions
- triggers and state transitions
- exceptions and recovery
- facility-specific customizations
- upstream/downstream dependencies
- queues/backlogs
- data sources and metrics that would later support troubleshooting or a digital twin

Return JSON:
{
 "summary":"brief assessment of current baseline",
 "gaps":[
   {
     "gap_key":"stable concise key",
     "category":"needs_sop|needs_clarification|conflict|partial|coverage",
     "title":"short title",
     "question":"one specific question to ask Dylan",
     "why_it_matters":"short reason",
     "scope":{},
     "related_claim_keys":[],
     "priority":1-100
   }
 ]
}
Generate at most 20 high-value gaps. Questions must be specific and answerable one at a time. Do not ask broad questions like 'what else should I know?'.`;

async function generateGaps(body:any){
  const sessionId=String(body.sessionId || (await ensureSession()).id);
  const [claimsRes,sourcesRes,conflictsRes]=await Promise.all([
    supabase.from("thinktank_process_claims")
      .select("claim_key,claim_type,statement,scope,authority,confidence,source_effective_date")
      .eq("status","active").order("updated_at",{ascending:false}).limit(700),
    supabase.from("thinktank_knowledge_sources")
      .select("document_id,document_type,authority,scope,effective_date,version_label,summary,metadata")
      .eq("extraction_status","ready").order("updated_at",{ascending:false}).limit(250),
    supabase.from("thinktank_process_corrections")
      .select("id,correction_text,reason,scope,target_claim_id,resulting_claim_id")
      .eq("status","conflict").order("created_at",{ascending:false}).limit(100),
  ]);
  for(const r of [claimsRes,sourcesRes,conflictsRes]) if(r.error) throw r.error;

  const payload={
    sources:sourcesRes.data ?? [],
    active_claims:claimsRes.data ?? [],
    unresolved_conflicts:conflictsRes.data ?? [],
  };
  const extracted=await gptJson(GAP_SYSTEM,JSON.stringify(payload).slice(0,110000),6000);
  const gaps=Array.isArray(extracted?.gaps) ? extracted.gaps.slice(0,20) : [];

  for(const raw of gaps){
    const key=slug(raw.gap_key || raw.title || raw.question);
    if(!key || !clean(raw.question)) continue;
    const category=["needs_sop","needs_clarification","conflict","partial","coverage"].includes(String(raw.category))
      ? String(raw.category) : "partial";
    const row={
      session_id:sessionId,
      gap_key:key,
      category,
      title:clean(raw.title || raw.question).slice(0,300),
      question:clean(raw.question).slice(0,3000),
      why_it_matters:clean(raw.why_it_matters).slice(0,3000) || null,
      scope:raw.scope && typeof raw.scope==="object" ? raw.scope : {},
      related_claim_keys:Array.isArray(raw.related_claim_keys) ? raw.related_claim_keys.map((x:any)=>slug(x)).filter(Boolean).slice(0,50) : [],
      priority:Math.max(1,Math.min(100,Number(raw.priority || 50))),
      status:"open",
      updated_at:new Date().toISOString(),
    };
    const {error}=await supabase.from("thinktank_onboarding_gaps").upsert(row,{onConflict:"session_id,gap_key"});
    if(error) throw error;
  }

  await supabase.from("thinktank_onboarding_sessions").update({
    status:"interview",
    summary:{assessment:clean(extracted?.summary),gap_count:gaps.length},
    updated_at:new Date().toISOString()
  }).eq("id",sessionId);

  return {summary:clean(extracted?.summary),generated:gaps.length};
}

async function listGaps(body:any){
  const sessionId=String(body.sessionId || (await ensureSession()).id);
  const status=clean(body.status || "open");
  let q=supabase.from("thinktank_onboarding_gaps").select("*").eq("session_id",sessionId);
  if(status!=="all") q=q.eq("status",status);
  const {data,error}=await q.order("priority",{ascending:false}).order("created_at",{ascending:true}).limit(100);
  if(error) throw error;
  return {sessionId,gaps:data ?? []};
}

async function answerGap(body:any){
  const gapId=String(body.gapId || "");
  const answer=clean(body.answer);
  if(!gapId || !answer) throw new Error("gapId and answer are required");
  const {data:gap,error:gErr}=await supabase.from("thinktank_onboarding_gaps").select("*").eq("id",gapId).single();
  if(gErr) throw gErr;

  let correction:any=null;
  if(body.saveAsCorrection===true){
    correction=await pm({
      action:"add_correction",
      text:answer,
      scope:gap.scope || {},
      sourceType:"conversation",
      sourceRef:`Knowledge onboarding: ${gap.title}`,
    });
  }

  const {data,error}=await supabase.from("thinktank_onboarding_gaps").update({
    status:body.resolve===false ? "answered" : "resolved",
    answer_text:answer,
    resolution:{saved_as_correction:body.saveAsCorrection===true,process_memory:correction || null},
    updated_at:new Date().toISOString(),
  }).eq("id",gapId).select().single();
  if(error) throw error;
  return {gap:data,correction};
}

async function dismissGap(body:any){
  const gapId=String(body.gapId || "");
  if(!gapId) throw new Error("gapId is required");
  const {data,error}=await supabase.from("thinktank_onboarding_gaps").update({
    status:"dismissed",updated_at:new Date().toISOString()
  }).eq("id",gapId).select().single();
  if(error) throw error;
  return {gap:data};
}

async function markReady(body:any){
  const sessionId=String(body.sessionId || "");
  if(!sessionId) throw new Error("sessionId is required");
  const c=await counts(sessionId);
  const {data,error}=await supabase.from("thinktank_onboarding_sessions").update({
    status:"ready",
    completed_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
    summary:{...(body.summary && typeof body.summary==="object" ? body.summary : {}),final_counts:c}
  }).eq("id",sessionId).select().single();
  if(error) throw error;
  return {session:data,counts:c};
}

async function resetOperationalKnowledge(body:any){
  if(body.confirmation!=="RESET OPERATIONAL KNOWLEDGE"){
    return {requiresConfirmation:true,confirmationText:"RESET OPERATIONAL KNOWLEDGE"};
  }

  const before=await counts((await latestSession())?.id);
  const operations=[
    supabase.from("thinktank_onboarding_sessions").delete().not("id","is",null),
    supabase.from("thinktank_state_snapshots").delete().not("id","is",null),
    supabase.from("thinktank_process_corrections").delete().not("id","is",null),
    supabase.from("thinktank_process_evidence").delete().not("id","is",null),
    supabase.from("thinktank_process_claims").delete().not("id","is",null),
    supabase.from("thinktank_process_nodes").delete().not("id","is",null),
    supabase.from("thinktank_knowledge_sources").delete().not("document_id","is",null),
    supabase.from("thinktank_documents").delete().not("id","is",null),
  ];
  for(const op of operations){
    const {error}=await op;
    if(error) throw error;
  }
  return {reset:true,before,after:await counts()};
}

async function exportBundle(){
  const tables=[
    "thinktank_knowledge_sources",
    "thinktank_process_nodes",
    "thinktank_process_claims",
    "thinktank_process_evidence",
    "thinktank_process_corrections",
    "thinktank_state_snapshots",
    "thinktank_state_metrics",
    "thinktank_onboarding_sessions",
    "thinktank_onboarding_gaps",
  ];
  const bundle:any={
    format:"thinktank-process-memory",
    version:1,
    exported_at:new Date().toISOString(),
    tables:{},
  };
  for(const table of tables){
    const {data,error}=await supabase.from(table).select("*").limit(10000);
    if(error) throw error;
    bundle.tables[table.replace(/^thinktank_/,"")]=data ?? [];
  }
  return bundle;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS_HEADERS});
  if(req.method!=="POST") return json({error:"POST only"},405);
  if(req.headers.get("x-relay-secret")!==RELAY_SECRET) return json({error:"unauthorized"},401);

  try{
    const body=await req.json();
    const action=String(body.action || "status");
    if(action==="status") return json(await getStatus());
    if(action==="start") return json(await startSession(body));
    if(action==="analyze_batch") return json(await analyzeBatch(body));
    if(action==="generate_gaps") return json(await generateGaps(body));
    if(action==="list_gaps") return json(await listGaps(body));
    if(action==="answer_gap") return json(await answerGap(body));
    if(action==="dismiss_gap") return json(await dismissGap(body));
    if(action==="mark_ready") return json(await markReady(body));
    if(action==="reset_operational_knowledge") return json(await resetOperationalKnowledge(body));
    if(action==="export_bundle") return json(await exportBundle());
    return json({error:`unsupported action: ${action}`},400);
  }catch(err){
    return json({error:errText(err)},500);
  }
});
