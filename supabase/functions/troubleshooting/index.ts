import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CAPTION_MODEL = "gpt-5.6-luna";
const EVIDENCE_BUCKET = "thinktank-troubleshooting-evidence";
const MAX_TEXT_CHARS = 1_500_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-relay-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
}
function text(v:unknown,max=20000){return String(v ?? "").trim().slice(0,max);}
function arr(v:unknown){return Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[];}
function safeFileName(v:unknown){
  return String(v ?? "evidence").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,180) || "evidence";
}
function chunkText(value:string,size=4200,overlap=300){
  const out:string[]=[];
  let start=0;
  while(start<value.length){
    let end=Math.min(value.length,start+size);
    if(end<value.length){
      const nl=value.lastIndexOf("\n",end);
      if(nl>start+Math.floor(size*.65)) end=nl+1;
    }
    const part=value.slice(start,end).trim();
    if(part) out.push(part);
    if(end>=value.length) break;
    start=Math.max(start+1,end-overlap);
  }
  return out;
}
function dataUrlToBytes(dataUrl:string){
  const match=dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if(!match) throw new Error("invalid image data");
  const mime=match[1];
  const raw=atob(match[2]);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return {mime,bytes};
}
function responseOutputText(data:any){
  const output=Array.isArray(data?.output)?data.output:[];
  return output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[])
    .filter((part:any)=>part?.type==="output_text" && typeof part.text==="string")
    .map((part:any)=>part.text).join("").trim();
}
async function extractCaptionText(dataUrl:string){
  const prompt=`This image is evidence from a live troubleshooting meeting. Extract the visible closed-caption text as faithfully as possible.
Rules:
- Preserve speaker names when visible.
- Preserve message order.
- Do not summarize, explain, correct, or infer missing technical words.
- If text is unreadable, write [unclear] rather than guessing.
- Ignore unrelated UI text unless it is part of the captions or directly labels the speaker.
Return plain text only.`;
  const res=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:CAPTION_MODEL,
      store:false,
      max_output_tokens:2500,
      input:[{role:"user",content:[
        {type:"input_text",text:prompt},
        {type:"input_image",image_url:dataUrl,detail:"high"}
      ]}]
    })
  });
  const raw=await res.text();
  if(!res.ok) throw new Error(`caption extraction failed: ${res.status} ${raw.slice(0,800)}`);
  let data:any={};
  try{data=JSON.parse(raw)}catch{}
  const extracted=responseOutputText(data);
  if(!extracted) throw new Error("caption extraction returned no visible text");
  return extracted;
}
async function storeSource(args:{sessionId:string;sourceType:string;fileName:string;mimeType:string;bytes:Uint8Array;extractedText:string;metadata?:Record<string,unknown>}){
  const path=`${args.sessionId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(args.fileName)}`;
  const {error:uploadError}=await supabase.storage.from(EVIDENCE_BUCKET).upload(path,args.bytes,{
    contentType:args.mimeType || "application/octet-stream",
    upsert:false
  });
  if(uploadError) throw uploadError;
  const {data:source,error}=await supabase.from("thinktank_troubleshooting_sources").insert({
    session_id:args.sessionId,
    source_type:args.sourceType,
    file_name:args.fileName,
    mime_type:args.mimeType,
    storage_path:path,
    extracted_text:args.extractedText,
    char_count:args.extractedText.length,
    status:"ready",
    metadata:args.metadata ?? {}
  }).select().single();
  if(error){
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    throw error;
  }
  const chunks=chunkText(args.extractedText);
  if(chunks.length){
    const {error:chunkError}=await supabase.from("thinktank_troubleshooting_source_chunks").insert(
      chunks.map((content,index)=>({source_id:source.id,chunk_index:index,content}))
    );
    if(chunkError) throw chunkError;
  }
  return source;
}
async function appendEvent(sessionId:string,eventType:string,actor:string,content:string,evidence:any={}){
  const allowedTypes=new Set(["observation","question","analysis","hypothesis","test","result","action","evidence","decision","resolution","note"]);
  const allowedActors=new Set(["Dylan","GPT","Claude","System","Ops","Vendor"]);
  if(!allowedTypes.has(eventType)) throw new Error("invalid event type");
  if(!allowedActors.has(actor)) actor="Dylan";
  const {data:last,error:lErr}=await supabase.from("thinktank_troubleshooting_events")
    .select("sequence").eq("session_id",sessionId).order("sequence",{ascending:false}).limit(1);
  if(lErr) throw lErr;
  const sequence=Number(last?.[0]?.sequence || 0)+1;
  const {data,error}=await supabase.from("thinktank_troubleshooting_events").insert({
    session_id:sessionId,sequence,event_type:eventType,actor,content:text(content),evidence:evidence&&typeof evidence==="object"?evidence:{}
  }).select().single();
  if(error) throw error;
  await supabase.from("thinktank_troubleshooting_sessions").update({updated_at:new Date().toISOString()}).eq("id",sessionId);
  return data;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST") return json({error:"POST only"},405);
  if(req.headers.get("x-relay-secret")!==RELAY_SECRET) return json({error:"unauthorized"},401);
  try{
    const body=await req.json();
    const action=String(body.action || "");
    if(action==="ingest_text_source"){
      const sessionId=text(body.sessionId,100);
      const fileName=text(body.fileName,300) || "transcript.txt";
      const mimeType=text(body.mimeType,120) || "text/plain";
      const rawText=String(body.text ?? "");
      const sourceType=["zoom_transcript","text_transcript","other"].includes(String(body.sourceType))?String(body.sourceType):"text_transcript";
      if(!sessionId) return json({error:"sessionId is required"},400);
      if(!rawText.trim()) return json({error:"transcript text is empty"},400);
      if(rawText.length>MAX_TEXT_CHARS) return json({error:`transcript exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters`},413);
      const bytes=new TextEncoder().encode(rawText);
      const source=await storeSource({sessionId,sourceType,fileName,mimeType,bytes,extractedText:rawText,metadata:{ingestion:"direct_text"}});
      const preview=rawText.trim().slice(0,6000);
      const event=await appendEvent(sessionId,"evidence","Dylan",
        `Imported troubleshooting transcript: ${fileName}\n\n${preview}${rawText.trim().length>preview.length?"\n\n[Transcript continues in attached incident source.]":""}`,
        {source_id:source.id,source_type:sourceType,file_name:fileName,char_count:rawText.length}
      );
      return json({source,event});
    }
    if(action==="ingest_caption_image"){
      const sessionId=text(body.sessionId,100);
      const fileName=text(body.fileName,300) || "caption-screenshot.jpg";
      const dataUrl=String(body.dataUrl ?? "");
      if(!sessionId) return json({error:"sessionId is required"},400);
      const {mime,bytes}=dataUrlToBytes(dataUrl);
      if(!["image/png","image/jpeg","image/webp"].includes(mime)) return json({error:"unsupported image type"},400);
      if(bytes.byteLength>MAX_IMAGE_BYTES) return json({error:"image exceeds 8 MB limit"},413);
      const extracted=await extractCaptionText(dataUrl);
      const source=await storeSource({
        sessionId,sourceType:"caption_screenshot",fileName,mimeType:mime,bytes,extractedText:extracted,
        metadata:{ingestion:"vision_caption_extraction",model:CAPTION_MODEL}
      });
      const event=await appendEvent(sessionId,"evidence","Dylan",
        `Imported closed-caption screenshot: ${fileName}\n\nExtracted caption text:\n${extracted.slice(0,9000)}`,
        {source_id:source.id,source_type:"caption_screenshot",file_name:fileName,extraction_model:CAPTION_MODEL}
      );
      return json({source,event,extractedText:extracted});
    }
    if(action==="list_sources"){
      const sessionId=text(body.sessionId,100);
      if(!sessionId) return json({error:"sessionId is required"},400);
      const {data,error}=await supabase.from("thinktank_troubleshooting_sources")
        .select("id,source_type,file_name,mime_type,char_count,status,metadata,created_at")
        .eq("session_id",sessionId).order("created_at",{ascending:false}).limit(100);
      if(error) throw error;
      return json({sources:data||[]});
    }
    if(action==="create"){
      const title=text(body.title,300);
      const symptom=text(body.symptom,12000);
      if(!title||!symptom) return json({error:"title and symptom are required"},400);
      const {data:session,error}=await supabase.from("thinktank_troubleshooting_sessions").insert({
        title,symptom,facility_key:text(body.facilityKey,100)||null,process_area:text(body.processArea,200)||null,
        systems:arr(body.systems),metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{}
      }).select().single();
      if(error) throw error;
      await appendEvent(session.id,"observation","Dylan",symptom,{kind:"initial_symptom"});
      return json({session});
    }
    if(action==="append"){
      const sessionId=text(body.sessionId,100);
      if(!sessionId) return json({error:"sessionId is required"},400);
      const event=await appendEvent(sessionId,String(body.eventType||"note"),String(body.actor||"Dylan"),body.content,body.evidence);
      if(body.currentHypothesis!==undefined){
        const {error}=await supabase.from("thinktank_troubleshooting_sessions").update({
          current_hypothesis:text(body.currentHypothesis,12000)||null,updated_at:new Date().toISOString()
        }).eq("id",sessionId);
        if(error) throw error;
      }
      return json({event});
    }
    if(action==="resolve"){
      const sessionId=text(body.sessionId,100);
      if(!sessionId) return json({error:"sessionId is required"},400);
      const rootCause=text(body.rootCause,20000);
      const resolution=text(body.resolution,20000);
      const summary=text(body.resolutionSummary,30000);
      if(!resolution) return json({error:"resolution is required"},400);
      const now=new Date().toISOString();
      const {data:session,error}=await supabase.from("thinktank_troubleshooting_sessions").update({
        status:"resolved",root_cause:rootCause||null,resolution,resolution_summary:summary||null,resolved_at:now,updated_at:now
      }).eq("id",sessionId).select().single();
      if(error) throw error;
      await appendEvent(sessionId,"resolution","Dylan",resolution,{root_cause:rootCause||null,summary:summary||null});
      return json({session});
    }
    if(action==="status"){
      const sessionId=text(body.sessionId,100);
      const status=String(body.status||"");
      if(!["open","monitoring","resolved","closed"].includes(status)) return json({error:"invalid status"},400);
      const {data:session,error}=await supabase.from("thinktank_troubleshooting_sessions").update({
        status,updated_at:new Date().toISOString()
      }).eq("id",sessionId).select().single();
      if(error) throw error;
      return json({session});
    }
    if(action==="get"){
      const sessionId=text(body.sessionId,100);
      const {data:session,error}=await supabase.from("thinktank_troubleshooting_sessions").select("*").eq("id",sessionId).single();
      if(error) throw error;
      const {data:events,error:eErr}=await supabase.from("thinktank_troubleshooting_events").select("*").eq("session_id",sessionId).order("sequence",{ascending:true});
      if(eErr) throw eErr;
      return json({session,events:events||[]});
    }
    if(action==="list"){
      const {data,error}=await supabase.from("thinktank_troubleshooting_sessions").select("*").order("started_at",{ascending:false}).limit(50);
      if(error) throw error;
      return json({sessions:data||[]});
    }
    return json({error:"unsupported action"},400);
  }catch(err){
    return json({error:err instanceof Error?err.message:String(err)},500);
  }
});
