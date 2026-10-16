import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { Store } from "../src/state.js";
import { managedSeed } from "../src/policy.js";
import { startServer } from "../src/server.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-console-"));
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify(managedSeed()));
  return { dir, file, store: new Store(file) };
}
function submit(store, id, input) {
  const first = store.observeTicket(id);
  if (first.error) return { error: first.error };
  for (const a of first.ticket.policy.required_attachment_ids)
    store.observeAttachment(id, a);
  const read = store.observeTicket(id).read;
  return store.submit(id, {
    ...input,
    read_id: read.id,
    read_sha256: read.content_sha256,
  });
}
test("latest correction controls resolution; restricted and stale records are guarded", () => {
  const { store } = setup();
  const ticket = store.ticket("T-401");
  assert.match(ticket.attachments[0].content, /220 King Street/);
  assert.match(ticket.messages.at(-1).text, /48 Spadina Avenue/);
  const wrong = submit(store, "T-401", {
    revision: 1,
    address: "220 King Street West, Unit 5, Toronto, ON",
    reply:
      "We changed the address to 220 King Street West, Unit 5, Toronto, ON.",
    status: "Resolved",
  });
  assert.equal(wrong.error, "latest_address_required");
  assert.equal(submit(store, "T-403", { revision: 1 }).error, "access_denied");
  assert.equal(
    submit(store, "T-401", { revision: 0 }).error,
    "invalid_submit_arguments",
  );
  assert.equal(store.ticket("T-401").revision, 1);
  const read = store.observeTicket("T-401").read;
  store.correct(
    "T-401",
    {
      at: "2026-10-14T10:30:00Z",
      author: "Customer",
      text: "Please keep this ticket open while reviewing the address.",
    },
    { keepOpen: true },
    1,
  );
  assert.equal(
    store.submit("T-401", {
      read_id: read.id,
      read_sha256: read.content_sha256,
      revision: 1,
      address: "48 Spadina Avenue, Unit 12, Toronto, ON",
      reply: "We confirmed 48 Spadina Avenue, Unit 12, Toronto, ON.",
      status: "Resolved",
    }).error,
    "stale_revision",
  );
});

test("failed form submission leaves state unchanged and can be retried", () => {
  const { store } = setup();
  const input = {
    revision: 1,
    address: "8 Bay Street, Toronto, ON",
    reply:
      "We are investigating the return label and will keep this ticket open.",
    status: "Open",
  };
  assert.equal(submit(store, "T-402", input).error, "submit_failed_retryable");
  assert.equal(store.ticket("T-402").revision, 1);
  assert.equal(store.ticket("T-402").reply, "");
  assert.equal(submit(store, "T-402", input).ticket.revision, 2);
  assert.equal(store.ticket("T-402").status, "Open");
});

test("browser shows failed submit, supports retry, and remains usable at narrow width", async () => {
  const { file, store } = setup();
  const server = await startServer(file, 0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(`${baseUrl}/tickets/T-402`);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page
      .getByLabel("Customer reply")
      .fill(
        "We are investigating the return label and will keep this ticket open.",
      );
    await page.getByRole("button", { name: "Submit update" }).click();
    assert.match(
      await page.locator("[role=alert]").innerText(),
      /submit_failed_retryable/,
    );
    assert.equal(store.ticket("T-402").revision, 1);
    await page.getByRole("link", { name: "← Ticket" }).click();
    await page
      .getByLabel("Customer reply")
      .fill(
        "We are investigating the return label and will keep this ticket open.",
      );
    await page.getByRole("button", { name: "Submit update" }).click();
    assert.match(
      await page.locator("[role=status]").innerText(),
      /Ticket update saved/,
    );
    assert.equal(store.ticket("T-402").revision, 2);
    assert.equal(store.ticket("T-402").status, "Open");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
