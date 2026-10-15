import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { chromium } from "playwright";
import { Store } from "../src/state.js";
import { startServer } from "../src/server.js";
import { runOperator } from "../src/operator.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-console-")); const file = path.join(dir, "state.json"); fs.copyFileSync(path.join(root, "fixtures/starter.json"), file); return { dir, file, store: new Store(file) }; }
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
function scriptedModel(actions, onRound = () => {}) {
  let round = 0;
  return new MockLanguageModelV3({ doGenerate: async ({ prompt }) => {
    onRound(round, prompt);
    const action = actions[round++];
    return action ? { warnings: [], usage, finishReason: { raw: "tool_calls", unified: "tool-calls" },
      content: [{ type: "tool-call", toolCallType: "function", toolCallId: `call-${round}`, toolName: action[0], input: JSON.stringify(action[1]) }] }
      : { warnings: [], usage, finishReason: { raw: "stop", unified: "stop" }, content: [{ type: "text", text: "I checked the saved ticket." }] };
  } });
}

test("latest correction controls resolution; restricted and stale records are guarded", () => {
  const { store } = setup();
  const ticket = store.ticket("T-401");
  assert.match(ticket.attachments[0].content, /220 King Street/);
  assert.match(ticket.messages.at(-1).text, /48 Spadina Avenue/);
  const wrong = store.submit("T-401", { revision: 1, address: "220 King Street West, Unit 5, Toronto, ON", reply: "We changed the address to 220 King Street West, Unit 5, Toronto, ON.", status: "Resolved" });
  assert.equal(wrong.error, "correction_not_acknowledged");
  assert.equal(store.submit("T-403", { revision: 1 }).error, "access_denied");
  assert.equal(store.submit("T-401", { revision: 0 }).error, "stale_revision");
  assert.equal(store.ticket("T-401").revision, 1);
});

test("failed form submission leaves state unchanged and can be retried", () => {
  const { store } = setup();
  const input = { revision: 1, address: "8 Bay Street, Toronto, ON", reply: "We are investigating the return label and will keep this ticket open.", status: "Open" };
  assert.equal(store.submit("T-402", input).error, "submit_failed_retryable");
  assert.equal(store.ticket("T-402").revision, 1);
  assert.equal(store.ticket("T-402").reply, "");
  assert.equal(store.submit("T-402", input).ticket.revision, 2);
  assert.equal(store.ticket("T-402").status, "Open");
});

test("AI SDK tool loop drives real browser pages, reads attachment, and saves corrected ticket", async () => {
  const { dir, file, store } = setup();
  const server = await startServer(file, 0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const corrected = "48 Spadina Avenue, Unit 12, Toronto, ON";
  const actions = [
    ["browser_click", { role: "link", name: "Open T-401 →" }],
    ["browser_click", { role: "link", name: "Open address-note.txt →" }],
    ["browser_click", { role: "link", name: "← T-401" }],
    ["browser_fill", { label: "Delivery address", value: corrected }],
    ["browser_fill", { label: "Customer reply", value: `I confirmed the corrected delivery address is ${corrected}.` }],
    ["browser_select", { label: "Ticket status", option: "Resolved" }],
    ["browser_click", { role: "button", name: "Submit update" }],
  ];
  try {
    const inaccessible = await fetch(`${baseUrl}/tickets/T-403`);
    assert.equal(inaccessible.status, 403);
    assert.doesNotMatch(await inaccessible.text(), /Restricted account request/);
    const model = scriptedModel(actions, (round, prompt) => {
      if (round === 2) assert.match(JSON.stringify(prompt), /220 King Street West/);
      if (round === 3) assert.match(JSON.stringify(prompt), /Correction: the attached address is outdated/);
    });
    const { outputDir, result } = await runOperator("Resolve T-401 using Nora's latest correction", { baseUrl, model, allowWrites: true, outputRoot: dir });
    assert.equal(store.ticket("T-401").address, corrected);
    assert.equal(store.ticket("T-401").status, "Resolved");
    assert.equal(store.ticket("T-401").revision, 2);
    assert.equal(store.ticket("T-402").revision, 1);
    assert.match(result.finalUrl, /\/tickets\/T-401\?saved=1/);
    assert.match(result.trace.at(-1).text, /Ticket update saved/);
    assert.ok(result.toolNames.includes("browser_click"));
    assert.equal(fs.readdirSync(outputDir).filter((name) => name.endsWith(".png")).length, actions.length + 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "trace.json"))).response, "I checked the saved ticket.");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("read-only AI SDK run blocks final submit", async () => {
  const { dir, file, store } = setup();
  const server = await startServer(file, 0); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const model = scriptedModel([["browser_click", { role: "link", name: "Open T-401 →" }], ["browser_click", { role: "button", name: "Submit update" }]]);
    const { result } = await runOperator("Inspect T-401", { baseUrl, model, outputRoot: dir });
    assert.equal(store.ticket("T-401").revision, 1);
    assert.equal(result.toolNames.length, 2);
    assert.doesNotMatch(result.trace.at(-1).text, /Ticket update saved/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("browser shows failed submit, supports retry, and remains usable at narrow width", async () => {
  const { file, store } = setup();
  const server = await startServer(file, 0); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${baseUrl}/tickets/T-402`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.getByLabel("Customer reply").fill("We are investigating the return label and will keep this ticket open.");
    await page.getByRole("button", { name: "Submit update" }).click();
    assert.match(await page.locator("[role=alert]").innerText(), /submit_failed_retryable/);
    assert.equal(store.ticket("T-402").revision, 1);
    await page.getByRole("link", { name: "← Ticket" }).click();
    await page.getByLabel("Customer reply").fill("We are investigating the return label and will keep this ticket open.");
    await page.getByRole("button", { name: "Submit update" }).click();
    assert.match(await page.locator("[role=status]").innerText(), /Ticket update saved/);
    assert.equal(store.ticket("T-402").revision, 2);
    assert.equal(store.ticket("T-402").status, "Open");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
