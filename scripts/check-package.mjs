/** Fresh locked complete source and production-only CLI/native/browser proof. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "support-distribution-")),
  env = { ...process.env };
for (const k of Object.keys(env))
  if (
    [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL",
      "SUPPORT_PORTAL_URL",
      "SUPPORT_WORKSPACE_FILE",
      "PORT",
      "NODE_PATH",
      "NODE_OPTIONS",
      "NODE_TEST_CONTEXT",
    ].includes(k) ||
    k.toLowerCase() === "npm_config_allow_scripts"
  )
    delete env[k];
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  run = (cmd, args, cwd = temporary) =>
    execFileSync(cmd, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
const children = new Set();
let provider, portal;
function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
function child(args, extra = {}) {
  const processChild = spawn(process.execPath, args, {
    cwd: temporary,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  processChild.stdout.on("data", (b) => (out += b));
  processChild.stderr.on("data", (b) => (err += b));
  const done = new Promise((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("exit", (code, signal) =>
      resolve({ code, signal, out, err }),
    );
  });
  const entry = { process: processChild, done };
  children.add(entry);
  done.finally(() => children.delete(entry));
  return entry;
}
async function operator(cli, args, extra = {}) {
  const entry = child([cli, ...args], extra);
  return within(entry.done, 20000, "installed operator did not settle");
}
try {
  const source = JSON.parse(
      run(process.execPath, ["scripts/package.mjs"], root),
    ),
    repeat = path.join(temporary, "repeat.tar.gz");
  run(process.execPath, ["scripts/package.mjs", repeat], root);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(repeat));
  run("tar", ["-xzf", source.path, "-C", temporary]);
  const directory = path.join(temporary, "package"),
    manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "MANIFEST.json")),
    );
  const verify = () => {
    for (const row of manifest.files) {
      const file = path.join(directory, row.path),
        raw = fs.readFileSync(file);
      assert.equal(hash(raw), row.sha256, `delivered hash ${row.path}`);
      assert.equal(raw.length, row.size);
      assert.equal(fs.statSync(file).mode & 0o777, row.mode);
    }
  };
  const enumerated = [];
  function walk(file) {
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory())
      for (const n of fs.readdirSync(file)) walk(path.join(file, n));
    else enumerated.push(path.relative(directory, file));
  }
  walk(directory);
  assert.deepEqual(
    enumerated.sort(),
    [...manifest.files.map((r) => r.path), "MANIFEST.json"].sort(),
  );
  verify();
  run("npm", ["ci", "--no-audit", "--no-fund"], directory);
  const suite = run("npm", ["test"], directory);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/fresh-tests.log"), suite);
  assert.match(suite, /tests\s+88\b/);
  assert.match(suite, /fail\s+0\b/);
  console.log("Fresh locked complete source: 88 checks passed");
  run(process.execPath, ["scripts/build-datasets.mjs", "--check"], directory);
  const production = path.join(temporary, "production");
  fs.mkdirSync(production);
  for (const name of [
    "src",
    "public",
    "data",
    "fixtures",
    "package.json",
    "package-lock.json",
    "README.md",
    "AGENTS.md",
  ])
    fs.cpSync(path.join(directory, name), path.join(production, name), {
      recursive: true,
    });
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], production);
  const cli = path.join(production, "src/operator.js"),
    workspace = path.join(production, "src/workspace.js");
  assert.match(run(process.execPath, [cli, "--help"]), /support-operator/);
  assert.match(
    run(process.execPath, [workspace, "--help"]),
    /support-workspace/,
  );
  const operatorAlias = path.join(temporary, "operator-alias.js"),
    workspaceAlias = path.join(temporary, "workspace-alias.js");
  fs.symlinkSync(cli, operatorAlias);
  fs.symlinkSync(workspace, workspaceAlias);
  const cases = JSON.parse(
    run(process.execPath, [workspaceAlias, "list"]),
  ).cases;
  assert.equal(cases.length, 12);
  for (const c of cases) {
    const file = path.join(temporary, c.id, "state.json"),
      first = JSON.parse(
        run(process.execPath, [workspace, "init", file, "--case", c.id]),
      ),
      before = fs.readFileSync(file),
      metadata = fs.readFileSync(file + ".source.json"),
      read = JSON.parse(run(process.execPath, [workspace, "inspect", file]));
    assert.equal(read.original_seed_match, true);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const newer = JSON.parse(
      run(process.execPath, [workspace, "reset", file, file + ".fresh.json"]),
    );
    assert.notEqual(newer.instance_id, first.instance_id);
    assert.equal(newer.original_seed_match, true);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readFileSync(file + ".source.json"), metadata);
  }
  console.log(
    "Production-only install: all 12 private CLI initialization/read/reset checks passed",
  );
  const file = path.join(temporary, "corrected-address/state.json"),
    portalEntry = child([path.join(production, "src/server.js")], {
      SUPPORT_WORKSPACE_FILE: file,
      PORT: "0",
    });
  portal = portalEntry;
  let startup = "";
  const portalUrl = await within(
    Promise.race([
      new Promise((resolve) =>
        portalEntry.process.stdout.on("data", (b) => {
          startup += b;
          const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(startup);
          if (m) resolve(m[0]);
        }),
      ),
      portalEntry.done.then((r) => {
        throw Error("installed portal exited: " + r.out + r.err);
      }),
    ]),
    10000,
    "installed portal readiness timed out",
  );
  const address = "48 Spadina Avenue, Unit 12, Toronto, ON",
    requests = [],
    actions = [
      ["browser_click", { role: "link", name: "Open T-401 →" }],
      ["browser_click", { role: "link", name: "Open address-note.txt →" }],
      ["browser_click", { role: "link", name: "← T-401" }],
      ["browser_fill", { label: "Delivery address", value: address }],
      [
        "browser_fill",
        {
          label: "Customer reply",
          value: `Confirmed the current corrected delivery address: ${address}.`,
        },
      ],
      ["browser_select", { label: "Ticket status", option: "Resolved" }],
      ["browser_click", { role: "button", name: "Submit update" }],
    ];
  let pendingControl = null;
  provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      requests.push(body);
      assert.equal(req.url, "/v1/responses");
      assert.equal(req.headers.authorization, "Bearer synthetic-installed-key");
      assert.equal(body.model, "controlled-support");
      assert.equal(body.max_output_tokens, 4096);
      assert.equal(body.store, false);
      assert.equal(body.parallel_tool_calls, false);
      if (pendingControl) {
        pendingControl.entered();
        await pendingControl.held;
      }
      if (res.destroyed) return;
      const n =
          (body.input ?? []).filter((c) => c.type === "function_call_output")
            .length + 1,
        action = actions[n - 1];
      res.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": `request-${requests.length}`,
      });
      res.end(
        JSON.stringify({
          id: `response-${n}`,
          object: "response",
          created_at: 1792166400,
          status: "completed",
          model: "controlled-support",
          error: null,
          incomplete_details: null,
          output: action
            ? [
                {
                  id: `function-${n}`,
                  type: "function_call",
                  call_id: `call-${n}`,
                  name: action[0],
                  arguments: JSON.stringify(action[1]),
                  status: "completed",
                },
              ]
            : [
                {
                  id: `message-${n}`,
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "The exact fictional support update has been verified.",
                      annotations: [],
                    },
                  ],
                },
              ],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          unknown_original: true,
        }),
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const base = `http://127.0.0.1:${provider.address().port}/v1`,
    common = [
      "--state",
      file,
      "--model",
      "controlled-support",
      "--provider-base-url",
      base,
      "--portal-url",
      portalUrl,
    ],
    task =
      "Read exact current T-401 and its address attachment, then resolve using Nora’s latest correction.",
    normalRoot = path.join(temporary, "normal-receipts");
  const normal = await operator(
    operatorAlias,
    [
      ...common,
      "--allow-writes",
      "--target-id",
      "T-401",
      "--target-email",
      "nora@harbor.example",
      "--target-customer",
      "Nora Blake",
      "--output",
      normalRoot,
      "--task",
      task,
    ],
    { OPENAI_API_KEY: "synthetic-installed-key" },
  );
  assert.equal(normal.code, 0, normal.err + normal.out);
  const output = JSON.parse(normal.out).result;
  assert.equal(requests.length, 8);
  assert.deepEqual(output.business.changedTicketIds, ["T-401"]);
  assert.equal(output.business.currentTarget.address, address);
  assert.equal(output.business.currentTarget.status, "Resolved");
  assert.equal(output.usage.input.value, 80);
  assert.equal(output.costUsd, null);
  const trace = JSON.parse(fs.readFileSync(output.receiptPath)),
    observations = trace.observations;
  assert.equal(trace.cleanupConfirmed, true);
  assert.equal(trace.calls.length, 8);
  assert.ok(
    trace.calls.every(
      (c) =>
        c.response.body.unknown_original && c.reportedUsage.input.value === 10,
    ),
  );
  assert.equal(observations.length, 8);
  for (const o of observations) {
    assert.equal(hash(fs.readFileSync(o.screenshot)), o.screenshotSha256);
    assert.equal(fs.statSync(o.screenshot).mode & 0o777, 0o600);
  }
  assert.ok(!JSON.stringify(trace).includes("synthetic-installed-key"));
  assert.match(observations.at(-1).text, /Ticket update saved/);
  const screenshots = path.join(root, "dist/browser-results");
  fs.rmSync(screenshots, { recursive: true, force: true });
  fs.mkdirSync(screenshots, { recursive: true });
  for (const o of observations)
    fs.copyFileSync(
      o.screenshot,
      path.join(screenshots, path.basename(o.screenshot)),
    );
  const { chromium } = await import(
      pathToFileURL(path.join(production, "node_modules/playwright/index.mjs"))
        .href
    ),
    browser = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(portalUrl + "/tickets/T-401");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await page.getByLabel("Delivery address").inputValue(),
      address,
    );
    await page.screenshot({
      path: path.join(screenshots, "mobile-ticket.png"),
    });
  } finally {
    await browser.close();
  }
  const missingRoot = path.join(temporary, "missing-receipts"),
    missing = await operator(cli, [
      ...common,
      "--output",
      missingRoot,
      "--task",
      "Inspect the synthetic support queue",
    ]);
  assert.equal(missing.code, 1, missing.err + missing.out);
  const missingOutput = JSON.parse(missing.out);
  assert.equal(missingOutput.cleanupConfirmed, true);
  assert.equal(missingOutput.usage.input.value, null);
  assert.equal(requests.length, 8);
  const missingTrace = JSON.parse(
    fs.readFileSync(path.join(missingOutput.outputDir, "trace.json")),
  );
  assert.equal(missingTrace.calls.length, 0);
  assert.equal(missingTrace.status, "failed");
  for (const osSignal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    let entered, release;
    const pending = new Promise((r) => (entered = r)),
      held = new Promise((r) => (release = r));
    pendingControl = { entered, held };
    const signalRoot = path.join(temporary, osSignal + "-receipts"),
      signal = child(
        [
          cli,
          ...common,
          "--output",
          signalRoot,
          "--task",
          "Inspect the synthetic support queue",
        ],
        { OPENAI_API_KEY: "synthetic-installed-key" },
      );
    try {
      await within(
        Promise.race([
          pending,
          signal.done.then((r) => {
            throw Error("signal CLI exited early: " + r.out + r.err);
          }),
        ]),
        10000,
        "installed native pending HTTP was not reached",
      );
      signal.process.kill(osSignal);
      const cancelled = await within(
        signal.done,
        10000,
        "installed native CLI did not drain",
      );
      assert.equal(cancelled.code, 1, cancelled.err + cancelled.out);
      const cancelledOutput = JSON.parse(cancelled.out);
      assert.equal(cancelledOutput.cleanupConfirmed, true);
      assert.match(cancelledOutput.error, new RegExp(osSignal));
      assert.equal(cancelledOutput.usage.input.value, null);
    } finally {
      release();
      pendingControl = null;
    }
  }
  assert.equal(requests.length, 11);
  const state = JSON.parse(
    run(process.execPath, [workspace, "inspect", file]),
  ).state;
  assert.equal(state.audit.length, 1);
  assert.equal(state.tickets[0].revision, 2);
  assert.ok(state.operations.every((o) => o.status === "closed"));
  console.log(
    "Installed normal AI SDK CLI/native Responses/Chromium, missing-key receipt and all three signal drains passed",
  );
  portalEntry.process.kill("SIGTERM");
  await within(portalEntry.done, 5000, "portal did not exit");
  portal = null;
  verify();
  const rebuilt = path.join(temporary, "rebuilt.tar.gz");
  run(process.execPath, ["scripts/package.mjs", rebuilt], directory);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(rebuilt));
  const report = {
    ...source,
    checks:
      "fresh locked complete source/production-only dependencies outside checkout;88 source/native/real Chromium/CLI/dataset checks;12 private initialization/readback/reset cases;normal installed symlink CLI/actual AI SDK/OpenAI Responses HTTP/real portal/Chromium/captures and mobile viewport;missing-key receipt;SIGINT SIGTERM SIGHUP pending SDK HTTP drain;unchanged delivered manifest/repeated portable USTAR gzip bytes",
  };
  fs.writeFileSync(
    path.join(root, "dist/qualification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  for (const e of children) {
    e.process.kill("SIGKILL");
    await e.done.catch(() => {});
  }
  if (provider) {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
