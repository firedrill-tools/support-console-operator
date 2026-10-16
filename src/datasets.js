/** Hash-bound fictional imports and exclusive private model-free initialization. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  validateState,
  canonical,
  hash,
  identifier,
  revision,
  digest,
  utc,
} from "./schema.js";
import { parseJSON } from "./json.js";
import { DATASET_SHA256 } from "./_dataset-manifest.js";
export function readRegular(file, limit = 8 * 1024 * 1024) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
    throw Error("bounded regular source required");
  const raw = fs.readFileSync(file),
    after = fs.lstatSync(file);
  if (
    raw.length > limit ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    raw.length !== before.size
  )
    throw Error("source changed while reading");
  return raw;
}
const json = (file, limit) =>
  parseJSON(
    new TextDecoder("utf-8", { fatal: true }).decode(readRegular(file, limit)),
  );
const historySchema = z.strictObject({
  sequence: revision,
  at: utc,
  kind: z.literal("fictional_imported_support_audit"),
  target: identifier,
  source_audit_sha256: digest,
});
const provenanceSchema = z.strictObject({
  kind: z.literal("fictional_imported_support_snapshot"),
  prior_model_evidence: z.null(),
  prior_human_authentication: z.null(),
  prior_external_support_delivery: z.null(),
});
const populationSchema = z.strictObject({
  id: identifier,
  profile: z.enum(["starter", "busy", "ambiguous", "boundary"]),
  task: z.string().min(1).max(8000),
  state: z.unknown(),
  history: z.array(historySchema).max(16000),
  provenance: provenanceSchema,
});
const metadataSchema = z.strictObject({
  schema_version: z.literal(1),
  instance_id: z.string().uuid(),
  case_id: identifier,
  dataset_sha256: z.literal(DATASET_SHA256),
  seed_state_sha256: digest,
  created_at: utc,
  scope: z.literal("original_imported_seed_snapshot"),
});
export function validatePopulation(value) {
  const p = populationSchema.parse(value),
    state = validateState(p.state);
  if (state.instance_id || state.dataset || state.operations?.length)
    throw Error("imported seed cannot claim a runtime instance or operator");
  if (p.history.length !== state.audit.length)
    throw Error("imported history population differs from source audit");
  let previous = "";
  for (const [n, item] of p.history.entries()) {
    const a = state.audit[n];
    if (
      item.sequence !== n + 1 ||
      item.at < previous ||
      item.target !== a.ticket_id ||
      item.source_audit_sha256 !== hash(canonical(a))
    )
      throw Error("imported chronology differs from original audit");
    previous = item.at;
  }
  return { ...p, state };
}
let cached;
function registry() {
  const raw = readRegular(
    fileURLToPath(new URL("../data/index.json", import.meta.url)),
  );
  if (hash(raw) !== DATASET_SHA256)
    throw Error("population index differs from pinned original bytes");
  if (!cached) {
    const value = z
        .strictObject({
          id: z.literal("support-populations"),
          version: z.literal("1.0.0"),
          cases: z.array(z.unknown()).min(1).max(32),
        })
        .parse(
          parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        ),
      rows = value.cases.map(validatePopulation);
    if (
      new Set(rows.map((p) => p.id)).size !== rows.length ||
      new Set(rows.map((p) => p.profile)).size !== 4
    )
      throw Error("duplicate case or missing profile");
    cached = rows;
  }
  return cached;
}
export const populations = () => structuredClone(registry());
function population(id) {
  const p = registry().find((p) => p.id === id);
  if (!p) throw Error("unknown support case");
  return p;
}
export const listCases = () =>
  registry().map((p) => ({
    id: p.id,
    profile: p.profile,
    task: p.task,
    tickets: p.state.tickets.length,
    reads: p.state.reads?.length ?? 0,
    updates: p.state.updates?.length ?? 0,
    audit: p.state.audit.length,
    pending: p.state.reads?.filter((r) => r.status === "observed").length ?? 0,
  }));
export function authority(file, state) {
  const metadataFile = `${file}.source.json`;
  if (!state.dataset) {
    if (fs.existsSync(metadataFile))
      throw Error("managed source is missing its dataset reference");
    return null;
  }
  const metadata = metadataSchema.parse(json(metadataFile, 8192)),
    p = population(state.dataset.case_id);
  if (
    metadata.instance_id !== state.instance_id ||
    metadata.case_id !== state.dataset.case_id ||
    metadata.seed_state_sha256 !== hash(canonical(p.state))
  )
    throw Error("private source authority differs from original case/instance");
  return metadata;
}
export function inspect(file, state) {
  const metadata = authority(file, state),
    current = { ...state };
  delete current.instance_id;
  delete current.dataset;
  return {
    ok: true,
    path: path.resolve(file),
    instance_id: state.instance_id ?? null,
    case_id: state.dataset?.case_id ?? null,
    dataset_sha256: state.dataset?.source_sha256 ?? null,
    current_source_sha256: hash(readRegular(file)),
    original_seed_match: metadata
      ? hash(canonical(current)) === metadata.seed_state_sha256
      : null,
    history_scope:
      metadata?.scope ?? "legacy_source_without_imported_authority",
    provenance: metadata
      ? structuredClone(population(metadata.case_id).provenance)
      : null,
    state,
  };
}
function exclusive(file, value) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export function initialize(file, caseId = "corrected-address") {
  file = path.resolve(file);
  const p = population(caseId),
    meta = `${file}.source.json`,
    mutex = path.join(
      path.dirname(file),
      `.${path.basename(file)}.support-lock.sqlite`,
    );
  for (const candidate of [file, meta, mutex]) {
    try {
      fs.lstatSync(candidate);
      throw Error("private destination already exists; choose a fresh path");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const instance = randomUUID(),
    state = {
      ...structuredClone(p.state),
      instance_id: instance,
      dataset: {
        id: "support-populations",
        version: "1.0.0",
        case_id: caseId,
        source_sha256: DATASET_SHA256,
      },
    },
    metadata = {
      schema_version: 1,
      instance_id: instance,
      case_id: caseId,
      dataset_sha256: DATASET_SHA256,
      seed_state_sha256: hash(canonical(p.state)),
      created_at: new Date().toISOString(),
      scope: "original_imported_seed_snapshot",
    };
  validateState(state);
  metadataSchema.parse(metadata);
  // Two exclusive files are not a multi-file atomic transaction. Partial files
  // remain visible; retry at a fresh destination, never repair in place.
  exclusive(file, state);
  exclusive(meta, metadata);
  return inspect(file, state);
}
export function reset(file, destination) {
  if (path.resolve(file) === path.resolve(destination))
    throw Error("reset needs a distinct fresh destination");
  const state = validateState(json(file));
  authority(file, state);
  return initialize(destination, state.dataset?.case_id ?? "corrected-address");
}
