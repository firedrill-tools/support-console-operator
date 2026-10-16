/** Explicit model-free authoring of the unchanged fixture into managed data. */
import fs from "node:fs";
import { ORIGINAL_FIXTURE_SHA256 } from "./_seed-manifest.js";
import { hash, instructionHash, validateState } from "./schema.js";
export function authorPolicy(
  ticket,
  {
    requiredAddress = null,
    keepOpen = true,
    requiredAttachments = ticket.attachments.map((a) => a.id),
  } = {},
) {
  const customerIndices = ticket.messages.flatMap((m, n) =>
    m.author === "Customer" ? [n] : [],
  );
  return {
    declared_by: "synthetic_fixture_author",
    instruction_sha256: instructionHash(ticket),
    latest_customer_index: customerIndices.at(-1) ?? null,
    required_address: requiredAddress,
    keep_open: keepOpen,
    required_attachment_ids: structuredClone(requiredAttachments),
  };
}
export function managedSeed() {
  const raw = fs.readFileSync(
    new URL("../fixtures/starter.json", import.meta.url),
  );
  if (hash(raw) !== ORIGINAL_FIXTURE_SHA256)
    throw Error("original synthetic fixture bytes changed");
  const state = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  state.synthetic = true;
  state.version = 1;
  // These declarations author this known fictional source. Runtime submit rules
  // consume source policy for every ID; they never branch on a ticket ID.
  const declarations = [
    {
      requiredAddress: "48 Spadina Avenue, Unit 12, Toronto, ON",
      keepOpen: false,
    },
    { requiredAddress: null, keepOpen: true },
    { requiredAddress: null, keepOpen: true },
  ];
  for (const [n, ticket] of state.tickets.entries())
    ticket.policy = authorPolicy(ticket, declarations[n]);
  return validateState(state);
}
