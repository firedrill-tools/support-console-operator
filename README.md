# Support console operator

A Vercel AI SDK agent uses browser tools to work through a local support console. The synthetic ticket data includes an address attachment superseded by a later customer correction, a restricted ticket, and a retryable form failure. The application uses actual Chromium browser actions and captures every page observation.

## Run locally

Requires Node 22+, npm and Playwright Chromium.

```sh
npm ci
npx playwright install chromium
cp fixtures/starter.json workspace.json
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

The portal's state is a local JSON file. T-401 can resolve only with the later corrected address and a reply containing that exact address. T-403 is inaccessible. T-402 rejects the first submit without changing the ticket; the operator can reload and retry. Every accepted update checks the ticket revision. The console has no real customer system, email delivery or authentication; run it only locally with synthetic data. Reset with `cp fixtures/starter.json workspace.json`.

`npm test` exercises the AI SDK loop with a scripted model, actual Chromium navigation and screenshots, the attachment/correction flow, a restricted record, a read-only run, failed browser submission, retry and mobile viewport. These are offline application proofs, not a live OpenAI model result. Live provider and new Firedrill integration proofs remain pending. This private repository has no license pending portfolio publication decisions.
