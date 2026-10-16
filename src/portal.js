import { Agent, fetch as httpFetch } from "undici";
import { parseJSON } from "./json.js";
import { hash, validateState, same } from "./schema.js";
import { errorInfo } from "./evidence.js";
export function portalOrigin(value) {
  const u = new URL(value);
  if (
    u.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error("portal needs an exact owned HTTP loopback origin");
  return u.origin;
}
export class Portal {
  constructor(origin, receipt, owner) {
    this.origin = origin;
    this.receipt = receipt;
    this.owner = owner;
    this.pool = new Agent({
      connections: 1,
      pipelining: 1,
      connect: { timeout: 5000 },
      headersTimeout: 30000,
      bodyTimeout: 30000,
    });
    this.credential = null;
    this.scope = null;
    this.instance = undefined;
    this.closeAttempted = false;
    this.closed = false;
    this.registrationAttempted = false;
    this.endAttempted = false;
    this.ended = false;
  }
  async request(
    endpoint,
    method = "GET",
    body = undefined,
    { cleanup = false } = {},
  ) {
    if (this.closeAttempted) throw new Error("portal HTTP is closing");
    if (!cleanup) this.owner.basicGuard();
    if (
      ![
        "/api/source",
        "/api/operator-sessions",
        "/api/operator-sessions/close",
      ].includes(endpoint) ||
      method !== (endpoint === "/api/source" ? "GET" : "POST") ||
      (!cleanup && this.receipt.data.portal.length >= 256)
    )
      throw new Error(
        "unqualified portal operation or request budget exhausted",
      );
    const item = {
      endpoint,
      method,
      status: "prepared",
      request: body ?? null,
    };
    this.receipt.data.portal.push(item);
    if (!cleanup) this.receipt.save();
    const phase = AbortSignal.timeout(
        cleanup
          ? 5000
          : Math.max(
              1,
              Math.min(
                30000,
                Math.ceil(this.owner.deadline - performance.now()),
              ),
            ),
      ),
      signal = cleanup ? phase : AbortSignal.any([this.owner.signal, phase]);
    let response;
    try {
      response = await httpFetch(this.origin + endpoint, {
        method,
        headers: {
          "x-support-owner": "synthetic-local-controller-v1",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(this.credential
            ? { "x-support-operation": this.credential }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        dispatcher: this.pool,
        redirect: "manual",
        signal,
      });
      item.httpStatus = response.status;
      const reader = response.body?.getReader(),
        chunks = [];
      let size = 0;
      const limit = endpoint === "/api/source" ? 12 * 1024 * 1024 : 65536;
      try {
        if (reader)
          for (;;) {
            const n = await reader.read();
            if (n.done) break;
            size += n.value.length;
            if (size > limit) {
              await reader.cancel();
              throw new Error("portal decoded response exceeds retained limit");
            }
            chunks.push(n.value);
          }
      } finally {
        reader?.releaseLock();
      }
      const raw = Buffer.concat(chunks);
      item.responseSha256 = hash(raw);
      item.decodedBytes = raw.length;
      if (response.status !== 200 && response.status !== 201)
        throw new Error(`portal ${endpoint} HTTP ${response.status}`);
      const value = parseJSON(
        new TextDecoder("utf-8", { fatal: true }).decode(raw),
      );
      item.status = "received";
      if (endpoint === "/api/operator-sessions")
        item.responseRetention =
          "local operation credential omitted; response hash retained";
      if (!cleanup) this.receipt.save();
      return value;
    } catch (e) {
      item.status = "failed";
      item.error = errorInfo(e);
      if (!cleanup) {
        this.owner.failure ??= e;
        try {
          this.receipt.save();
        } catch {}
      }
      throw e;
    }
  }
  async snapshot(cleanup = false) {
    const value = await this.request("/api/source", "GET", undefined, {
      cleanup,
    });
    if (
      value.synthetic !== true ||
      value.version !== 1 ||
      typeof value.body_base64 !== "string" ||
      typeof value.sha256 !== "string"
    )
      throw new Error("invalid portal source envelope");
    const raw = Buffer.from(value.body_base64, "base64");
    if (
      raw.length > 8 * 1024 * 1024 ||
      raw.toString("base64") !== value.body_base64 ||
      hash(raw) !== value.sha256
    )
      throw new Error("portal source bytes/hash differ");
    const state = validateState(
        parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
      ),
      instance = state.instance_id ?? null;
    if (
      value.instance_id !== instance ||
      (this.instance !== undefined && this.instance !== instance)
    )
      throw new Error("portal workspace instance changed");
    this.instance = instance;
    const source = {
      state,
      sha256: hash(raw),
      bodyBase64: raw.toString("base64"),
      instanceId: instance,
    };
    this.owner.source = source;
    return source;
  }
  async register(taskHash, allowWrites, target) {
    this.registrationAttempted = true;
    const result = await this.request("/api/operator-sessions", "POST", {
      task_sha256: taskHash,
      allow_writes: allowWrites,
      target,
    });
    if (
      typeof result.credential !== "string" ||
      !/^[a-f0-9]{64}$/.test(result.credential)
    )
      throw new Error("portal omitted private operator credential");
    this.credential = result.credential;
    this.scope = result.operation;
    if (
      !this.scope ||
      this.scope.task_sha256 !== taskHash ||
      this.scope.allow_writes !== allowWrites ||
      !same(this.scope.target, target) ||
      this.scope.status !== "active" ||
      this.scope.credential_sha256 !== hash(this.credential)
    )
      throw new Error("registered operation differs from caller authority");
    const source = await this.snapshot();
    const actual = source.state.operations?.find((o) => o.id === this.scope.id);
    if (!same(actual, this.scope))
      throw new Error("registered operation is absent from committed source");
    this.receipt.data.operation = structuredClone(this.scope);
    this.receipt.save();
  }
  async end() {
    if (this.endAttempted) throw new Error("operation close already attempted");
    this.endAttempted = true;
    const result = await this.request(
      "/api/operator-sessions/close",
      "POST",
      {},
      { cleanup: true },
    );
    if (
      result.operation?.id !== this.scope.id ||
      result.operation.status !== "closed"
    )
      throw new Error("operation close was not confirmed");
    this.ended = true;
  }
  async close() {
    if (this.closeAttempted)
      throw new Error("portal HTTP close already attempted");
    this.closeAttempted = true;
    await this.pool.destroy();
    this.closed = true;
  }
}
