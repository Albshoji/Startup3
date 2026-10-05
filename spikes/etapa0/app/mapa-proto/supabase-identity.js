// SPIKE — reads ONLY role and sub from the bearer token of a Supabase request (never stores the token).
export function identityFromHeaders(headers) {
  try {
    const auth = headers.get ? headers.get("authorization") : headers.authorization || headers.Authorization;
    if (!auth || !auth.startsWith("Bearer ")) return undefined;
    const part = auth.slice(7).split(".")[1];
    if (!part) return { role: "opaque-key" }; // new sb_publishable_/sb_secret_ keys are not JWTs
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const p = JSON.parse(json);
    return { role: p.role, user_id: p.sub };
  } catch {
    return { role: "unreadable" };
  }
}
