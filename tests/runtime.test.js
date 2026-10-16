import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runOwnedOperator } from "../src/runtime.js";
import { BrowserSession } from "../src/browser.js";
import { Native } from "../src/native.js";
import { environment, actions, address } from "./helpers.js";
test(
  "actual owned AI SDK/OpenAI HTTP and scoped Chromium read attachment/current correction before exact support update",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      neighbor = e.store.read().tickets[1],
      { result } = await runOwnedOperator(
        "Resolve T-401 only after reading the attachment and latest customer correction.",
        e.options,
      ),
      receipt = JSON.parse(fs.readFileSync(result.receiptPath));
    assert.equal(e.requests.length, 8);
    assert.equal(e.store.read().tickets[0].revision, 2);
    assert.equal(e.store.read().tickets[0].address, address);
    assert.equal(e.store.read().tickets[0].status, "Resolved");
    assert.deepEqual(e.store.read().tickets[1], neighbor);
    assert.deepEqual(result.business.changedTicketIds, ["T-401"]);
    assert.equal(result.business.attachmentReadIds.length, 1);
    assert.equal(receipt.observations.length, 8);
    assert.ok(receipt.cleanupConfirmed, JSON.stringify(receipt.lifecycle));
    assert.equal(result.usage.input.value, 80);
    assert.equal(result.costUsd, null);
    assert.ok(receipt.calls.every((c) => c.response.body.unknown_original));
    assert.ok(!JSON.stringify(receipt).includes("synthetic-support-owned-key"));
    assert.match(JSON.stringify(e.requests[2].input), /220 King Street West/);
    assert.match(
      JSON.stringify(e.requests[3].input),
      /Correction: the attached address is outdated/,
    );
  },
);
for (const kind of ["response", "item", "reason"])
  test(
    `actual incomplete ${kind} Submit cannot reach real browser dispatch or support commit`,
    { timeout: 30000 },
    async (t) => {
      const e = await environment(t, {
        mutate: (body, n) => {
          if (n === 7) {
            if (kind !== "item") body.status = "incomplete";
            if (kind === "item") body.output[0].status = "incomplete";
            if (kind === "reason")
              body.incomplete_details = { reason: "max_output_tokens" };
          }
          return body;
        },
      });
      await assert.rejects(
        runOwnedOperator("Resolve the exact corrected T-401", e.options),
        (error) => {
          assert.match(error.message, /unfinished/);
          assert.equal(error.result.actions.length, 6);
          assert.equal(error.result.calls.length, 7);
          assert.equal(error.result.calls[6].reportedUsage.input.value, 10);
          assert.ok(
            error.result.cleanupConfirmed,
            JSON.stringify(error.result.lifecycle),
          );
          return true;
        },
      );
      assert.equal(e.store.read().tickets[0].revision, 1);
      assert.equal(e.store.read().updates, undefined);
      assert.equal(e.store.read().operations[0].status, "closed");
    },
  );
const reply402 =
  "We are investigating the return label and will keep this ticket open.";
