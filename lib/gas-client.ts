const MAX_RESPONSE_BYTES = 2_000_000;

function backendConfig() {
  return {
    endpoint: process.env.OWOR_GAS_ENDPOINT?.trim() ?? "",
    token: process.env.OWOR_GAS_TOKEN?.trim() ?? "",
  };
}

export function isBackendConfigured() {
  const { endpoint, token } = backendConfig();
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname === "script.google.com" && token.length >= 24;
  } catch {
    return false;
  }
}

async function parseResponse(response: Response) {
  const raw = await response.text();
  if (!response.ok || raw.length > MAX_RESPONSE_BYTES) throw new Error(`GAS_HTTP_${response.status}`);
  const payload = JSON.parse(raw) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (payload.ok !== true) throw new Error(String(payload.error || "GAS_REQUEST_FAILED"));
  return payload;
}

export async function gasGet(resource: string, params: Record<string, string> = {}) {
  const { endpoint, token } = backendConfig();
  if (!isBackendConfigured()) throw new Error("LIVE_BACKEND_NOT_CONFIGURED");
  const url = new URL(endpoint);
  url.searchParams.set("resource", resource);
  url.searchParams.set("token", token);
  url.searchParams.set("t", String(Date.now()));
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25_000) });
  return parseResponse(response);
}

export async function gasPost(action: string, payload: Record<string, unknown> = {}) {
  const { endpoint, token } = backendConfig();
  if (!isBackendConfigured()) throw new Error("LIVE_BACKEND_NOT_CONFIGURED");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action, ...payload }),
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  return parseResponse(response);
}
