import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";
const CAPTION_MODEL = "gpt-5.6-luna";
const EVIDENCE_BUCKET = "thinktank-project-evidence";
const MAX_TEXT_CHARS = 1_500_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
function safeName(v:unknown){return String(v ?? "source").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,180)||"source";}
function array(v:unknown){return Array.isArray(v)?v:[];}
function chunkText(value:string,size=4200,overlap=300){
  const out:string[]=[]; let start=0;
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
  const raw=atob(match[2]); const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return {mime:match[1],bytes};
}
function outputText(data:any){
  const output=Array.isArray(data?.output)?data.output:[];
  return output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[])
    .filter((part:any)=>part?.type==="output_text"&&typeof part.text==="string")
    .map((part:any)=>part.text).join("").trim();
}
async function extractCaption(dataUrl:string){
  const prompt=`Extract the visible closed-caption text from this meeting screenshot as faithfully as possible.
Preserve speaker names and order when visible. Do not summarize, correct, or infer missing technical words.
Use [unclear] for unreadable text. Ignore unrelated UI unless it identifies the speaker.
Return plain text only.`;
  const res=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:CAPTION_MODEL,store:false,max_output_tokens:2500,input:[{role:"user",content:[
      {type:"input_text",text:prompt},
      {type:"input_image",image_url:dataUrl,detail:"high"}
    ]}]})
  });
  const raw=await res.text();
  if(!res.ok) throw new Error(`caption extraction failed: ${res.status} ${raw.slice(0,800)}`);
  let data:any={}; try{data=JSON.parse(raw)}catch{}
  const result=outputText(data);
  if(!result) throw new Error("caption extraction returned no text");
  return result;
}
async function nextSequence(projectId:string){
  const {data,error}=await supabase.from("thinktank_project_events")
    .select("sequence").eq("project_id",projectId).order("sequence",{ascending:false}).limit(1);
  if(error) throw error;
  return Number(data?.[0]?.sequence||0)+1;
}
async function addEvent(projectId:string,eventType:string,content:string,metadata:any={}){
  const allowed=new Set(["note","update","decision","milestone","blocker","meeting","idea","reference"]);
  if(!allowed.has(eventType)) eventType="note";
  const sequence=await nextSequence(projectId);
  const {data,error}=await supabase.from("thinktank_project_events").insert({
    project_id:projectId,sequence,event_type:eventType,content:text(content),metadata:metadata&&typeof metadata==="object"?metadata:{}
  }).select().single();
  if(error) throw error;
  await supabase.from("thinktank_projects").update({updated_at:new Date().toISOString()}).eq("id",projectId);
  return data;
}
async function storeSource(args:{projectId:string;sourceType:string;fileName:string;mimeType:string;bytes:Uint8Array;extractedText:string;metadata?:Record<string,unknown>}){
  const path=`${args.projectId}/${Date.now()}-${crypto.randomUUID()}-${safeName(args.fileName)}`;
  const {error:uploadError}=await supabase.storage.from(EVIDENCE_BUCKET).upload(path,args.bytes,{contentType:args.mimeType||"application/octet-stream",upsert:false});
  if(uploadError) throw uploadError;
  const {data:source,error}=await supabase.from("thinktank_project_sources").insert({
    project_id:args.projectId,source_type:args.sourceType,file_name:args.fileName,mime_type:args.mimeType,
    storage_path:path,extracted_text:args.extractedText,char_count:args.extractedText.length,status:"ready",
    metadata:args.metadata??{}
  }).select().single();
  if(error){await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);throw error;}
  const chunks=chunkText(args.extractedText);
  if(chunks.length){
    const {error:chunkError}=await supabase.from("thinktank_project_source_chunks")
      .insert(chunks.map((content,index)=>({source_id:source.id,chunk_index:index,content})));
    if(chunkError) throw chunkError;
  }
  await addEvent(args.projectId,"reference",`Added project source: ${args.fileName}`,{source_id:source.id,source_type:args.sourceType});
  return source;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST") return json({error:"POST only"},405);
  if(req.headers.get("x-relay-secret")!==RELAY_SECRET) return json({error:"unauthorized"},401);
  try{
    const body=await req.json();
    const action=String(body.action||"list");

    if(action==="list"){
      const {data,error}=await supabase.from("thinktank_projects").select("*").neq("status","archived").order("updated_at",{ascending:false}).limit(200);
      if(error) throw error;
      return json({projects:data||[]});
    }

    if(action==="create"){
      const name=text(body.name,300); if(!name) return json({error:"name is required"},400);
      const {data,error}=await supabase.from("thinktank_projects").insert({
        name,
        description:text(body.description,20000),
        category:text(body.category,120)||null,
        status:["planned","active","on_hold","completed"].includes(String(body.status))?String(body.status):"active",
        objective:text(body.objective,20000)||null,
        current_focus:text(body.currentFocus,20000)||null,
        next_action:text(body.nextAction,20000)||null,
        due_date:text(body.dueDate,20)||null,
        metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{}
      }).select().single();
      if(error) throw error;
      await addEvent(data.id,"update","Project created.",{system:true});
      return json({project:data});
    }

    if(action==="get"){
      const projectId=text(body.projectId,100); if(!projectId) return json({error:"projectId is required"},400);
      const {data:project,error}=await supabase.from("thinktank_projects").select("*").eq("id",projectId).single();
      if(error) throw error;
      const [{data:events,error:eErr},{data:tasks,error:tErr},{data:sources,error:sErr}]=await Promise.all([
        supabase.from("thinktank_project_events").select("*").eq("project_id",projectId).order("sequence",{ascending:true}),
        supabase.from("thinktank_project_tasks").select("*").eq("project_id",projectId).order("created_at",{ascending:true}),
        supabase.from("thinktank_project_sources").select("id,source_type,file_name,mime_type,char_count,status,metadata,created_at").eq("project_id",projectId).order("created_at",{ascending:false})
      ]);
      if(eErr) throw eErr; if(tErr) throw tErr; if(sErr) throw sErr;
      return json({project,events:events||[],tasks:tasks||[],sources:sources||[]});
    }

    if(action==="update"){
      const projectId=text(body.projectId,100); if(!projectId) return json({error:"projectId is required"},400);
      const patch:any={updated_at:new Date().toISOString()};
      if(body.name!==undefined) patch.name=text(body.name,300);
      if(body.description!==undefined) patch.description=text(body.description,20000);
      if(body.category!==undefined) patch.category=text(body.category,120)||null;
      if(body.objective!==undefined) patch.objective=text(body.objective,20000)||null;
      if(body.currentFocus!==undefined) patch.current_focus=text(body.currentFocus,20000)||null;
      if(body.nextAction!==undefined) patch.next_action=text(body.nextAction,20000)||null;
      if(body.dueDate!==undefined) patch.due_date=text(body.dueDate,20)||null;
      if(body.status!==undefined){
        const status=String(body.status);
        if(!["planned","active","on_hold","completed","archived"].includes(status)) return json({error:"invalid status"},400);
        patch.status=status; patch.completed_at=status==="completed"?new Date().toISOString():null;
      }
      const {data,error}=await supabase.from("thinktank_projects").update(patch).eq("id",projectId).select().single();
      if(error) throw error;
      return json({project:data});
    }

    if(action==="add_event"){
      const projectId=text(body.projectId,100),content=text(body.content,50000);
      if(!projectId||!content) return json({error:"projectId and content are required"},400);
      return json({event:await addEvent(projectId,String(body.eventType||"note"),content,body.metadata)});
    }

    if(action==="add_task"){
      const projectId=text(body.projectId,100),title=text(body.title,1000);
      if(!projectId||!title) return json({error:"projectId and title are required"},400);
      const priority=["low","normal","high","urgent"].includes(String(body.priority))?String(body.priority):"normal";
      const {data,error}=await supabase.from("thinktank_project_tasks").insert({
        project_id:projectId,title,status:"todo",priority,due_date:text(body.dueDate,20)||null,notes:text(body.notes,10000)||null
      }).select().single();
      if(error) throw error;
      await addEvent(projectId,"update",`Task added: ${title}`,{task_id:data.id});
      return json({task:data});
    }

    if(action==="update_task"){
      const taskId=text(body.taskId,100); if(!taskId) return json({error:"taskId is required"},400);
      const patch:any={updated_at:new Date().toISOString()};
      if(body.title!==undefined) patch.title=text(body.title,1000);
      if(body.notes!==undefined) patch.notes=text(body.notes,10000)||null;
      if(body.dueDate!==undefined) patch.due_date=text(body.dueDate,20)||null;
      if(body.priority!==undefined){
        const p=String(body.priority); if(!["low","normal","high","urgent"].includes(p)) return json({error:"invalid priority"},400); patch.priority=p;
      }
      if(body.status!==undefined){
        const s=String(body.status); if(!["todo","doing","blocked","done","cancelled"].includes(s)) return json({error:"invalid task status"},400);
        patch.status=s; patch.completed_at=s==="done"?new Date().toISOString():null;
      }
      const {data,error}=await supabase.from("thinktank_project_tasks").update(patch).eq("id",taskId).select().single();
      if(error) throw error;
      return json({task:data});
    }

    if(action==="ingest_text_source"){
      const projectId=text(body.projectId,100),fileName=text(body.fileName,300)||"transcript.txt";
      const rawText=String(body.text??"");
      if(!projectId) return json({error:"projectId is required"},400);
      if(!rawText.trim()) return json({error:"source text is empty"},400);
      if(rawText.length>MAX_TEXT_CHARS) return json({error:`source exceeds ${MAX_TEXT_CHARS.toLocaleString()} characters`},413);
      const sourceType=["zoom_transcript","text_transcript","document","other"].includes(String(body.sourceType))?String(body.sourceType):"text_transcript";
      const mimeType=text(body.mimeType,120)||"text/plain";
      const source=await storeSource({projectId,sourceType,fileName,mimeType,bytes:new TextEncoder().encode(rawText),extractedText:rawText,metadata:{ingestion:"direct_text"}});
      return json({source});
    }

    if(action==="ingest_caption_image"){
      const projectId=text(body.projectId,100),fileName=text(body.fileName,300)||"caption.jpg",dataUrl=String(body.dataUrl??"");
      if(!projectId) return json({error:"projectId is required"},400);
      const {mime,bytes}=dataUrlToBytes(dataUrl);
      if(!["image/png","image/jpeg","image/webp"].includes(mime)) return json({error:"unsupported image type"},400);
      if(bytes.byteLength>MAX_IMAGE_BYTES) return json({error:"image exceeds 8 MB limit"},413);
      const extracted=await extractCaption(dataUrl);
      const source=await storeSource({projectId,sourceType:"caption_screenshot",fileName,mimeType:mime,bytes,extractedText:extracted,metadata:{ingestion:"vision_caption_extraction",model:CAPTION_MODEL}});
      return json({source,extractedText:extracted});
    }

    return json({error:"unsupported action"},400);
  }catch(err){
    return json({error:err instanceof Error?err.message:String(err)},500);
  }
});
