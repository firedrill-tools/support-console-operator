import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateText, isStepCount, tool } from "ai";
import { summarize } from "../src/evidence.js";
import { z } from "zod";
import { Native, configuration } from "../src/native.js";
import { Receipt } from "../src/evidence.js";
function response(n, action) {
  return {
    id: "response-" + n,
    object: "response",
    created_at: 1792166400,
    status: "completed",
    model: "controlled-support",
    error: null,
    incomplete_details: null,
    output: action
      ? [
          {
            id: "function-" + n,
            type: "function_call",
            call_id: "call-" + n,
            name: "browser_inspect",
            arguments: "{}",
            status: "completed",
          },
        ]
      : [
          {
            id: "message-" + n,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Observed native completion.",
                annotations: [],
              },
            ],
          },
        ],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 99 },
    unknown_original: true,
  };
}
async function exercise(
  t,
  {
    action = false,
    mutate = (b) => b,
    rounds = 1,
    status = 200,
    raw: render,
    steps = 2,
  } = {},
) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "support-native-owned-"),
    ),
    receipt = new Receipt(directory, { sdk: [] }),
    controller = new AbortController(),
    requests = [],
    owner = {
      receipt,
      signal: controller.signal,
      deadline: performance.now() + 15000,
      failure: null,
      basicGuard() {
        if (this.failure) throw this.failure;
        this.signal.throwIfAborted();
      },
      async guard() {
        this.basicGuard();
      },
      fail(e) {
        this.failure ??= e;
        controller.abort(e);
      },
    };
  let executed = 0,
    native,
    result,
    error;
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    requests.push(body);
    assert.equal(req.url, "/v1/responses");
    assert.equal(
      req.headers.authorization,
      "Bearer synthetic-support-native-key",
    );
    const n = requests.length,
      value = mutate(response(n, action && n <= rounds), n);
    res.writeHead(status, {
      "content-type": "application/json",
      "x-request-id": "request-" + n,
    });
    res.end(render ? render(value, n) : JSON.stringify(value));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    native = new Native(
      configuration({
        model: "controlled-support",
        apiKey: "synthetic-support-native-key",
        providerBaseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      }),
      receipt,
      owner,
    );
    result = await generateText({
      model: native.model,
      prompt:
        "Use the synthetic inspect tool, then describe the observed result.",
      tools: {
        browser_inspect: tool({
          inputSchema: z.strictObject({}),
          execute: async (args, context) => {
            owner.basicGuard();
            assert.equal(owner.authority.accepted.id, context.toolCallId);
            assert.equal(owner.authority.accepted.name, "browser_inspect");
            assert.deepEqual(args, owner.authority.accepted.args);
            assert.equal(owner.authority.consumed, false);
            owner.authority.consumed = true;
            executed++;
            return { observed: "synthetic business view" };
          },
        }),
      },
      stopWhen: isStepCount(steps),
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: controller.signal,
      providerOptions: { openai: { store: false, parallelToolCalls: false } },
    });
    receipt.data.sdk = {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.totalUsage,
    };
    receipt.save();
  } catch (e) {
    error = owner.failure ?? e;
  } finally {
    await native?.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { receipt: receipt.data, requests, executed, error, result, native };
}
test("actual AI SDK/provider custom fetch preserves original completed JSON/usage before a terminal answer", async (t) => {
  const e = await exercise(t);
  assert.ifError(e.error);
  assert.equal(e.result.text, "Observed native completion.");
  assert.equal(e.result.finishReason, "stop");
  assert.equal(e.requests.length, 1);
  assert.equal(e.requests[0].max_output_tokens, 4096);
  assert.equal(e.requests[0].store, false);
  assert.equal(e.requests[0].parallel_tool_calls, false);
  assert.equal(e.receipt.calls[0].response.body.unknown_original, true);
  assert.equal(e.receipt.calls[0].reportedUsage.total.value, 99);
  assert.equal(e.native.closed, true);
});
test("actual SDK tool execution matches one original completed call ID/name/args", async (t) => {
  const e = await exercise(t, { action: true });
  assert.ifError(e.error);
  assert.equal(e.executed, 1);
  assert.equal(e.requests.length, 2);
  assert.equal(e.result.text, "Observed native completion.");
});
for (const flag of ["response", "item", "max-output"])
  test(`original ${flag} incomplete state never reaches actual SDK tool dispatch`, async (t) => {
    const e = await exercise(t, {
      action: true,
      mutate: (b, n) => {
        if (n === 1) {
          if (flag !== "item") b.status = "incomplete";
          if (flag === "item") b.output[0].status = "incomplete";
          if (flag === "max-output")
            b.incomplete_details = { reason: "max_output_tokens" };
        }
        return b;
      },
    });
    assert.match(e.error.message, /unfinished/);
    assert.equal(e.executed, 0);
    assert.equal(e.requests.length, 1);
    assert.equal(e.receipt.calls[0].reportedUsage.input.value, 10);
    assert.equal(e.receipt.calls[0].response.complete, true);
    assert.equal(e.native.closed, true);
  });
