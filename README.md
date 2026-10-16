# Support console operator

A Vercel AI SDK agent uses browser tools to work through a local support console. The synthetic ticket data includes an address attachment superseded by a later customer correction, a restricted ticket, and a retryable form failure. The application uses actual Chromium browser actions and captures every page observation.

## Run locally

Requires Node22.13+, npm and Playwright Chromium.

```sh
npm ci
npx playwright install chromium
npm run init -- workspace.json
npm run portal
```

In another terminal, set `OPENAI_API_KEY` and an enabled `OPENAI_MODEL`, then inspect without writes:

```sh
npm run operate -- --task "Inspect ticket T-401, its attachment and the latest customer correction. Report the address to use."
```

To allow a requested local update:

```sh
npm run operate -- --task "Resolve T-401 using Nora's latest corrected address. Confirm that address in the reply and verify the saved ticket." --allow-writes
```

`SUPPORT_PORTAL_URL` changes the local loopback portal address, and `SUPPORT_WORKSPACE_FILE` sets the portal's state path. The agent uses AI SDK `generateText` with a bounded tool loop and `browser_inspect`, `browser_click`, `browser_fill` and `browser_select`. Clicking **Submit update** is blocked without `--allow-writes`. Each run writes screenshots and `trace.json` under `artifacts/<run-id>/` with browser observations and the final model response.

The portal's state is a local JSON file. T-401 can resolve only with the later corrected address and a reply containing that exact address. T-403 is inaccessible. T-402 rejects the first submit without changing the ticket; the operator can reload and retry. Every accepted update checks the ticket revision. The console has no real customer system, email delivery or authentication; run it only locally with synthetic data. Reset with `npm run init -- workspace.json`.

`npm test` exercises the AI SDK loop with a scripted model, actual Chromium navigation and screenshots, the attachment/correction flow, a restricted record, a read-only run, failed browser submission, retry and mobile viewport. These are offline application proofs, not a live OpenAI model result. Live provider and new Firedrill integration proofs remain pending. This private repository has no license pending portfolio publication decisions.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.

## Development audit active

All5 original checks pass, but current source saves an obsolete hardcoded T-401 address after a newer correction/changed customer, ignores T-402 keep-open, accepts boolean revisions and overflows MAX revision. Actual pinned AI SDK/OpenAI HTTP also ignores original incomplete response/item status when reason metadata is absent, dispatches Submit update and saves; with a max-output reason it stops the save but returns a blank successful response. These controlled fault probes used actual SDK/provider transport and real Chromium, no paid provider or real customer. [PLAN.md](PLAN.md) defines current complete source/read/attachment/policy/target authority, owned native/browser/evidence/cleanup, rich populations/private CLI and fresh distribution. All fixes remain active; live semantics/billing/Firedrill/support connector/publication inputs stay parked.

### Source/portal checkpoint

The source layer now uses strict complete ticket/read/attachment/policy/scope/decision/update/failure/correction/audit contracts and current complete equality before a save. Source-bound authored customer policy replaces ticket-ID hardcoding: latest declared address and keep-open instruction win; genuine current relevant attachment reads are required. `init` explicitly authors the known unchanged fixture into fresh synthetic managed source with UUID (new directories0700/file0600, exclusive), without a model key. The unchanged original legacy fixture is readable only, with no guessed write policy; existing unbound/altered legacy source rejects without repair. Rich case/provenance/reset work follows. These synthetic author/controller markers are not real customer authentication.

Transient failure consumes the read, changes only its explicit failure marker and records an unsaved failure; a retry needs a fresh read. Actual updates and no-op decisions capture attempted fields, attachment proofs and full before/after, preserving unrelated records. Atomic flushed original-byte/inode checks plus persistent SQLite serialize cooperating processes; unsafe/coerced revisions/tampered/replayed reads/closed-wrong-target operations cannot overwrite. A synthetic human form remains a separate local actor. Queue/search/details and ordinary API requests do not disclose restricted contents; controller APIs require a local marker, not production authentication. Genuine saved receipts replace ?saved=1. Model observations omit hidden source hashes/tokens.

The old operator still opens an unscoped browser and lacks original native completion/usage/lifecycle guards. Source fixes do not qualify that native boundary: actual owned AI SDK/OpenAI/HTTP and mandatory scoped browser wiring are next, then rich populations/private CLI/fresh distribution. No paid provider or real customer/support action occurred.
