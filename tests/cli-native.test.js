import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { environment } from "./helpers.js";
const cli = fileURLToPath(new URL("../src/operator.js", import.meta.url));
function start(e, { permission = true } = {}) {
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
      "PLAYWRIGHT_BROWSERS_PATH",
      "SystemRoot",
      "WINDIR",
    ]
      .filter((k) => typeof process.env[k] === "string")
      .map((k) => [k, process.env[k]]),
  );
  env.OPENAI_API_KEY = "synthetic-support-owned-key";
  const child = spawn(
    process.execPath,
    [
      cli,
      "--state",
      e.file,
      "--task",
      "Read the exact current T-401 conversation and attachment, then use the latest correction.",
      "--model",
      e.options.model,
      "--provider-base-url",
      e.options.providerBaseUrl,
      "--portal-url",
      e.options.portalUrl,
      "--output",
      e.directory,
      ...(permission
        ? [
            "--allow-writes",
            "--target-id",
            "T-401",
            "--target-email",
            "nora@harbor.example",
            "--target-customer",
            "Nora Blake",
          ]
        : []),
    ],
    { env, cwd: e.directory, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (err += b));
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
  return { child, done };
}
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("bounded CLI wait expired")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
test(
  "normal real operator CLI owns actual AI SDK/native HTTP/Chromium and exact saved effect",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      { child, done } = start(e);
    try {
      const r = await within(done, 20000);
      assert.equal(r.code, 0, r.err + r.out);
      const output = JSON.parse(r.out).result;
      assert.deepEqual(output.business.changedTicketIds, ["T-401"]);
      assert.equal(output.business.currentTarget.revision, 2);
      assert.equal(output.usage.input.value, 80);
      assert.equal(output.costUsd, null);
      const receipt = JSON.parse(fs.readFileSync(output.receiptPath));
      assert.ok(receipt.cleanupConfirmed);
      assert.equal(receipt.observations.length, 8);
      assert.equal(e.requests.length, 8);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await done;
    }
  },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  test(
    `normal CLI ${signal} drains actual native HTTP and browser and closes write scope`,
    { timeout: 30000 },
    async (t) => {
      let entered, release;
      const ready = new Promise((r) => (entered = r)),
        held = new Promise((r) => (release = r)),
        e = await environment(t, {
          mutate: async (b) => {
            entered();
            await held;
            return b;
          },
        }),
        { child, done } = start(e, { permission: false });
      try {
        await within(
          Promise.race([
            ready,
            done.then((r) => {
              throw Error("CLI exited before native HTTP: " + r.out + r.err);
            }),
          ]),
          10000,
        );
        child.kill(signal);
        const r = await within(done, 10000);
        assert.equal(r.code, 1, r.err + r.out);
        const output = JSON.parse(r.out);
        assert.equal(output.ok, false);
        assert.match(output.error, new RegExp(signal));
        assert.equal(output.cleanupConfirmed, true);
        assert.equal(output.usage.input.value, null);
        assert.equal(e.store.read().audit.length, 0);
        assert.equal(e.store.read().operations[0].status, "closed");
        assert.equal(e.requests.length, 1);
      } finally {
        release();
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await done;
      }
    },
  );