for (const fault of [
  "parallel",
  "refusal",
  "unknown-tool",
  "duplicate-args",
  "blank-answer",
  "mixed-answer",
])
  test(`original ${fault} output fails before eager SDK dispatch`, async (t) => {
    const e = await exercise(t, {
      action: fault !== "blank-answer",
      mutate: (b) => {
        if (fault === "parallel")
          b.output.push({
            ...b.output[0],
            id: "function-other",
            call_id: "call-other",
          });
        if (fault === "refusal")
          b.output = [
            {
              type: "message",
              id: "refusal",
              role: "assistant",
              status: "completed",
              content: [{ type: "refusal", refusal: "Unavailable" }],
            },
          ];
        if (fault === "unknown-tool")
          b.output[0].name = "arbitrary_network_request";
        if (fault === "duplicate-args")
          b.output[0].arguments = '{"label":"A","label":"B"}';
        if (fault === "blank-answer") b.output[0].content[0].text = "   ";
        if (fault === "mixed-answer")
          b.output.push(response(9, false).output[0]);
        return b;
      },
    });
    assert.ok(e.error);
    assert.equal(e.executed, 0);
    assert.equal(e.requests.length, 1);
    assert.equal(e.native.closed, true);
  });
test("original reused call identity cannot dispatch a second actual SDK tool", async (t) => {
  const e = await exercise(t, {
    action: true,
    rounds: 2,
    steps: 4,
    mutate: (b, n) => {
      if (n === 2) b.output[0].call_id = "call-1";
      return b;
    },
  });
  assert.match(e.error.message, /replayed/);
  assert.equal(e.executed, 1);
  assert.equal(e.requests.length, 2);
});
test("prepared native limit rejects eighteenth tool before execution with no nineteenth request", async (t) => {
  const e = await exercise(t, { action: true, rounds: 18, steps: 19 });
  assert.match(e.error.message, /budget/);
  assert.equal(e.executed, 17);
  assert.equal(e.requests.length, 18);
  assert.equal(e.receipt.calls.length, 18);
});
test("native usage absent remains unknown despite SDK normalization; genuine zero stays observed", async (t) => {
  for (const value of [
    undefined,
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  ]) {
    const e = await exercise(t, {
      mutate: (b) => {
        b.usage = value;
        return b;
      },
    });
    assert.ifError(e.error);
    const original = e.receipt.calls[0].reportedUsage.input;
    assert.equal(original.status, value ? "observed" : "unknown");
    assert.equal(original.value, value ? 0 : null);
    assert.equal(summarize(e.receipt.calls).costUsd, null);
  }
});
test("native HTTP error preserves original body and usage without hidden SDK retries", async (t) => {
  const e = await exercise(t, { status: 429 });
  assert.match(e.error.message, /HTTP 429/);
  assert.equal(e.requests.length, 1);
  assert.equal(e.executed, 0);
  assert.equal(e.receipt.calls[0].reportedUsage.total.value, 99);
});
test("duplicate original root fields cannot be laundered through JSON or actual SDK", async (t) => {
  const e = await exercise(t, {
    action: true,
    raw: (b) =>
      JSON.stringify(b).replace(
        '"status":"completed"',
        '"status":"incomplete","status":"completed"',
      ),
  });
  assert.ok(e.error);
  assert.equal(e.executed, 0);
  assert.equal(e.receipt.calls[0].response.complete, true);
});
test("oversize original native body records bounded prefix and unknown usage before abort", async (t) => {
  const e = await exercise(t, {
    action: true,
    mutate: (b) => ({ ...b, padding: "x".repeat(1024 * 1024) }),
  });
  assert.match(e.error.message, /retained limit/);
  assert.equal(e.executed, 0);
  assert.equal(e.receipt.calls[0].response.complete, false);
  assert.equal(e.receipt.calls[0].response.sha256, null);
  assert.equal(e.receipt.calls[0].response.decodedBytes, 1024 * 1024);
  assert.equal(e.receipt.calls[0].reportedUsage.input.status, "unknown");
});
