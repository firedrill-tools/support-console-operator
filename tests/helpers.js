import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Store } from "../src/state.js";
import { createApp } from "../src/server.js";
import { initializeStarter } from "../src/init.js";
import { initialize } from "../src/datasets.js";
export const address = "48 Spadina Avenue, Unit 12, Toronto, ON";
export const actions = [
  ["browser_click", { role: "link", name: "Open T-401 →" }],
  ["browser_click", { role: "link", name: "Open address-note.txt →" }],
  ["browser_click", { role: "link", name: "← T-401" }],
  ["browser_fill", { label: "Delivery address", value: address }],
  [
    "browser_fill",
    {
      label: "Customer reply",
      value: `I confirmed the corrected delivery address is ${address}.`,
    },
  ],
  ["browser_select", { label: "Ticket status", option: "Resolved" }],
  ["browser_click", { role: "button", name: "Submit update" }],
];
export function bodyFor(n, sequence = actions) {
  const action = sequence[n - 1];
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
            name: action[0],
            arguments: JSON.stringify(action[1]),
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
                text: "The current synthetic source was verified.",
                annotations: [],
              },
            ],
          },
        ],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    unknown_original: true,
  };
}
export async function environment(
  t,
  { sequence = actions, mutate = (b) => b, wrap, caseId } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "support-runtime-")),
    file = path.join(directory, "state.json");
  if (caseId) initialize(file, caseId);
  else initializeStarter(file);
  const store = new Store(file),
    app = createApp(file),
    portal = createServer(wrap ? wrap(app) : app),
    requests = [];
  portal.listen(0, "127.0.0.1");
  await once(portal, "listening");
  const provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const request = JSON.parse(raw);
      requests.push(request);
      assert.equal(req.url, "/v1/responses");
      assert.equal(
        req.headers.authorization,
        "Bearer synthetic-support-owned-key",
      );
      assert.equal(request.model, "controlled-support");
      assert.equal(request.max_output_tokens, 4096);
      assert.equal(request.store, false);
      assert.equal(request.parallel_tool_calls, false);
      const n =
          (request.input ?? []).filter((c) => c.type === "function_call_output")
            .length + 1,
        body = await mutate(bodyFor(n, sequence), n, {
          store,
          file,
          request,
          res,
        });
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": "request-" + requests.length,
      });
      res.end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: e.message,
            type: "controlled_error",
            code: "controlled",
          },
        }),
      );
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(async () => {
    provider.closeAllConnections();
    portal.closeAllConnections();
    await Promise.all([
      new Promise((r) => provider.close(r)),
      new Promise((r) => portal.close(r)),
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    file,
    store,
    requests,
    options: {
      statePath: file,
      model: "controlled-support",
      apiKey: "synthetic-support-owned-key",
      providerBaseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      portalUrl: `http://127.0.0.1:${portal.address().port}`,
      outputRoot: directory,
      allowWrites: true,
      target: {
        id: "T-401",
        customer: "Nora Blake",
        email: "nora@harbor.example",
      },
    },
  };
}
