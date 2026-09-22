import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";
const GPT_MODEL = "gpt-5.2";
const EMBEDDING_MODEL = "text-embedding-3-small";

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

function errText(err:unknown){
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function normText(v:unknown){
  return String(v ?? "").trim().replace(/\s+/g," ");
}

function slug(v:unknown){
  return normText(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,180);
}

function authorityPriority(a:string){
  const map:Record<string,number> = {
    confirmed_operational:110,
    official_sop:100,
    system_document:90,
    process_map:85,
    training:70,
    vendor_reference:65,
    general_reference:60,
    observed:50,
    inferred:20,
  };
  return map[a] ?? 0;
}

async function embedding(text:string){
  const res = await fetch("https://api.openai.com/v1/embeddings",{
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:EMBEDDING_MODEL,input:text.slice(0,16000),encoding_format:"float"}),
  });
  const raw=await res.text();
  let data:any={};
  try{data=raw?JSON.parse(raw):{}}catch{}
  if(!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${data?.error?.message || raw.slice(0,500)}`);
  const vec=data?.data?.[0]?.embedding;
  if(!Array.isArray(vec)||vec.length!==1536) throw new Error("Unexpected embedding shape");
  return vec as number[];
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

async function ensureNode(claim:any){
  const key=slug(claim.subject_key || claim.subject_name || claim.claim_key || "unknown");
  const canonicalKey=`node:${key || crypto.randomUUID()}`;
  const name=normText(claim.subject_name || claim.subject_key || "Unknown process element").slice(0,300);
  const allowed=new Set(["process","system","physical_action","decision","queue","resource","metric","exception"]);
  const nodeType=allowed.has(String(claim.node_type)) ? String(claim.node_type) : "process";
  const scope=claim.scope && typeof claim.scope==="object" ? claim.scope : {};
  const {data:existing,error:e1}=await supabase.from("thinktank_process_nodes").select("*").eq("canonical_key",canonicalKey).maybeSingle();
  if(e1) throw e1;
  if(existing) return existing;
  const {data,error}=await supabase.from("thinktank_process_nodes").insert({
    canonical_key:canonicalKey,node_type:nodeType,name,scope
  }).select().single();
  if(error) throw error;
  return data;
}

async function addEvidence(claimId:string, sourceType:string, documentId:string|null, sourceRef:string|null, excerpt:string, metadata:any={}){
  const {error}=await supabase.from("thinktank_process_evidence").insert({
    claim_id:claimId,
    source_type:sourceType,
    document_id:documentId,
    source_ref:sourceRef,
    excerpt:excerpt.slice(0,5000),
    metadata,
  });
  if(error) throw error;
}

function sameStatement(a:string,b:string){
  return normText(a).toLowerCase()===normText(b).toLowerCase();
}

async function insertClaim(claim:any, authority:string, status:string, sourceDate:string|null, supersedes:string|null=null){
  const node=await ensureNode(claim);
  const statement=normText(claim.statement).slice(0,12000);
  const vec=await embedding(statement);
  const {data,error}=await supabase.from("thinktank_process_claims").insert({
    claim_key:slug(claim.claim_key || `${claim.subject_key}-${claim.claim_type}`),
    subject_node_id:node.id,
    claim_type:String(claim.claim_type || "rule"),
    statement,
    structured:claim.structured && typeof claim.structured==="object" ? claim.structured : {},
    scope:claim.scope && typeof claim.scope==="object" ? claim.scope : {},
    authority,
    confidence:Math.max(0,Math.min(1,Number(claim.confidence ?? 0.8))),
    source_effective_date:sourceDate || null,
    status,
    supersedes_claim_id:supersedes,
    embedding:vec,
  }).select().single();
  if(error) throw error;
  return data;
}

async function reconcileClaim(opts:{
  claim:any;
  authority:string;
  sourceType:"document"|"conversation"|"manual"|"agent"|"observation";
  documentId?:string|null;
  sourceRef?:string|null;
  sourceDate?:string|null;
  createdBy?:"Dylan"|"GPT"|"Claude"|"System";
}){
  const {claim,authority,sourceType}=opts;
  const claimKey=slug(claim.claim_key || `${claim.subject_key}-${claim.claim_type}`);
  claim.claim_key=claimKey;
  const {data:existing,error}=await supabase.from("thinktank_process_claims")
    .select("*").eq("claim_key",claimKey).eq("status","active").maybeSingle();
  if(error) throw error;

  const excerpt=normText(claim.evidence || claim.evidence_quote || claim.statement);
  const sourceRef=opts.sourceRef || null;
  const sourceDate=opts.sourceDate || null;

  if(!existing){
    const created=await insertClaim(claim,authority,"active",sourceDate,null);
    await addEvidence(created.id,sourceType,opts.documentId || null,sourceRef,excerpt);
    return {action:"created",claim:created};
  }

  if(sameStatement(existing.statement,claim.statement)){
    await addEvidence(existing.id,sourceType,opts.documentId || null,sourceRef,excerpt);
    const newConfidence=Math.min(1,Math.max(Number(existing.confidence || 0),Number(claim.confidence ?? 0.8)));
    await supabase.from("thinktank_process_claims").update({confidence:newConfidence,updated_at:new Date().toISOString()}).eq("id",existing.id);
    return {action:"reinforced",claim:{...existing,confidence:newConfidence}};
  }

  let canSupersede=false;
  const incomingPriority=authorityPriority(authority);
  const existingPriority=authorityPriority(String(existing.authority));
  const incomingDate=sourceDate ? new Date(sourceDate).getTime() : NaN;
  const existingDate=existing.source_effective_date ? new Date(existing.source_effective_date).getTime() : NaN;

  if(authority==="confirmed_operational"){
    canSupersede=true;
  } else if(existing.authority==="confirmed_operational"){
    canSupersede=false;
  } else if(incomingPriority>existingPriority){
    canSupersede=true;
  } else if(incomingPriority===existingPriority && Number.isFinite(incomingDate) && (!Number.isFinite(existingDate) || incomingDate>=existingDate)){
    canSupersede=true;
  }

  if(canSupersede){
    const {error:uErr}=await supabase.from("thinktank_process_claims")
      .update({status:"superseded",updated_at:new Date().toISOString()})
      .eq("id",existing.id);
    if(uErr) throw uErr;
    const created=await insertClaim(claim,authority,"active",sourceDate,existing.id);
    await addEvidence(created.id,sourceType,opts.documentId || null,sourceRef,excerpt);
    await supabase.from("thinktank_process_corrections").insert({
      target_claim_id:existing.id,
      resulting_claim_id:created.id,
      correction_text:created.statement,
      source_type:sourceType,
      status:"applied",
      reason:`${authority} superseded ${existing.authority}`,
      scope:claim.scope || {},
      created_by:opts.createdBy || "System",
      resolved_at:new Date().toISOString(),
    });
    return {action:"superseded",previous:existing,claim:created};
  }

  const proposed=await insertClaim(claim,authority,"proposed",sourceDate,null);
  await addEvidence(proposed.id,sourceType,opts.documentId || null,sourceRef,excerpt);
  const {data:correction,error:cErr}=await supabase.from("thinktank_process_corrections").insert({
    target_claim_id:existing.id,
    resulting_claim_id:proposed.id,
    correction_text:proposed.statement,
    source_type:sourceType,
    status:"conflict",
    reason:`Incoming ${authority} conflicts with active ${existing.authority}; automatic overwrite blocked.`,
    scope:claim.scope || {},
    created_by:opts.createdBy || "System",
  }).select().single();
  if(cErr) throw cErr;
  return {action:"conflict",existing,proposed,correction};
}

const EXTRACT_SYSTEM = `You convert operational source material into structured Process Memory.
Use only the supplied source. Do not invent missing systems, steps, roles, rules, exceptions, dates, or facility behavior.
Preserve the source's terminology.
Return JSON with:
{
 "document":{
   "document_type":"sop|system_doc|process_map|training|vendor_doc|general_reference",
   "authority":"official_sop|system_document|process_map|training|vendor_reference|general_reference",
   "summary":"...",
   "scope":{"facility":"...","department":"...","system":"...","channel":"..."},
   "effective_date":"YYYY-MM-DD or null",
   "version_label":"string or null"
 },
 "claims":[
   {
     "claim_key":"stable concise key including scope when scope changes meaning",
     "subject_key":"stable process/system key",
     "subject_name":"human readable name",
     "node_type":"process|system|physical_action|decision|queue|resource|metric|exception",
     "claim_type":"sequence|system_action|physical_action|rule|exception|input|output|dependency|capacity|metric|customization",
     "statement":"one atomic factual statement",
     "structured":{},
     "scope":{},
     "confidence":0.0,
     "evidence":"short source-supported excerpt or precise paraphrase"
   }
 ]
}
Split compound facts into atomic claims. Use the same claim_key for statements that describe the same operational fact across versions so later reconciliation can compare them. Include facility in the key when a facility-specific customization changes the fact.`;

async function analyzeDocument(body:any){
  const documentId=String(body.documentId || "");
  if(!documentId) throw new Error("documentId is required");
  const {data:doc,error:dErr}=await supabase.from("thinktank_documents").select("*").eq("id",documentId).single();
  if(dErr) throw dErr;
  if(doc.status!=="ready") throw new Error("document must be ready before Process Memory analysis");

  const {data:chunks,error:cErr}=await supabase.from("thinktank_document_chunks")
    .select("chunk_index,content").eq("document_id",documentId).order("chunk_index",{ascending:true});
  if(cErr) throw cErr;
  const sourceText=(chunks ?? []).map((x:any)=>`[SECTION ${Number(x.chunk_index)+1}]\n${x.content}`).join("\n\n").slice(0,100000);

  await supabase.from("thinktank_knowledge_sources").upsert({
    document_id:documentId,
    document_type:body.documentType || "general_reference",
    authority:body.authority || "general_reference",
    scope:body.scope && typeof body.scope==="object" ? body.scope : {},
    effective_date:body.effectiveDate || null,
    version_label:body.versionLabel || null,
    extraction_status:"processing",
    updated_at:new Date().toISOString(),
  },{onConflict:"document_id"});

  try{
    const extracted=await gptJson(EXTRACT_SYSTEM,`SOURCE FILE: ${doc.name}\n\n${sourceText}`,6500);
    const meta=extracted?.document || {};
    const documentType=body.documentType || meta.document_type || "general_reference";
    const authority=body.authority || meta.authority || (documentType==="sop" ? "official_sop" : "general_reference");
    const scope=body.scope && Object.keys(body.scope).length ? body.scope : (meta.scope || {});
    const sourceDate=body.effectiveDate || meta.effective_date || null;
    const versionLabel=body.versionLabel || meta.version_label || null;

    const results:any[]=[];
    for(const raw of Array.isArray(extracted?.claims) ? extracted.claims.slice(0,120) : []){
      if(!normText(raw?.statement)) continue;
      raw.scope={...(scope || {}),...(raw.scope || {})};
      results.push(await reconcileClaim({
        claim:raw,
        authority,
        sourceType:"document",
        documentId,
        sourceRef:doc.name,
        sourceDate,
        createdBy:"System",
      }));
    }

    const stats=results.reduce((a:any,r:any)=>{a[r.action]=(a[r.action]||0)+1;return a;},{});
    const {error:uErr}=await supabase.from("thinktank_knowledge_sources").upsert({
      document_id:documentId,
      document_type:documentType,
      authority,
      scope,
      effective_date:sourceDate,
      version_label:versionLabel,
      status:"current",
      extraction_status:"ready",
      summary:normText(meta.summary).slice(0,6000),
      metadata:{claim_count:results.length,reconciliation:stats},
      analyzed_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    },{onConflict:"document_id"});
    if(uErr) throw uErr;
    return {documentId,name:doc.name,documentType,authority,scope,claimCount:results.length,reconciliation:stats};
  }catch(err){
    await supabase.from("thinktank_knowledge_sources").update({
      extraction_status:"error",
      metadata:{error:errText(err)},
      updated_at:new Date().toISOString(),
    }).eq("document_id",documentId);
    throw err;
  }
}

const CORRECTION_SYSTEM = `Convert Dylan's explicit real-world operational correction into Process Memory claims.
Do not add facts Dylan did not state.
Return JSON {"claims":[...]} using the same claim schema as Process Memory:
claim_key, subject_key, subject_name, node_type, claim_type, statement, structured, scope, confidence, evidence.
Use confirmed operational facts only. If the correction is ambiguous, keep the statement narrow rather than guessing.
A claim_key must identify the exact operational fact and include facility/system scope when that changes meaning.`;

async function addCorrection(body:any){
  const text=normText(body.text);
  if(!text) throw new Error("text is required");
  const suppliedScope=body.scope && typeof body.scope==="object" ? body.scope : {};
  const extracted=await gptJson(CORRECTION_SYSTEM,`SCOPE: ${JSON.stringify(suppliedScope)}\n\nDYLAN CORRECTION:\n${text}`,3000);
  const results:any[]=[];
  for(const raw of Array.isArray(extracted?.claims) ? extracted.claims.slice(0,20) : []){
    if(!normText(raw?.statement)) continue;
    raw.scope={...suppliedScope,...(raw.scope || {})};
    raw.confidence=Math.max(Number(raw.confidence || 0),0.9);
    results.push(await reconcileClaim({
      claim:raw,
      authority:"confirmed_operational",
      sourceType:body.sourceType || "conversation",
      documentId:null,
      sourceRef:body.sourceRef || "Dylan correction",
      sourceDate:null,
      createdBy:"Dylan",
    }));
  }
  return {count:results.length,results};
}

async function addSnapshot(body:any){
  const name=normText(body.name || "Current state snapshot");
  const capturedAt=body.capturedAt || new Date().toISOString();
  const sourceType=String(body.sourceType || "manual");
  const scope=body.scope && typeof body.scope==="object" ? body.scope : {};
  const rawPayload=body.rawPayload && typeof body.rawPayload==="object" ? body.rawPayload : {};
  const {data:snapshot,error}=await supabase.from("thinktank_state_snapshots").insert({
    name,captured_at:capturedAt,source_type:sourceType,scope,raw_payload:rawPayload,notes:body.notes || null
  }).select().single();
  if(error) throw error;

  const metrics=Array.isArray(body.metrics) ? body.metrics.slice(0,500) : [];
  if(metrics.length){
    const rows=metrics.map((m:any)=>({
      snapshot_id:snapshot.id,
      metric_key:normText(m.metricKey || m.key || "unknown").slice(0,240),
      value_numeric:Number.isFinite(Number(m.value)) ? Number(m.value) : null,
      value_text:Number.isFinite(Number(m.value)) ? null : normText(m.value).slice(0,1000),
      unit:m.unit ? normText(m.unit).slice(0,80) : null,
      dimensions:m.dimensions && typeof m.dimensions==="object" ? m.dimensions : {},
    }));
    const {error:mErr}=await supabase.from("thinktank_state_metrics").insert(rows);
    if(mErr) throw mErr;
  }
  return {snapshot,metricCount:metrics.length};
}

async function overview(){
  const [docsRes,sourcesRes,claimsRes,correctionsRes,snapshotsRes]=await Promise.all([
    supabase.from("thinktank_documents").select("id,name,status,chunk_count,created_at").eq("status","ready").order("created_at",{ascending:false}),
    supabase.from("thinktank_knowledge_sources").select("*").order("updated_at",{ascending:false}),
    supabase.from("thinktank_process_claims").select("id,claim_key,claim_type,statement,scope,authority,confidence,status,source_effective_date,updated_at").order("updated_at",{ascending:false}).limit(250),
    supabase.from("thinktank_process_corrections").select("*").order("created_at",{ascending:false}).limit(100),
    supabase.from("thinktank_state_snapshots").select("id,name,captured_at,source_type,scope,notes,created_at").order("captured_at",{ascending:false}).limit(50),
  ]);
  for(const r of [docsRes,sourcesRes,claimsRes,correctionsRes,snapshotsRes]) if(r.error) throw r.error;
  const sourceMap=new Map((sourcesRes.data ?? []).map((s:any)=>[s.document_id,s]));
  const documents=(docsRes.data ?? []).map((d:any)=>({...d,process_memory:sourceMap.get(d.id) || null}));
  const claims=claimsRes.data ?? [];
  const corrections=correctionsRes.data ?? [];
  return {
    documents,
    claims,
    corrections,
    snapshots:snapshotsRes.data ?? [],
    counts:{
      documents:documents.length,
      analyzedDocuments:documents.filter((d:any)=>d.process_memory?.extraction_status==="ready").length,
      activeClaims:claims.filter((c:any)=>c.status==="active").length,
      conflicts:corrections.filter((c:any)=>c.status==="conflict").length,
      snapshots:(snapshotsRes.data ?? []).length,
    }
  };
}

async function searchMemory(body:any){
  const query=normText(body.query);
  if(!query) throw new Error("query is required");
  const vec=await embedding(query);
  const {data,error}=await supabase.rpc("match_thinktank_process_claims",{query_embedding:vec,match_count:Math.min(30,Math.max(1,Number(body.limit || 12)))});
  if(error) throw error;
  return {claims:data ?? []};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS_HEADERS});
  if(req.method!=="POST") return json({error:"POST only"},405);
  if(req.headers.get("x-relay-secret")!==RELAY_SECRET) return json({error:"unauthorized"},401);

  try{
    const body=await req.json();
    const action=String(body.action || "overview");
    if(action==="overview") return json(await overview());
    if(action==="analyze_document") return json(await analyzeDocument(body));
    if(action==="add_correction") return json(await addCorrection(body));
    if(action==="add_snapshot") return json(await addSnapshot(body));
    if(action==="search") return json(await searchMemory(body));
    return json({error:`unsupported action: ${action}`},400);
  }catch(err){
    return json({error:errText(err)},500);
  }
});
