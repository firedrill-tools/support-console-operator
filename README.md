# Support browser agent with Vercel AI SDK and Playwright

A browser-only support operator using actual Vercel AI SDK 7.0.141, OpenAI provider 4.0.94 and Playwright 1.64.1. A fictional support console includes attachments superseded by later customer corrections, keep-open requests, restricted tickets, duplicate customers and a transient form failure. Every browser observation has a private screenshot; model prose and observed saved effects are reported separately.

Simulate this Vercel AI SDK AI agent with [Firedrill](https://firedrill.run/), a simulation platform for AI agents. Start with the [Firedrill setup and simulation guide](firedrill/README.md); your coding agent can operate it while this application's runner stays in your repository or CI.

## Run locally

Node 22.13+ and Playwright Chromium are required.

```sh
npm ci
npx playwright install chromium
npm run workspace -- list
npm run init -- workspace.json --case corrected-address
npm run portal
```

Set `OPENAI_API_KEY` and an explicitly enabled `OPENAI_MODEL` in another terminal. Read-only is the default:

```sh
npm run operate -- --state workspace.json --task "Inspect T-401, its attachment and the latest customer correction. Report the current address without submitting."
```

An authorized synthetic update needs both the write flag and exact caller target:

```sh
npm run operate -- --state workspace.json \
  --task "Read T-401 and its attachment. Apply Nora's latest corrected address, confirm that address in the reply, and verify the saved ticket." \
  --allow-writes --target-id T-401 --target-customer "Nora Blake" \
  --target-email nora@harbor.example
```

`--portal-url` / `SUPPORT_PORTAL_URL` selects the exact HTTP loopback origin (default `http://127.0.0.1:8787`). `--state` / `SUPPORT_WORKSPACE_FILE` selects its local state file; the operator verifies it against the portal's original source. `--provider-base-url` / `OPENAI_BASE_URL` selects an HTTPS Responses endpoint or an owned HTTP loopback endpoint, with `/v1` only. No model is chosen or upgraded automatically. `--output` defaults to `artifacts`; `--timeout-ms` is 10–300000 (default 120000). Private run directories are 0700, original evidence and screenshots 0600. Receipts contain synthetic business content; store them privately.

The callable `runOperator(task, options)` supports those fields plus `apiKey` and an `AbortSignal`. Injected SDK clients/model objects are unsupported. Provider credentials remain outside browser tools, child browser environment, URLs and model observations.

## Source and save behavior

Managed tickets have an explicitly authored synthetic policy bound to the exact customer, email, conversation and attachment bytes. It declares the latest customer address, keep-open instruction and relevant attachments. This is fictional source authorship, not language understanding or real customer authentication. Submit rules consume that policy for every ticket ID. The unchanged original fixture remains readable only; it is never silently granted guessed write policy.

A save requires a genuine full current ticket read, relevant actual attachment observations, the exact caller ticket/customer/email, current source hash and instance, explicit write permission and current revision. Later corrections and keep-open instructions override older attachment text. Changed, unchanged and failed submissions have distinct source decisions and audit records. Revision exhaustion, altered identity/messages/attachment/policy, stale/replayed forms, wrong/closed scopes and missing attachment evidence reject without overwriting current business fields. Persistent SQLite locks serialize cooperating processes; flushed staged writes recheck original file bytes and inode. The files are not an OS security boundary against uncooperative writers.

A transient failure consumes its form read and only clears the synthetic failure marker. Address/reply/status/revision stay unchanged; the failure page visibly says unsaved. The operator stops. An explicit separate retry must reopen and read current state. A genuine saved receipt replaces query-string success claims. Read-only or another target's form cannot authorize Submit. Restricted contents stay out of queue/search/details and ordinary API reads. Human browser actions remain a separate synthetic local actor.

The loopback private controller marker is not authentication. There is no real support backend, customer login, email, order fulfillment or external delivery. Use synthetic data only.

## Native execution and evidence

The four model tools are `browser_inspect`, `browser_click`, `browser_fill` and `browser_select`, using exact visible controls only. Each run owns a fresh browser/context, private operation, Undici HTTP pools and actual AI SDK generation promise. Browser paths/methods and every redirect are qualified under that scope. Foreign/API network requests, arbitrary URLs, JavaScript, service workers, downloads, WebSockets and popups are blocked. Hidden source/policy/credential fields and private capture paths stay out of model observations. Truncated ticket/attachment observations cannot grant write authority.

Before the real SDK can eagerly execute a tool, the owned public provider fetch checks the original Responses root and item completion, errors/refusals, call ID, exact known name and strict duplicate-free arguments. Parallel, mixed, replayed, unknown, blank, incomplete and over-budget output fails closed. Completed original final text must match the actual SDK answer. No provider retry; at most 18 prepared requests/SDK steps, 4096 output tokens each, 30 seconds per native HTTP phase and the shared operation deadline. Requests retain up to 2 MiB and decoded native responses 1 MiB; an oversized response retains only an explicitly incomplete bounded prefix.

Receipts retain original request/response bytes and hashes, unknown native fields/IDs, original reported usage and SDK normalization separately. Missing, invalid and genuine zero counters differ; cost is unknown (`null`). These counters are not billing proof. Prepared/partial/failed evidence precedes key/resource checks. Earlier saved changes survive a later native, source, recording or cleanup failure in the report; unknown final source or evidence durability remains unknown. Cancellation/deadline and SIGINT/SIGTERM/SIGHUP drain actual pending work and close write authority before cleanup. Failed close is attempted once and reported honestly. Final model prose is not a saved-effect receipt or customer delivery acknowledgment.

## Private populations and reset

Twelve hash-bound cases span starter, busy, ambiguous and boundary profiles. The busy queue contains 60 tickets, 48 reads, 36 attachment reads, 36 prior updates, six corrections, 12 pending reads and 42 audit entries. These are coherent fictional imports built through the actual Store; prior model evidence, human authentication and external support delivery remain unknown. `npm run datasets:check` reproduces original population bytes. See [data/index.json](data/index.json).

```sh
npm run workspace -- inspect workspace.json
npm run workspace -- reset workspace.json another-private-workspace.json
```

Initialization/reset require a fresh destination and create a fresh UUID plus private seed-authority sidecar. Reset preserves the old source, mutex and receipts. Missing/corrupt/foreign source authority, collisions and invalid original population bytes reject without repair. Source and sidecar are two exclusive files, not a multi-file atomic transaction; a partial creation stays visible and needs a fresh destination. A valid current edit is distinct from an original seed match. Imported pending reads cannot authorize a fresh instance. The model-free commands need no provider key.

## Verification and remaining integration

`npm test` uses the actual pinned SDK/OpenAI provider with synthetic keys and an owned loopback Responses endpoint, actual portal and Chromium, original native faults, process races, save/failed form scope, lifecycle/CLI signals and all twelve populations. No paid provider or real customer is used. Scripted native responses qualify the local boundary; live model judgment and billing are separate external gates.

`npm run package:check` qualifies a fresh complete locked source and independent production-only install outside the checkout, actual installed CLI/browser/captures/mobile viewport, private CLI cases, missing-key evidence, all three signals, unchanged manifest and repeated portable source bytes. [PLAN.md](PLAN.md) and [COMPATIBILITY.md](COMPATIBILITY.md) record exact qualification.

Live enabled model/key/budget and human semantic/billing review, authenticated Firedrill scenario/run persistence verification, actual support/email/authentication and publication/license decisions remain parked. This private repository has no publication license yet. [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog).

## Current Firedrill integration

Released CLI/SDK 2.2.2, current command invocation, remote operator MCP and recovery are documented in [firedrill/README.md](firedrill/README.md). Offline checks preserve the actual portal/native key boundary and existing independent permissions. Authenticated persisted runs and live quality/cost remain separate parked gates.
