import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const RELAY_SECRET = Deno.env.get("RELAY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw ? JSON.parse(secretKeysRaw)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("THINKTANK_GITHUB_TOKEN") || Deno.env.get("GITHUB_TOKEN") || "";
const SUPABASE_ACCESS_TOKEN = Deno.env.get("THINKTANK_SUPABASE_ACCESS_TOKEN") || Deno.env.get("SUPABASE_ACCESS_TOKEN") || "";
const PROJECT_REF = "ddxhpsgwxqoejghmsatg";
const DEFAULT_REPO = "dcastle02-blip/thinktank";
const ALLOWED_ORIGIN = "https://dcastle02-blip.github.io";

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

type Provider = "github" | "supabase";
type Capability = "read" | "write" | "destructive";
type RequestedBy = "Dylan" | "GPT" | "Claude" | "System";

const TOOL_CAPABILITY: Record<string, { provider: Provider; capability: Capability }> = {
  github_get_file: { provider: "github", capability: "read" },
  github_list_contents: { provider: "github", capability: "read" },
  github_create_file: { provider: "github", capability: "write" },
  github_update_file: { provider: "github", capability: "write" },
  github_delete_file: { provider: "github", capability: "destructive" },
  supabase_query_readonly: { provider: "supabase", capability: "read" },
  supabase_query: { provider: "supabase", capability: "write" },
  supabase_list_functions: { provider: "supabase", capability: "read" },
  supabase_get_function: { provider: "supabase", capability: "read" },
  supabase_deploy_function: { provider: "supabase", capability: "write" },
  supabase_delete_function: { provider: "supabase", capability: "destructive" },
};

function safeRequestedBy(value: unknown): RequestedBy {
  return value === "GPT" || value === "Claude" || value === "System" ? value : "Dylan";
}

function encodePath(path: string) {
  return String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function redactArguments(args: Record<string, unknown>) {
  const copy: Record<string, unknown> = { ...args };
  for (const key of ["content", "source", "body"]) {
    if (typeof copy[key] === "string") {
      const value = copy[key] as string;
      copy[key] = { chars: value.length, preview: value.slice(0, 180) };
    }
  }
  return copy;
}

async function githubFetch(path: string, init: RequestInit = {}) {
  if (!GITHUB_TOKEN) throw new Error("GitHub is not connected yet.");
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${typeof data === "string" ? data.slice(0, 1000) : JSON.stringify(data).slice(0, 1000)}`);
  return data;
}

async function supabaseMgmt(path: string, init: RequestInit = {}) {
  if (!SUPABASE_ACCESS_TOKEN) throw new Error("Supabase Management API is not connected yet.");
  const res = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(`Supabase Management API ${res.status}: ${typeof data === "string" ? data.slice(0, 1000) : JSON.stringify(data).slice(0, 1000)}`);
  return data;
}

async function executeTool(toolName: string, args: Record<string, unknown>) {
  if (toolName.startsWith("github_")) {
    const repo = String(args.repo || DEFAULT_REPO);
    if (repo !== DEFAULT_REPO) throw new Error("GitHub scope is restricted to the Think Tank repository.");
    const [owner, name] = repo.split("/");
    const path = encodePath(String(args.path || ""));
    const branch = typeof args.branch === "string" && args.branch ? args.branch : undefined;

    if (toolName === "github_get_file") {
      return await githubFetch(`/repos/${owner}/${name}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`);
    }
    if (toolName === "github_list_contents") {
      const suffix = path ? `/${path}` : "";
      return await githubFetch(`/repos/${owner}/${name}/contents${suffix}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`);
    }
    if (toolName === "github_create_file" || toolName === "github_update_file") {
      const content = String(args.content || "");
      const message = String(args.message || (toolName === "github_create_file" ? "Create file from Think Tank" : "Update file from Think Tank"));
      const payload: Record<string, unknown> = { message, content: base64Utf8(content) };
      if (branch) payload.branch = branch;
      if (toolName === "github_update_file") {
        const sha = String(args.sha || "");
        if (!sha) throw new Error("github_update_file requires the current blob sha.");
        payload.sha = sha;
      }
      return await githubFetch(`/repos/${owner}/${name}/contents/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (toolName === "github_delete_file") {
      const sha = String(args.sha || "");
      if (!sha) throw new Error("github_delete_file requires the current blob sha.");
      const payload: Record<string, unknown> = { message: String(args.message || "Delete file from Think Tank"), sha };
      if (branch) payload.branch = branch;
      return await githubFetch(`/repos/${owner}/${name}/contents/${path}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  }

  if (toolName === "supabase_query_readonly" || toolName === "supabase_query") {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("SQL query is required.");
    if (query.length > 100_000) throw new Error("SQL query is too large.");
    const endpoint = toolName === "supabase_query_readonly"
      ? `/v1/projects/${PROJECT_REF}/database/query/read-only`
      : `/v1/projects/${PROJECT_REF}/database/query`;
    return await supabaseMgmt(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        parameters: Array.isArray(args.parameters) ? args.parameters : undefined,
        ...(toolName === "supabase_query" ? { read_only: false } : {}),
      }),
    });
  }

  if (toolName === "supabase_list_functions") {
    return await supabaseMgmt(`/v1/projects/${PROJECT_REF}/functions`);
  }
  if (toolName === "supabase_get_function") {
    const slug = encodeURIComponent(String(args.slug || ""));
    if (!slug) throw new Error("Function slug is required.");
    const [meta, body] = await Promise.all([
      supabaseMgmt(`/v1/projects/${PROJECT_REF}/functions/${slug}`),
      supabaseMgmt(`/v1/projects/${PROJECT_REF}/functions/${slug}/body`),
    ]);
    return { meta, body };
  }
  if (toolName === "supabase_deploy_function") {
    const slug = String(args.slug || "").trim();
    const source = String(args.source || "");
    if (!slug || !source) throw new Error("Function slug and source are required.");
    const form = new FormData();
    form.append("metadata", JSON.stringify({
      entrypoint_path: "index.ts",
      name: slug,
      verify_jwt: args.verifyJwt !== false,
    }));
    form.append("file", new Blob([source], { type: "application/typescript" }), "index.ts");
    return await supabaseMgmt(`/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
      method: "POST",
      body: form,
    });
  }
  if (toolName === "supabase_delete_function") {
    const slug = encodeURIComponent(String(args.slug || ""));
    if (!slug) throw new Error("Function slug is required.");
    return await supabaseMgmt(`/v1/projects/${PROJECT_REF}/functions/${slug}`, { method: "DELETE" });
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

async function getPermission(provider: Provider, capability: Capability) {
  const { data, error } = await supabase
    .from("thinktank_tool_permissions")
    .select("provider, capability, mode, scope")
    .eq("provider", provider)
    .eq("capability", capability)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No permission rule for ${provider}/${capability}`);
  return data;
}

async function runActivity(activity: any) {
  await supabase.from("thinktank_tool_activity").update({ status: "running" }).eq("id", activity.id);
  try {
    const result = await executeTool(activity.tool_name, activity.arguments || {});
    const summary = JSON.stringify(result).slice(0, 12_000);
    await supabase.from("thinktank_tool_activity").update({
      status: "succeeded",
      result_summary: summary,
      completed_at: new Date().toISOString(),
    }).eq("id", activity.id);
    return { activityId: activity.id, status: "succeeded", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("thinktank_tool_activity").update({
      status: "failed",
      error_text: message.slice(0, 12_000),
      completed_at: new Date().toISOString(),
    }).eq("id", activity.id);
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-relay-secret") !== RELAY_SECRET) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const action = String(body.action || "status");

    if (action === "status") {
      const [{ data: permissions, error: pErr }, { data: activity, error: aErr }] = await Promise.all([
        supabase.from("thinktank_tool_permissions").select("*").order("provider").order("capability"),
        supabase.from("thinktank_tool_activity").select("id,provider,tool_name,capability,requested_by,status,result_summary,error_text,created_at,completed_at").order("created_at", { ascending: false }).limit(40),
      ]);
      if (pErr) throw pErr;
      if (aErr) throw aErr;
      return json({
        providers: {
          github: { connected: Boolean(GITHUB_TOKEN), scope: DEFAULT_REPO },
          supabase: { connected: Boolean(SUPABASE_ACCESS_TOKEN), scope: PROJECT_REF },
        },
        permissions,
        activity,
        tools: Object.keys(TOOL_CAPABILITY),
      });
    }

    if (action === "set_permission") {
      const provider = body.provider as Provider;
      const capability = body.capability as Capability;
      const mode = String(body.mode || "");
      if (!["github", "supabase"].includes(provider)) return json({ error: "invalid provider" }, 400);
      if (!["read", "write", "destructive"].includes(capability)) return json({ error: "invalid capability" }, 400);
      if (!["auto", "approval", "disabled"].includes(mode)) return json({ error: "invalid mode" }, 400);
      const { data, error } = await supabase.from("thinktank_tool_permissions")
        .update({ mode, updated_at: new Date().toISOString() })
        .eq("provider", provider).eq("capability", capability)
        .select().single();
      if (error) throw error;
      return json({ permission: data });
    }

    if (action === "execute") {
      const toolName = String(body.toolName || "");
      const definition = TOOL_CAPABILITY[toolName];
      if (!definition) return json({ error: "unsupported tool" }, 400);
      const args = body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : {};
      const requestedBy = safeRequestedBy(body.requestedBy);
      const permission = await getPermission(definition.provider, definition.capability);
      if (permission.mode === "disabled") return json({ error: `${toolName} is disabled` }, 403);

      const status = permission.mode === "approval" ? "awaiting_approval" : "requested";
      const { data: activity, error } = await supabase.from("thinktank_tool_activity").insert({
        provider: definition.provider,
        tool_name: toolName,
        capability: definition.capability,
        requested_by: requestedBy,
        arguments: args,
        status,
        metadata: { argument_summary: redactArguments(args) },
      }).select().single();
      if (error) throw error;

      if (permission.mode === "approval") {
        return json({ activityId: activity.id, status: "awaiting_approval", approvalRequired: true });
      }
      return json(await runActivity(activity));
    }

    if (action === "approve") {
      const id = String(body.activityId || "");
      const { data: activity, error } = await supabase.from("thinktank_tool_activity").select("*").eq("id", id).single();
      if (error) throw error;
      if (activity.status !== "awaiting_approval") return json({ error: "activity is not awaiting approval" }, 409);
      await supabase.from("thinktank_tool_activity").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
      return json(await runActivity({ ...activity, status: "approved" }));
    }

    if (action === "deny") {
      const id = String(body.activityId || "");
      const { data, error } = await supabase.from("thinktank_tool_activity")
        .update({ status: "denied", completed_at: new Date().toISOString() })
        .eq("id", id).eq("status", "awaiting_approval").select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "activity is not awaiting approval" }, 409);
      return json({ activity: data });
    }

    return json({ error: `unsupported action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});