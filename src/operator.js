import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runOwnedOperator } from "./runtime.js";
export const runOperator = runOwnedOperator;
export async function main(args = process.argv.slice(2)) {
  const controller = new AbortController(),
    handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () =>
      controller.abort(Error(signal + " cancelled support operation"));
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    const { values } = parseArgs({
      args,
      options: {
        state: { type: "string" },
        task: { type: "string" },
        model: { type: "string" },
        "allow-writes": { type: "boolean" },
        "target-id": { type: "string" },
        "target-email": { type: "string" },
        "target-customer": { type: "string" },
        "provider-base-url": { type: "string" },
        "portal-url": { type: "string" },
        output: { type: "string" },
        "timeout-ms": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help || !args.length) {
      console.log(
        "support-operator --state FILE --task TEXT [--model MODEL] [--allow-writes --target-id ID --target-email EMAIL --target-customer CUSTOMER] [--provider-base-url PROVIDER_ORIGIN] [--portal-url LOOPBACK_ORIGIN] [--output DIRECTORY] [--timeout-ms MILLISECONDS]",
      );
      return;
    }
    const hasTarget = ["target-id", "target-email", "target-customer"].some(
        (k) => values[k] !== undefined,
      ),
      target = hasTarget
        ? {
            id: values["target-id"],
            email: values["target-email"],
            customer: values["target-customer"],
          }
        : undefined;
    const result = await runOperator(values.task, {
      statePath: values.state,
      model: values.model,
      allowWrites: values["allow-writes"] ?? false,
      target,
      providerBaseUrl: values["provider-base-url"],
      portalUrl: values["portal-url"],
      outputRoot: values.output,
      timeoutMs:
        values["timeout-ms"] === undefined
          ? undefined
          : Number(values["timeout-ms"]),
      signal: controller.signal,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: e.message,
          outputDir: e.outputDir ?? null,
          business: e.result?.observedBusiness ?? null,
          usage: e.result?.reportedUsage ?? null,
          cleanupConfirmed: e.result?.cleanupConfirmed ?? null,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  }
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
