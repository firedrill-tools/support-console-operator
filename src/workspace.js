import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Store } from "./state.js";
import { initialize, inspect, listCases, reset } from "./datasets.js";
export function main(args = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { case: { type: "string" }, help: { type: "boolean" } },
    });
    let result;
    if (values.help) {
      console.log(
        "support-workspace list | init FILE [--case CASE] | inspect FILE | reset OLD_FILE NEW_FILE",
      );
      return;
    }
    const [command, file, destination] = positionals;
    if (command === "list" && positionals.length === 1 && !values.case)
      result = { cases: listCases() };
    else if (command === "init" && positionals.length === 2)
      result = initialize(file, values.case);
    else if (
      command === "inspect" &&
      positionals.length === 2 &&
      !values.case
    ) {
      const store = new Store(file);
      result = inspect(store.file, store.read());
    } else if (command === "reset" && positionals.length === 3 && !values.case)
      result = reset(file, destination);
    else
      throw Error(
        "use list, init FILE [--case CASE], inspect FILE or reset OLD_FILE NEW_FILE",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
