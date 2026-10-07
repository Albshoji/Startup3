// Access to the person's Supabase project through the Management API, on their behalf (OAuth).
// CLAUDE.md §7.4–7.5: always READ-ONLY. This client refuses, before anything leaves, every call that
// is not a GET of the allowed list or the read-only SQL endpoint; it never touches the endpoint that
// can write (`/database/query`).

export const MANAGEMENT_API = "https://api.supabase.com";

/** Allowed calls: method + path pattern. Nothing else can be sent. */
const ALLOWED: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "GET", path: /^\/v1\/organizations$/ },
  { method: "GET", path: /^\/v1\/projects$/ },
  { method: "GET", path: /^\/v1\/projects\/[a-z0-9]+\/functions$/ },
  { method: "GET", path: /^\/v1\/projects\/[a-z0-9]+\/storage\/buckets$/ },
  { method: "GET", path: /^\/v1\/projects\/[a-z0-9]+\/analytics\/endpoints\/logs$/ },
  { method: "POST", path: /^\/v1\/projects\/[a-z0-9]+\/database\/query\/read-only$/ },
];

export function isAllowedCall(method: string, path: string): boolean {
  return ALLOWED.some((rule) => rule.method === method && rule.path.test(path));
}

export class ManagementApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ReadOnlyViolation extends Error {}

/** No call waits longer than this (a paused project's database never answers). */
export const CALL_TIMEOUT_MS = 20_000;

/** Supabase pauses idle free projects: their database does not answer until reactivated. */
export function isProjectActive(project: { status?: string }): boolean {
  return !project.status || project.status.startsWith("ACTIVE");
}

export interface SupabaseProjectSummary {
  ref: string;
  name: string;
  organization_id: string;
  region?: string;
  status?: string;
}

export class ManagementClient {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = MANAGEMENT_API,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const pathname = path.split("?")[0]!;
    if (!isAllowedCall(method, pathname)) throw new ReadOnlyViolation(`chamada não permitida (somente leitura): ${method} ${pathname}`);
    const token = await this.accessToken(); // its own errors (e.g. access revoked) pass through unchanged
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new ManagementApiError(`${method} ${pathname} → sem resposta (${error instanceof Error ? error.name : "erro"})`, 504);
    }
    const text = await res.text();
    if (!res.ok) throw new ManagementApiError(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`, res.status);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listOrganizations() {
    return this.call<{ id: string; name: string; slug?: string }[]>("GET", "/v1/organizations");
  }

  async listProjects(): Promise<SupabaseProjectSummary[]> {
    const projects = await this.call<{ id?: string; ref?: string; name: string; organization_id: string; region?: string; status?: string }[]>("GET", "/v1/projects");
    return projects.map((p) => ({ ref: (p.ref ?? p.id)!, name: p.name, organization_id: p.organization_id, ...(p.region ? { region: p.region } : {}), ...(p.status ? { status: p.status } : {}) }));
  }

  listFunctions(ref: string) {
    return this.call<{ slug: string; name: string; status?: string; version?: number; verify_jwt?: boolean; updated_at?: number | string }[]>("GET", `/v1/projects/${ref}/functions`);
  }

  listBuckets(ref: string) {
    return this.call<{ id: string; name: string; public: boolean }[]>("GET", `/v1/projects/${ref}/storage/buckets`);
  }

  /** SQL through the read-only endpoint: the database refuses any write in it. */
  readOnlyQuery<T = Record<string, unknown>>(ref: string, sql: string) {
    return this.call<T[]>("POST", `/v1/projects/${ref}/database/query/read-only`, { query: sql });
  }
}
