import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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