const sequence402 = [
  ["browser_click", { role: "link", name: "Open T-402 →" }],
  ["browser_fill", { label: "Customer reply", value: reply402 }],
  ["browser_click", { role: "button", name: "Submit update" }],
];
const target402 = {
  id: "T-402",
  customer: "Eli Chen",
  email: "eli@northstar.example",
};
async function rejected(e, options = e.options, pattern = /./) {
  let result;
  await assert.rejects(
    runOwnedOperator(
      "Inspect and update only the explicitly authorized fictional support ticket.",
      options,
    ),
    (error) => {
      assert.match(error.message, pattern);
      result = error.result;
      assert.equal(result.status, "failed");
      return true;
    },
  );
  return result;
}
test(
  "read-only native operation cannot submit, even if provider asks",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, { sequence: [actions[0], actions.at(-1)] }),
      r = await rejected(
        e,
        { ...e.options, allowWrites: false, target: undefined },
        /writes_not_authorized/,
      );
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.equal(r.calls.length, 2);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "a different valid caller target cannot borrow another ticket form or attachment authority",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        { ...e.options, target: target402 },
        /visible enabled|target/,
      );
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.equal(e.store.ticket("T-402").revision, 1);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "missing attachment observation stops real native Submit",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        sequence: [actions[0], ...actions.slice(3)],
      }),
      r = await rejected(e, undefined, /visible enabled|attachment/);
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "current correction after form observation makes the actual pending Submit stale",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (b, n, { store }) => {
          if (n === 7)
            store.correct(
              "T-401",
              {
                at: "2026-10-15T10:30:00Z",
                author: "Customer",
                text: "Please keep this ticket open; do not change the address again.",
              },
              { keepOpen: true },
              1,
            );
          return b;
        },
      }),
      r = await rejected(e, undefined, /stale_revision/);
    assert.equal(e.store.ticket("T-401").revision, 2);
    assert.equal(e.store.ticket("T-401").status, "Open");
    assert.equal(e.store.read().updates, undefined);
    assert.match(r.observations.at(-1).text, /not saved|stale_revision/);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "real transient failure remains unsaved; a separate authorized run reads and retries current state",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, { sequence: sequence402 }),
      options = { ...e.options, target: target402 },
      r = await rejected(e, options, /submit_failed_retryable/);
    assert.equal(e.store.ticket("T-402").revision, 1);
    assert.equal(e.store.ticket("T-402").reply, "");
    assert.equal(r.observedBusiness.failures.length, 1);
    assert.equal(e.requests.length, 3);
    assert.match(r.observations.at(-1).text, /submit_failed_retryable/);
    const next = await runOwnedOperator(
      "Explicitly retry T-402 after reading its current state.",
      options,
    );
    assert.equal(e.store.ticket("T-402").revision, 2);
    assert.equal(e.store.ticket("T-402").status, "Open");
    assert.equal(next.result.business.updates.length, 1);
    assert.ok(next.result.cleanupConfirmed);
  },
);
test(
  "latest keep-open policy rejects a valid browser form that tries to resolve T-402",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        sequence: [
          ...sequence402.slice(0, 2),
          ["browser_select", { label: "Ticket status", option: "Resolved" }],
          sequence402.at(-1),
        ],
      }),
      r = await rejected(
        e,
        { ...e.options, target: target402 },
        /customer_requires_open/,
      );
    assert.equal(e.store.ticket("T-402").revision, 1);
    assert.equal(e.store.ticket("T-402").failNextSubmit, true);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "restricted directory content stays out of the actual SDK request and cannot be guessed as a link",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        sequence: [["browser_click", { role: "link", name: "Open T-403 →" }]],
      }),
      r = await rejected(e, undefined, /visible enabled|access_denied/);
    assert.doesNotMatch(
      JSON.stringify(e.requests),
      /Restricted account request|marin@|Marin Sol/,
    );
    assert.equal(r.observedBusiness.updates.length, 0);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "source corruption after a real commit fails honestly and preserves previous original action source",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (b, n, { file }) => {
          if (n === 8) fs.writeFileSync(file, '{"broken":');
          return b;
        },
      }),
      r = await rejected(e, undefined, /HTTP 422|JSON|state|source/);
    assert.equal(r.finalSource, null);
    assert.equal(r.observedBusiness, null);
    const previous = r.actions.find((a) => a.savedReadId),
      source = JSON.parse(
        Buffer.from(previous.sourceBodyBase64After, "base64"),
      );
    assert.equal(source.tickets[0].revision, 2);
    assert.equal(source.updates.length, 1);
    assert.equal(r.lifecycle.operationClosed, false);
    assert.equal(r.lifecycle.browserClosed, true);
    assert.equal(r.lifecycle.sdkWorkDrained, true);
  },
);
test(
  "recording failure before dispatch cannot submit a ticket",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (receipt.data.actions.at(-1)?.dispatchPrepared)
              throw Error("controlled receipt disk failure");
          },
        },
        /receipt disk failure/,
      );
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.equal(r.durableStatus, "unknown");
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.requests.length, 1);
  },
);
test(
  "recording failure after a real commit reports partial effects without claiming durable success",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (receipt.data.actions.at(-1)?.savedReadId)
              throw Error("controlled post-commit recording failure");
          },
        },
        /post-commit recording/,
      );
    assert.equal(e.store.ticket("T-401").revision, 2);
    assert.equal(r.durableStatus, "unknown");
    assert.equal(r.observedBusiness.updates.length, 1);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "missing provider key prepares private evidence without browser allocation or native HTTP",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(e, { ...e.options, apiKey: "" }, /OPENAI_API_KEY/);
    assert.equal(e.requests.length, 0);
    assert.equal(r.calls.length, 0);
    assert.equal(r.lifecycle.browserAllocated, false);
    assert.equal(r.lifecycle.operationClosed, true);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "partial browser startup closes its actual allocated context and browser",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        wrap: (app) => (req, res) =>
          req.url === "/"
            ? (res.writeHead(503), res.end("controlled startup failure"))
            : app(req, res),
      }),
      r = await rejected(e, undefined, /startup/);
    assert.equal(r.lifecycle.browserAllocated, true);
    assert.equal(r.lifecycle.contextAllocated, true);
    assert.equal(r.lifecycle.browserClosed, true);
    assert.equal(r.lifecycle.contextClosed, true);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.requests.length, 0);
  },
);
test(
  "parent cancellation of actual pending native Submit response drains work and closes authority",
  { timeout: 30000 },
  async (t) => {
    const controller = new AbortController();
    let release;
    const gate = new Promise((r) => (release = r));
    const e = await environment(t, {
        mutate: async (b, n) => {
          if (n === 7) {
            controller.abort(Error("controlled parent cancel"));
            await gate;
          }
          return b;
        },
      }),
      r = await rejected(
        e,
        { ...e.options, signal: controller.signal },
        /parent cancel/,
      );
    release();
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.equal(r.calls.length, 7);
    assert.equal(r.actions.length, 6);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.store.read().operations[0].status, "closed");
  },
);
test(
  "operation deadline during actual pending native HTTP aborts its owned request",
  { timeout: 30000 },
  async (t) => {
    let release;
    const gate = new Promise((r) => (release = r));
    const e = await environment(t, {
        sequence: [],
        mutate: async (b) => {
          await gate;
          return b;
        },
      }),
      r = await rejected(e, { ...e.options, timeoutMs: 2500 }, /deadline/);
    release();
    assert.ok(r.calls.length <= 1);
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
  },
);
test(
  "actual intercepted pending browser Submit is fenced by closed operation after cancellation",
  { timeout: 30000 },
  async (t) => {
    const controller = new AbortController();
    let release, done;
    const gate = new Promise((r) => (release = r)),
      completed = new Promise((r) => (done = r));
    const e = await environment(t, {
        wrap: (app) => (req, res) => {
          if (req.method === "POST" && req.url === "/tickets/T-401") {
            controller.abort(Error("controlled pending form cancel"));
            void gate.then(() => {
              res.on("finish", done);
              res.on("close", done);
              app(req, res);
              done();
            });
          } else app(req, res);
        },
      }),
      r = await rejected(
        e,
        { ...e.options, signal: controller.signal },
        /pending form cancel/,
      );
    assert.equal(e.store.read().operations[0].status, "closed");
    release();
    await completed;
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.ok(r.cleanupConfirmed);
  },
);
test(
  "two actual concurrent native runtimes own separate scopes, HTTP, browsers and receipts",
  { timeout: 30000 },
  async (t) => {
    const a = await environment(t),
      b = await environment(t),
      runs = await Promise.all([
        runOwnedOperator(
          "Update only exact T-401 in first workspace",
          a.options,
        ),
        runOwnedOperator(
          "Update only exact T-401 in second workspace",
          b.options,
        ),
      ]);
    assert.notEqual(runs[0].outputDir, runs[1].outputDir);
    for (const e of [a, b]) {
      assert.equal(e.store.ticket("T-401").revision, 2);
      assert.equal(e.store.read().operations.length, 1);
      assert.equal(e.requests.length, 8);
    }
    for (const r of runs)
      assert.ok(
        r.result.cleanupConfirmed ??
          JSON.parse(fs.readFileSync(r.result.receiptPath)).cleanupConfirmed,
      );
  },
);
test(
  "native failure after successful actual Submit preserves exact committed business effect",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (b, n) => {
          if (n === 8) b.status = "incomplete";
          return b;
        },
      }),
      r = await rejected(e, undefined, /unfinished/);
    assert.equal(e.store.ticket("T-401").revision, 2);
    assert.deepEqual(r.observedBusiness.changedTicketIds, ["T-401"]);
    assert.equal(r.observedBusiness.updates[0].after.status, "Resolved");
    assert.equal(r.calls.length, 8);
    assert.ok(r.cleanupConfirmed);
  },
);

