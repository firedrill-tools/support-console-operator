/** Original completed Responses JSON gates the real provider before eager tools. */
import { createOpenAI } from "@ai-sdk/openai";
import { Agent, fetch as httpFetch } from "undici";
import { z } from "zod";
import { parseJSON } from "./json.js";
import { hash } from "./schema.js";
import { usageOf, errorInfo } from "./evidence.js";
export const MAX_REQUESTS = 18;
const text = z.string().min(1).max(160);
export const argumentsFor = {
  browser_inspect: z.strictObject({}),
  browser_click: z.strictObject({
    role: z.enum(["link", "button"]),
    name: text,
  }),
  browser_fill: z.strictObject({ label: text, value: z.string().max(4000) }),
  browser_select: z.strictObject({ label: text, option: text }),
};
export function configuration(options = {}) {
  const model = options.model ?? process.env.OPENAI_MODEL,
    key = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (
    typeof model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model)
  )
    throw Error("OPENAI_MODEL must explicitly name an enabled model");
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,1024}$/.test(key))
    throw Error("OPENAI_API_KEY is required");
  const url = new URL(
    options.providerBaseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",
  );
  if (
    url.username ||
    url.password ||
    !["/", "/v1", "/v1/"].includes(url.pathname) ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    throw Error(
      "provider needs exact HTTPS or owned loopback Responses API origin",
    );
  return { model, key, baseURL: url.origin + "/v1", origin: url.origin };
}
export function completedResponse(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.status !== "completed" ||
    body.error != null ||
    body.incomplete_details != null ||
    !Array.isArray(body.output) ||
    !body.output.length
  )
    throw Error("original Responses output is unfinished/errored or empty");
  const calls = [],
    messages = [];
  for (const item of body.output) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error("invalid original output item");
    if (item.type === "reasoning") {
      if (
        (item.status != null && item.status !== "completed") ||
        !Array.isArray(item.summary) ||
        item.summary.some(
          (s) => s?.type !== "summary_text" || typeof s.text !== "string",
        )
      )
        throw Error("unfinished or unknown original reasoning item");
      continue;
    }
    if (item.type === "function_call") {
      if (
        item.status !== "completed" ||
        typeof item.call_id !== "string" ||
        !item.call_id.trim() ||
        item.call_id.length > 240 ||
        !argumentsFor[item.name] ||
        typeof item.arguments !== "string" ||
        item.arguments.length > 12000 ||
        (item.async != null && item.async !== false) ||
        (item.namespace != null && item.namespace !== "") ||
        (item.caller != null &&
          (item.caller.type !== "direct" ||
            Object.keys(item.caller).some((k) => k !== "type")))
      )
        throw Error("unfinished/deferred/unknown original function call");
      const args = argumentsFor[item.name].parse(parseJSON(item.arguments));
      calls.push({
        kind: "tool",
        id: item.call_id,
        itemId: typeof item.id === "string" ? item.id : null,
        name: item.name,
        args,
      });
      continue;
    }
    if (item.type === "message") {
      if (
        item.status !== "completed" ||
        item.role !== "assistant" ||
        !Array.isArray(item.content) ||
        !item.content.length ||
        item.content.some(
          (c) => c?.type !== "output_text" || typeof c.text !== "string",
        )
      )
        throw Error("unfinished/refused or unknown original message");
      const value = item.content.map((c) => c.text).join("");
      if (!value.trim()) throw Error("original final text is blank");
      messages.push({ text: value, phase: item.phase ?? null });
      continue;
    }
    throw Error("unknown/forged original output item type");
  }
  if (calls.length === 1 && messages.every((m) => m.phase === "commentary"))
    return calls[0];
  if (
    !calls.length &&
    messages.length === 1 &&
    [null, "final_answer"].includes(messages[0].phase)
  )
    return { kind: "answer", text: messages[0].text };
  throw Error("original response contains parallel/mixed/ambiguous authority");
}
export class Native {
  constructor(config, receipt, owner) {
    Object.assign(this, { config, receipt, owner });
    this.pool = new Agent({
      connections: 1,
      pipelining: 1,
      connect: { timeout: 5000, rejectUnauthorized: true },
      headersTimeout: 30000,
      bodyTimeout: 30000,
    });
    this.pending = new Set();
    this.active = false;
    this.closeAttempted = false;
    this.closed = false;
    this.provider = createOpenAI({
      apiKey: config.key,
      baseURL: config.baseURL,
      fetch: this.fetch.bind(this),
    });
    this.model = this.provider.responses(config.model);
  }
  fetch(input, init) {
    const work = this.request(input, init);
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => {});
    return work;
  }
  async request(input, init) {
    let call, phaseTimer;
    try {
      this.owner.basicGuard();
      if (this.closeAttempted || this.active)
        throw Error("native transport is closing or has a parallel request");
      this.active = true;
      if (this.receipt.data.calls.length >= MAX_REQUESTS)
        throw Error("prepared native request budget exhausted");
      if (this.owner.authority && !this.owner.authority.consumed)
        throw Error("previous original tool authority was not consumed");
      call = {
        number: this.receipt.data.calls.length + 1,
        status: "prepared",
        reportedUsage: usageOf(null),
      };
      this.receipt.data.calls.push(call);
      this.receipt.save();
      const request = new Request(input, init),
        url = new URL(request.url);
      if (
        url.origin !== this.config.origin ||
        url.pathname !== "/v1/responses" ||
        url.search ||
        url.hash ||
        request.method !== "POST" ||
        request.headers.get("authorization") !== `Bearer ${this.config.key}`
      )
        throw Error("unqualified owned Responses request");
      const reader = request.body?.getReader(),
        parts = [];
      let size = 0;
      try {
        if (reader)
          for (;;) {
            const n = await reader.read();
            if (n.done) break;
            size += n.value.length;
            if (size > 2 * 1024 * 1024) {
              await reader.cancel();
              throw Error("native request exceeds retained limit");
            }
            parts.push(n.value);
          }
      } finally {
        reader?.releaseLock();
      }
      const raw = Buffer.concat(parts),
        body = parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      call.request = {
        bodyBase64: raw.toString("base64"),
        sha256: hash(raw),
        decodedBytes: raw.length,
        body,
      };
      this.receipt.save();
      if (
        body.model !== this.config.model ||
        body.max_output_tokens !== 4096 ||
        body.store !== false ||
        body.parallel_tool_calls !== false ||
        (body.stream != null && body.stream !== false)
      )
        throw Error(
          "original native request model/output/storage/parallel/stream bounds differ",
        );
      await this.owner.guard();
      const ms = Math.max(
          1,
          Math.min(30000, Math.ceil(this.owner.deadline - performance.now())),
        ),
        phase = new AbortController();
      phaseTimer = setTimeout(
        () =>
          phase.abort(
            Error(
              ms < 30000
                ? "support operation deadline exceeded during native HTTP"
                : "native HTTP deadline exceeded",
            ),
          ),
        ms,
      );
      const signal = AbortSignal.any([
        this.owner.signal,
        phase.signal,
        request.signal,
      ]);
      const response = await httpFetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: raw,
        dispatcher: this.pool,
        redirect: "manual",
        signal,
      });
      call.response = {
        status: response.status,
        headers: Object.fromEntries(
          ["content-type", "x-request-id", "request-id", "openai-processing-ms"]
            .filter((k) => response.headers.has(k))
            .map((k) => [k, response.headers.get(k)]),
        ),
        complete: false,
      };
      const responseReader = response.body?.getReader(),
        chunks = [];
      let bytes = 0;
      try {
        if (responseReader)
          for (;;) {
            const n = await responseReader.read();
            if (n.done) break;
            const left = 1024 * 1024 - bytes;
            chunks.push(n.value.subarray(0, Math.max(0, left)));
            bytes += Math.min(n.value.length, Math.max(0, left));
            if (n.value.length > left) {
              await responseReader.cancel();
              throw Error("native decoded response exceeds retained limit");
            }
          }
        call.response.complete = true;
      } finally {
        responseReader?.releaseLock();
        const retained = Buffer.concat(chunks);
        Object.assign(call.response, {
          bodyBase64: retained.toString("base64"),
          decodedBytes: retained.length,
          sha256: call.response.complete ? hash(retained) : null,
          prefixSha256: hash(retained),
        });
        this.receipt.save();
      }
      const data = Buffer.from(call.response.bodyBase64, "base64");
      let original;
      try {
        original = parseJSON(
          new TextDecoder("utf-8", { fatal: true }).decode(data),
        );
        call.response.body = original;
        call.reportedUsage = usageOf(original);
        this.receipt.save();
      } catch (e) {
        throw Error("invalid original native JSON", { cause: e });
      }
      if (!response.ok) throw Error(`native Responses HTTP ${response.status}`);
      if (
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("application/json")
      )
        throw Error("native provider did not return JSON");
      const accepted = completedResponse(original);
      call.accepted = accepted;
      if (
        accepted.kind === "tool" &&
        (call.number === MAX_REQUESTS ||
          this.receipt.data.calls.some(
            (c) =>
              c !== call &&
              c.accepted?.kind === "tool" &&
              c.accepted.id === accepted.id,
          ))
      )
        throw Error(
          "original native tool is replayed or exceeds final request tool budget",
        );
      await this.owner.guard();
      this.owner.authority =
        accepted.kind === "tool"
          ? { number: call.number, accepted, consumed: false }
          : null;
      this.owner.originalAnswer =
        accepted.kind === "answer" ? accepted.text : null;
      call.status = "accepted";
      this.receipt.save();
      this.owner.basicGuard();
      return new Response(data, {
        status: response.status,
        headers: {
          "content-type": "application/json",
          ...call.response.headers,
        },
      });
    } catch (e) {
      if (call) {
        call.status = "failed";
        call.error = errorInfo(e);
        try {
          this.receipt.save();
        } catch {}
      }
      this.owner.fail(e);
      throw e;
    } finally {
      clearTimeout(phaseTimer);
      this.active = false;
    }
  }
  async close() {
    if (this.closeAttempted) throw Error("native HTTP close already attempted");
    this.closeAttempted = true;
    let failure;
    try {
      await this.pool.destroy();
    } catch (e) {
      failure = e;
    }
    await Promise.allSettled([...this.pending]);
    if (failure) throw failure;
    this.closed = true;
  }
}
