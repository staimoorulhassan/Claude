// Minimal Vapi REST client (create / update / get assistant). Uses native fetch (Node 18+).
const BASE = process.env.VAPI_API_BASE || "https://api.vapi.ai";

function headers() {
  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) throw new Error("VAPI_PRIVATE_KEY is not set in config/.env");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

export const vapi = {
  createAssistant: (assistant) => req("POST", "/assistant", assistant),
  updateAssistant: (id, patch) => req("PATCH", `/assistant/${id}`, patch),
  getAssistant: (id) => req("GET", `/assistant/${id}`),
};