for (const kind of ["browser", "native"])
  test(
    `one attempted failed ${kind} resource close retains saved update and reports failed completion`,
    { timeout: 30000 },
    async (t) => {
      const type = kind === "browser" ? BrowserSession : Native,
        original = type.prototype.close;
      let count = 0;
      type.prototype.close = async function () {
        count++;
        await original.call(this);
        if (kind === "browser") {
          this.closed = false;
          this.owner.receipt.data.lifecycle.browserClosed = false;
        } else this.closed = false;
        throw Error("controlled " + kind + " close failure");
      };
      try {
        const e = await environment(t),
          r = await rejected(e, undefined, /close failure/);
        assert.equal(count, 1);
        assert.equal(e.store.ticket("T-401").revision, 2);
        assert.equal(r.observedBusiness.updates.length, 1);
        assert.equal(r.cleanupConfirmed, false);
        assert.equal(r.lifecycle.sdkWorkDrained, true);
      } finally {
        type.prototype.close = original;
      }
    },
  );
for (const kind of ["conversation", "attachment"])
  test(
    `truncated ${kind} observation cannot authorize real browser Submit`,
    { timeout: 30000 },
    async (t) => {
      const { authorPolicy } = await import("../src/policy.js"),
        e = await environment(t, {
          mutate: (b, n, { store, file }) => {
            if (n === 1) {
              const s = store.read(),
                ticket = s.tickets[0];
              if (kind === "conversation")
                for (let i = 0; i < 4; i++)
                  ticket.messages.push({
                    at: `2026-10-15T10:0${i}:00Z`,
                    author: "Support",
                    text: "Long synthetic support note. ".repeat(120),
                  });
              else
                ticket.attachments[0].content =
                  "Long synthetic attachment. ".repeat(540);
              ticket.policy = authorPolicy(ticket, {
                requiredAddress: "48 Spadina Avenue, Unit 12, Toronto, ON",
                keepOpen: false,
              });
              fs.writeFileSync(file, JSON.stringify(s));
            }
            return b;
          },
        }),
        r = await rejected(e, undefined, /truncated/);
      assert.equal(e.store.ticket("T-401").revision, 1);
      assert.equal(r.observedBusiness.updates.length, 0);
      assert.ok(r.cleanupConfirmed);
    },
  );
test(
  "foreign browser redirect is rejected before delivering any private scope or request to that origin",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        wrap: (app) => (req, res) => {
          if (req.url === "/tickets/T-401" && req.method === "GET") {
            res.writeHead(302, { location: "https://outside.example/steal" });
            res.end();
          } else app(req, res);
        },
      }),
      r = await rejected(e, undefined, /boundary|blocked|net::/);
    assert.equal(r.blockedRequests[0].kind, "redirect");
    assert.equal(e.store.ticket("T-401").revision, 1);
    assert.equal(r.observedBusiness.updates.length, 0);
    assert.ok(r.cleanupConfirmed);
  },
);
