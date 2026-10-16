import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  populations,
  listCases,
  initialize,
  inspect,
  reset,
  validatePopulation,
} from "../src/datasets.js";
import { Store } from "../src/state.js";
import { hash } from "../src/schema.js";
import { DATASET_SHA256 } from "../src/_dataset-manifest.js";
import { runOperator } from "../src/operator.js";
import { environment } from "./helpers.js";
const root = fileURLToPath(new URL("../", import.meta.url)),
  cli = path.join(root, "src/workspace.js");
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-datasets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function command(args) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    }),
  );
}
test("all twelve pinned populations have four profiles and reproducible full source/history", (t) => {
  const raw = fs.readFileSync(path.join(root, "data/index.json"));
  assert.equal(hash(raw), DATASET_SHA256);
  const rows = populations();
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map((p) => p.profile)).size, 4);
  const busy = rows.find((p) => p.profile === "busy");
  assert.equal(busy.state.tickets.length, 60);
  assert.equal(busy.state.reads.length, 48);
  assert.equal(busy.state.updates.length, 36);
  assert.equal(busy.state.corrections.length, 6);
  assert.equal(busy.history.length, 42);
  for (const p of rows) {
    assert.equal(p.provenance.prior_model_evidence, null);
    assert.equal(p.provenance.prior_external_support_delivery, null);
    assert.equal(p.state.instance_id, undefined);
    validatePopulation(p);
  }
  execFileSync(process.execPath, ["scripts/build-datasets.mjs", "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});
test("all actual private CLI cases initialize inspect and reset exclusively without any model key", (t) => {
  const dir = temporary(t);
  assert.equal(command(["list"]).cases.length, 12);
  for (const p of listCases()) {
    const file = path.join(dir, p.id, "state.json"),
      a = command(["init", file, "--case", p.id]),
      before = fs.readFileSync(file),
      meta = fs.readFileSync(file + ".source.json"),
      b = command(["inspect", file]),
      fresh = command(["reset", file, file + ".fresh.json"]);
    assert.equal(a.original_seed_match, true);
    assert.equal(b.original_seed_match, true);
    assert.equal(fresh.original_seed_match, true);
    assert.notEqual(a.instance_id, fresh.instance_id);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(file + ".source.json").mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readFileSync(file + ".source.json"), meta);
    assert.throws(() => initialize(file, p.id), /exists/);
  }
});
test("current valid support changes stay distinct from imported seed authority; reset preserves the old source and mutex", (t) => {
  const dir = temporary(t),
    file = path.join(dir, "state.json");
  initialize(file);
  const store = new Store(file),
    ticket = store.ticket("T-401");
  store.observeAttachment(ticket.id, "A-401");
  const read = store.observeTicket(ticket.id).read,
    result = store.submit(ticket.id, {
      read_id: read.id,
      read_sha256: read.content_sha256,
      revision: 1,
      address: ticket.policy.required_address,
      reply: `Confirmed ${ticket.policy.required_address}.`,
      status: "Resolved",
    });
  assert.equal(result.ticket.revision, 2);
  assert.equal(inspect(file, store.read()).original_seed_match, false);
  const before = fs.readFileSync(file),
    mutex = fs.readFileSync(store.lock),
    fresh = reset(file, file + ".fresh.json");
  assert.equal(fresh.original_seed_match, true);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readFileSync(store.lock), mutex);
  assert.equal(fresh.state.tickets[0].revision, 1);
});
test("missing foreign corrupt or stripped authority refuses managed source without repair", (t) => {
  const dir = temporary(t);
  for (const kind of ["missing", "foreign", "corrupt", "stripped"]) {
    const file = path.join(dir, kind + ".json");
    initialize(file);
    if (kind === "missing") fs.unlinkSync(file + ".source.json");
    if (kind === "foreign") {
      const x = JSON.parse(fs.readFileSync(file + ".source.json"));
      x.instance_id = "11111111-1111-4111-8111-111111111111";
      fs.writeFileSync(file + ".source.json", JSON.stringify(x));
    }
    if (kind === "corrupt")
      fs.writeFileSync(file + ".source.json", '{"broken":');
    if (kind === "stripped") {
      const x = JSON.parse(fs.readFileSync(file));
      delete x.dataset;
      fs.writeFileSync(file, JSON.stringify(x));
    }
    const before = fs.readFileSync(file);
    assert.throws(() => new Store(file));
    assert.throws(() => reset(file, file + ".fresh.json"));
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.existsSync(file + ".fresh.json"), false);
  }
});
test("invalid imported chronology/provenance and symlink or mutex collisions cannot become new workspaces", (t) => {
  const dir = temporary(t),
    p = populations().find((p) => p.profile === "busy");
  for (const change of [
    (x) => x.history.pop(),
    (x) => (x.history[0].source_audit_sha256 = "f".repeat(64)),
    (x) => (x.provenance.prior_model_evidence = "unverified"),
  ]) {
    const x = structuredClone(p);
    change(x);
    assert.throws(() => validatePopulation(x));
  }
  const file = path.join(dir, "collision.json"),
    lock = path.join(dir, ".collision.json.support-lock.sqlite");
  fs.writeFileSync(lock, "preserve");
  assert.throws(() => initialize(file), /exists/);
  assert.equal(fs.readFileSync(lock, "utf8"), "preserve");
  fs.unlinkSync(lock);
  fs.symlinkSync("missing-target", file);
  assert.throws(() => initialize(file), /exists/);
  assert.equal(fs.readlinkSync(file), "missing-target");
});
test("imported pending reads do not authorize writes inside a fresh runtime instance", (t) => {
  const file = path.join(temporary(t), "pending.json"),
    created = initialize(file, "changed-by-operator"),
    store = new Store(file),
    old = created.state.reads.find((r) => r.status === "observed");
  assert.equal(old.source.instance_id, null);
  assert.equal(
    store.submit("T-401", {
      read_id: old.id,
      read_sha256: old.content_sha256,
      revision: old.source.ticket.revision,
      address: old.source.ticket.address,
      reply: "This old imported read must not be reused.",
      status: "Open",
    }).error,
    "stale_revision",
  );
  assert.equal(store.ticket("T-401").revision, 2);
});
for (const p of populations())
  test(
    `actual native SDK and scoped Chromium qualify imported ${p.id}`,
    { timeout: 45000 },
    async (t) => {
      const readonly = [
          "review-only",
          "duplicate-customer",
          "restricted-ticket",
        ].includes(p.id),
        ticket = p.state.tickets.find(
          (t) => t.id === (p.id === "retryable-form" ? "T-402" : "T-401"),
        ),
        sequence = [];
      if (readonly) {
        if (p.id === "review-only")
          sequence.push(
            ["browser_click", { role: "link", name: "Open T-401 →" }],
            [
              "browser_click",
              { role: "link", name: "Open address-note.txt →" },
            ],
          );
      } else {
        sequence.push([
          "browser_click",
          { role: "link", name: `Open ${ticket.id} →` },
        ]);
        for (const a of ticket.attachments.filter((a) =>
          ticket.policy.required_attachment_ids.includes(a.id),
        ))
          sequence.push(
            ["browser_click", { role: "link", name: `Open ${a.name} →` }],
            ["browser_click", { role: "link", name: `← ${ticket.id}` }],
          );
        const address = ticket.policy.required_address ?? ticket.address,
          reply =
            p.id === "unchanged-ticket"
              ? ticket.reply
              : `Confirmed ${address}; the current synthetic customer instruction has been reviewed.`,
          status = ticket.policy.keep_open ? "Open" : "Resolved";
        sequence.push(
          ["browser_fill", { label: "Delivery address", value: address }],
          ["browser_fill", { label: "Customer reply", value: reply }],
          ["browser_select", { label: "Ticket status", option: status }],
          ["browser_click", { role: "button", name: "Submit update" }],
        );
      }
      const e = await environment(t, { caseId: p.id, sequence }),
        options = {
          ...e.options,
          allowWrites: !readonly,
          target: readonly
            ? undefined
            : { id: ticket.id, customer: ticket.customer, email: ticket.email },
        },
        before = e.store.read(),
        expectedFailure = ["retryable-form", "maximum-revision"].includes(p.id);
      if (expectedFailure) {
        await assert.rejects(runOperator(p.task, options), (error) => {
          assert.match(
            error.message,
            p.id === "retryable-form"
              ? /submit_failed_retryable/
              : /revision_exhausted/,
          );
          assert.equal(error.result.observedBusiness.updates.length, 0);
          assert.ok(error.result.cleanupConfirmed);
          return true;
        });
        assert.equal(e.store.ticket(ticket.id).revision, ticket.revision);
      } else {
        const { result } = await runOperator(p.task, options);
        assert.ok(result.cleanupConfirmed);
        if (readonly) {
          assert.deepEqual(e.store.read().tickets, before.tickets);
          assert.equal(result.business.updates.length, 0);
          if (p.id === "restricted-ticket")
            assert.doesNotMatch(
              JSON.stringify(e.requests),
              /Restricted account request/,
            );
        } else if (p.id === "unchanged-ticket") {
          assert.equal(result.business.updates.length, 0);
          assert.equal(result.business.unchangedReadIds.length, 1);
          assert.deepEqual(e.store.read().tickets, before.tickets);
        } else {
          assert.equal(e.store.ticket(ticket.id).revision, ticket.revision + 1);
          assert.equal(
            e.store.ticket(ticket.id).address,
            ticket.policy.required_address ?? ticket.address,
          );
          assert.equal(result.business.updates.length, 1);
          assert.deepEqual(
            e.store.read().tickets.filter((t) => t.id !== ticket.id),
            before.tickets.filter((t) => t.id !== ticket.id),
          );
        }
        assert.equal(
          inspect(e.file, e.store.read()).original_seed_match,
          false,
        );
      }
    },
  );
