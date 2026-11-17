const DEFAULT_BASE = "https://opencode.ai/inference/go";

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "*";
  if (origin === new URL(request.url).origin) return origin;
  const configured = (env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes("*")) return origin || "*";
  return configured.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  const headers = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-opencode-session",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return headers;
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

async function proxyChat(request, env, origin) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, origin);
  }

  const apiKey = env.OPENCODE_API_KEY;
  if (!apiKey) {
    return jsonError("Missing OPENCODE_API_KEY", 500, origin);
  }

  const base = (env.OPENCODE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const endpoint = `${base}/openai/v1/chat/completions`;
  const session = request.headers.get("x-opencode-session") || `ses_${crypto.randomUUID()}`;
  const body = await request.text();

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "dabing-web/1.0",
        "x-opencode-session": session,
      },
      body,
    });
  } catch {
    return jsonError("OpenCode upstream is unreachable", 502, origin);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isChat = /^\/api\/chat(?:\/completions)?\/?$/.test(url.pathname);
    const origin = allowedOrigin(request, env);

    if (url.pathname === "/") {
      return Response.redirect(new URL("/dabing-lianmai.html", url), 302);
    }

    if (isChat) {
      if (!origin) return jsonError("Origin not allowed", 403, null);
      return proxyChat(request, env, origin);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
