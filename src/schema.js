import { z } from "zod";
import { createHash } from "node:crypto";
import { ORIGINAL_CORE_SHA256 } from "./_seed-manifest.js";
import { DATASET_SHA256 } from "./_dataset-manifest.js";
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  .refine((v) => {
    const d = new Date(v);
    return (
      Number.isFinite(d.valueOf()) &&
      d.toISOString().replace(".000Z", "Z") === v.replace(".000Z", "Z")
    );
  }, "valid exact UTC instant required");
export const line = (max) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) => !!v.trim() && v.isWellFormed() && !/[\x00-\x1f\x7f]/.test(v),
    );
export const prose = (min, max) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v.isWellFormed() && !v.includes("\0"));
export const email = z
  .string()
  .min(3)
  .max(254)
  .regex(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.example$/,
  )
  .refine((v) => {
    const local = v.split("@")[0];
    return (
      local.length <= 64 &&
      !local.startsWith(".") &&
      !local.endsWith(".") &&
      !local.includes("..")
    );
  });
export const status = z.enum(["Open", "Resolved"]);
const messageSchema = z.strictObject({
    at: utc,
    author: z.enum(["Customer", "Support", "System"]),
    text: prose(1, 4000),
  }),
  attachmentSchema = z.strictObject({
    id: identifier,
    name: line(160),
    content: prose(1, 16000),
  });
export const policySchema = z.strictObject({
  declared_by: z.literal("synthetic_fixture_author"),
  instruction_sha256: digest,
  latest_customer_index: z.number().int().min(0).max(79).nullable(),
  required_address: line(160).nullable(),
  keep_open: z.boolean(),
  required_attachment_ids: z.array(identifier).max(24),
});
export const ticketSchema = z.strictObject({
  id: identifier,
  customer: line(160),
  email,
  subject: line(240),
  status,
  address: line(160),
  revision,
  accessible: z.boolean(),
  failNextSubmit: z.boolean(),
  messages: z.array(messageSchema).max(80),
  attachments: z.array(attachmentSchema).max(24),
  reply: prose(0, 1000),
  policy: policySchema.optional(),
});
export const targetSchema = z.strictObject({
  id: identifier,
  customer: line(160),
  email,
});
export const sourceSchema = z.strictObject({
  instance_id: z.string().uuid().nullable(),
  ticket: ticketSchema,
});
export const scopeSchema = z.strictObject({
  kind: z.enum(["operator", "synthetic_human"]),
  operation_id: z.string().uuid().nullable(),
  task_sha256: digest.nullable(),
  allow_writes: z.boolean(),
  target: targetSchema.nullable(),
});
const operationSchema = z.strictObject({
  id: z.string().uuid(),
  credential_sha256: digest,
  task_sha256: digest,
  allow_writes: z.boolean(),
  target: targetSchema.nullable(),
  status: z.enum(["active", "closed"]),
});
export const attemptSchema = z.strictObject({
  address: line(160),
  reply: prose(15, 1000).refine((v) => v.trim().length >= 15),
  status,
});
const instructionSourceSchema = z.strictObject({
  customer: line(160),
  email,
  accessible: z.boolean(),
  messages: z.array(messageSchema).max(80),
  attachments: z.array(attachmentSchema).max(24),
});
const decisionSchema = z.strictObject({
  attempt: attemptSchema,
  attachment_read_ids: z.array(z.string().uuid()).max(24),
  actor_kind: z.enum(["operator", "synthetic_human"]),
  operation_id: z.string().uuid().nullable(),
  task_sha256: digest.nullable(),
  read_sha256: digest,
  source: sourceSchema,
  after: ticketSchema,
  kind: z.enum(["changed", "unchanged", "transient_failure"]),
});
const readSchema = z.strictObject({
  id: z.string().uuid(),
  source: sourceSchema,
  scope: scopeSchema,
  content_sha256: digest,
  status: z.enum(["observed", "applied", "unchanged", "failed"]),
  decision: decisionSchema.nullable(),
});
const attachmentReadSchema = z.strictObject({
  id: z.string().uuid(),
  instance_id: z.string().uuid().nullable(),
  ticket_id: identifier,
  instruction_sha256: digest,
  instruction_source: instructionSourceSchema,
  attachment: attachmentSchema,
  scope: scopeSchema,
  content_sha256: digest,
});
const updateSchema = z.strictObject({
  id: identifier,
  read_id: z.string().uuid(),
  read_sha256: digest,
  ticket_id: identifier,
  before: ticketSchema,
  after: ticketSchema,
});
const failureSchema = z.strictObject({
  id: identifier,
  read_id: z.string().uuid(),
  read_sha256: digest,
  ticket_id: identifier,
  before: ticketSchema,
  after: ticketSchema,
  reason: z.literal("submit_failed_retryable"),
});
const correctionSchema = z.strictObject({
  id: identifier,
  source: sourceSchema,
  after: ticketSchema,
  declared_by: z.literal("synthetic_customer_source"),
});
const auditSchema = z.strictObject({
  sequence: revision,
  action: z.enum(["update", "unchanged", "transient_failure", "correction"]),
  ticket_id: identifier,
  read_id: z.string().uuid().nullable(),
  record_id: identifier.nullable(),
  before_sha256: digest,
  after_sha256: digest,
});
export const stateSchema = z.strictObject({
  synthetic: z.literal(true).optional(),
  version: z.literal(1).optional(),
  instance_id: z.string().uuid().optional(),
  dataset: z
    .strictObject({
      id: z.literal("support-populations"),
      version: z.literal("1.0.0"),
      case_id: identifier,
      source_sha256: z.literal(DATASET_SHA256),
    })
    .optional(),
  tickets: z.array(ticketSchema).min(1).max(2000),
  operations: z.array(operationSchema).max(512).optional(),
  reads: z.array(readSchema).max(4000).optional(),
  attachment_reads: z.array(attachmentReadSchema).max(4000).optional(),
  updates: z.array(updateSchema).max(2000).optional(),
  failures: z.array(failureSchema).max(2000).optional(),
  corrections: z.array(correctionSchema).max(2000).optional(),
  audit: z.array(auditSchema).max(12000),
});
export const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const hash = (v) => createHash("sha256").update(v).digest("hex"),
  same = (a, b) => canonical(a) === canonical(b),
  source = (state, ticket) =>
    structuredClone({ instance_id: state.instance_id ?? null, ticket });
export const instructionSource = (ticket) =>
  structuredClone({
    customer: ticket.customer,
    email: ticket.email,
    accessible: ticket.accessible,
    messages: ticket.messages,
    attachments: ticket.attachments,
  });
export const instructionHash = (ticket) =>
  hash(canonical(instructionSource(ticket)));
export const readHash = (r) =>
  hash(canonical({ id: r.id, source: r.source, scope: r.scope }));
export const attachmentReadHash = (r) =>
  hash(
    canonical({
      id: r.id,
      instance_id: r.instance_id,
      ticket_id: r.ticket_id,
      instruction_sha256: r.instruction_sha256,
      instruction_source: r.instruction_source,
      attachment: r.attachment,
      scope: r.scope,
    }),
  );
export const matches = (ticket, target) =>
  !!ticket &&
  !!target &&
  ticket.id === target.id &&
  ticket.customer === target.customer &&
  ticket.email === target.email;
export const managed = (state) =>
  state.synthetic === true && state.version === 1;
function unique(values, name) {
  if (new Set(values).size !== values.length) throw Error(`duplicate ${name}`);
}
export function validatePolicy(ticket) {
  const p = ticket.policy;
  if (!p) return;
  const indices = ticket.messages.flatMap((m, n) =>
      m.author === "Customer" ? [n] : [],
    ),
    latest = indices.at(-1) ?? null;
  if (
    p.instruction_sha256 !== instructionHash(ticket) ||
    p.latest_customer_index !== latest ||
    (latest === null && (!p.keep_open || p.required_address !== null)) ||
    (p.required_address !== null &&
      !ticket.messages[latest]?.text.includes(p.required_address))
  )
    throw Error(
      "customer policy differs from exact current instruction source",
    );
  unique(p.required_attachment_ids, "required attachment");
  if (
    p.required_attachment_ids.some(
      (id) => !ticket.attachments.some((a) => a.id === id),
    )
  )
    throw Error("customer policy references a missing attachment");
}
function validateTicket(ticket) {
  unique(
    ticket.attachments.map((a) => a.id),
    "attachment ID",
  );
  let prior = -Infinity;
  for (const m of ticket.messages) {
    const at = new Date(m.at).valueOf();
    if (at < prior) throw Error("conversation chronology is not ordered");
    prior = at;
  }
  validatePolicy(ticket);
}
function immutable(ticket) {
  const result = { ...ticket };
  for (const key of [
    "address",
    "reply",
    "status",
    "revision",
    "failNextSubmit",
  ])
    delete result[key];
  return result;
}
export function validateAttempt(ticket, attempt) {
  const p = ticket.policy;
  if (!p) throw Error("managed customer policy required for updates");
  attemptSchema.parse(attempt);
  if (p.keep_open && attempt.status !== "Open")
    throw Error("customer_requires_open");
  if (attempt.address !== (p.required_address ?? ticket.address))
    throw Error("latest_address_required");
  if (
    attempt.status === "Resolved" &&
    p.required_address !== null &&
    !attempt.reply.includes(p.required_address)
  )
    throw Error("correction_not_acknowledged");
}
export function validateState(value) {
  const state = stateSchema.parse(value),
    tickets = new Map(state.tickets.map((t) => [t.id, t])),
    ops = new Map((state.operations ?? []).map((o) => [o.id, o])),
    reads = new Map((state.reads ?? []).map((r) => [r.id, r])),
    updates = state.updates ?? [],
    failures = state.failures ?? [],
    corrections = state.corrections ?? [];
  if ((state.synthetic === undefined) !== (state.version === undefined))
    throw Error("synthetic/version header must be complete");
  if (
    !managed(state) &&
    (hash(canonical({ tickets: state.tickets, audit: state.audit })) !==
      ORIGINAL_CORE_SHA256 ||
      updates.length ||
      failures.length ||
      corrections.length ||
      (state.operations ?? []).some((o) => o.allow_writes))
  )
    throw Error(
      "legacy source is only the unchanged original fixture with read-only operations; initialize a managed workspace",
    );
  if (state.dataset && (!state.instance_id || !managed(state)))
    throw Error("dataset requires a managed runtime instance");
  if (managed(state) && state.tickets.some((t) => !t.policy))
    throw Error(
      "managed tickets require explicit source-bound customer policy",
    );
  for (const [name, rows] of [
    ["ticket", state.tickets],
    ["operation", state.operations ?? []],
    ["read", state.reads ?? []],
    ["attachment read", state.attachment_reads ?? []],
    ["update", updates],
    ["failure", failures],
    ["correction", corrections],
  ])
    unique(
      rows.map((r) => r.id),
      name + " ID",
    );
  unique(
    (state.operations ?? []).map((o) => o.credential_sha256),
    "operation credential",
  );
  unique(
    [...updates, ...failures].map((r) => r.read_id),
    "decided read",
  );
  for (const t of state.tickets) validateTicket(t);
  function scopeValid(scope) {
    const op = ops.get(scope.operation_id);
    if (
      scope.kind === "operator"
        ? !op ||
          scope.task_sha256 !== op.task_sha256 ||
          scope.allow_writes !== op.allow_writes ||
          !same(scope.target, op.target)
        : scope.operation_id !== null ||
          scope.task_sha256 !== null ||
          scope.allow_writes !== true ||
          scope.target !== null
    )
      throw Error("invalid observed source scope");
  }
  function instance(value, scope) {
    if (
      (value !== null && value !== (state.instance_id ?? null)) ||
      (scope?.kind === "operator" && value !== (state.instance_id ?? null))
    )
      throw Error("workspace instance changed in observed source");
  }
  for (const op of ops.values())
    if (op.allow_writes ? !op.target : op.target !== null)
      throw Error(
        "write authority requires exact structured ticket/customer target",
      );
  for (const r of reads.values()) {
    validateTicket(r.source.ticket);
    scopeValid(r.scope);
    instance(r.source.instance_id, r.scope);
    if (
      !tickets.has(r.source.ticket.id) ||
      !r.source.ticket.accessible ||
      r.content_sha256 !== readHash(r)
    )
      throw Error("ticket read differs from captured source/hash");
    const audits = state.audit.filter((a) => a.read_id === r.id),
      u = updates.filter((u) => u.read_id === r.id),
      f = failures.filter((f) => f.read_id === r.id);
    if (r.status === "observed") {
      if (r.decision || audits.length || u.length || f.length)
        throw Error("observed read cannot claim a saved update");
      continue;
    }
    const d = r.decision,
      op = ops.get(d?.operation_id);
    if (
      !d ||
      d.read_sha256 !== r.content_sha256 ||
      !same(d.source, r.source) ||
      !same(immutable(d.after), immutable(r.source.ticket)) ||
      audits.length !== 1
    )
      throw Error("invalid exact support decision");
    validateTicket(d.after);
    if (
      d.actor_kind === "operator"
        ? !op ||
          d.operation_id !== r.scope.operation_id ||
          d.task_sha256 !== r.scope.task_sha256 ||
          !op.allow_writes ||
          !r.scope.allow_writes ||
          !matches(r.source.ticket, op.target)
        : d.operation_id !== null || d.task_sha256 !== null
    )
      throw Error("support update lacked captured authority");
    validateAttempt(r.source.ticket, d.attempt);
    unique(d.attachment_read_ids, "decision attachment read");
    const required = r.source.ticket.policy.required_attachment_ids;
    if (
      d.attachment_read_ids.length !== required.length ||
      required.some(
        (id) =>
          !d.attachment_read_ids.some((proofId) => {
            const a = (state.attachment_reads ?? []).find(
              (a) => a.id === proofId,
            );
            return (
              a &&
              a.ticket_id === r.source.ticket.id &&
              a.instance_id === r.source.instance_id &&
              a.scope.kind === r.scope.kind &&
              a.scope.operation_id === r.scope.operation_id &&
              a.instruction_sha256 ===
                r.source.ticket.policy.instruction_sha256 &&
              a.attachment.id === id &&
              same(
                a.attachment,
                r.source.ticket.attachments.find((t) => t.id === id),
              )
            );
          }),
      )
    )
      throw Error(
        "decision lacks genuine current relevant attachment evidence",
      );
    if (
      r.status !== "failed" &&
      !same(d.attempt, {
        address: d.after.address,
        reply: d.after.reply,
        status: d.after.status,
      })
    )
      throw Error("saved fields differ from attempted values");
    if (r.status === "unchanged") {
      if (
        d.kind !== "unchanged" ||
        r.source.ticket.failNextSubmit ||
        u.length ||
        f.length ||
        !same(d.after, r.source.ticket)
      )
        throw Error("unchanged decision cannot claim a mutation");
    } else if (r.status === "failed") {
      const expected = { ...r.source.ticket, failNextSubmit: false };
      if (
        d.kind !== "transient_failure" ||
        !r.source.ticket.failNextSubmit ||
        u.length ||
        f.length !== 1 ||
        !same(d.after, expected)
      )
        throw Error("failed submission cannot claim a business update");
    } else if (
      d.kind !== "changed" ||
      r.source.ticket.failNextSubmit ||
      u.length !== 1 ||
      f.length ||
      r.source.ticket.revision === Number.MAX_SAFE_INTEGER ||
      d.after.revision !== r.source.ticket.revision + 1 ||
      d.after.failNextSubmit !== r.source.ticket.failNextSubmit ||
      (d.after.address === r.source.ticket.address &&
        d.after.reply === r.source.ticket.reply &&
        d.after.status === r.source.ticket.status) ||
      tickets.get(r.source.ticket.id).revision < d.after.revision
    )
      throw Error("applied support history is inconsistent");
  }
  for (const a of state.attachment_reads ?? []) {
    scopeValid(a.scope);
    instance(a.instance_id, a.scope);
    if (
      !tickets.has(a.ticket_id) ||
      !a.instruction_source.accessible ||
      a.instruction_sha256 !== hash(canonical(a.instruction_source)) ||
      !a.instruction_source.attachments.some((t) => same(t, a.attachment)) ||
      a.content_sha256 !== attachmentReadHash(a)
    )
      throw Error("attachment read differs from captured source/hash");
  }
  for (const record of [...updates, ...failures]) {
    const r = reads.get(record.read_id);
    if (
      !r ||
      record.ticket_id !== r.source.ticket.id ||
      record.read_sha256 !== r.content_sha256 ||
      !same(record.before, r.source.ticket) ||
      !same(record.after, r.decision?.after)
    )
      throw Error("support record differs from exact observed decision");
  }
  for (const c of corrections) {
    validateTicket(c.source.ticket);
    validateTicket(c.after);
    instance(c.source.instance_id);
    const before = { ...c.source.ticket },
      after = { ...c.after };
    for (const key of ["messages", "policy", "revision"]) {
      delete before[key];
      delete after[key];
    }
    if (
      !same(before, after) ||
      c.after.messages.length !== c.source.ticket.messages.length + 1 ||
      !same(c.after.messages.slice(0, -1), c.source.ticket.messages) ||
      c.after.messages.at(-1).author !== "Customer" ||
      (c.source.ticket.messages.length &&
        new Date(c.after.messages.at(-1).at) <=
          new Date(c.source.ticket.messages.at(-1).at)) ||
      c.source.ticket.revision === Number.MAX_SAFE_INTEGER ||
      c.after.revision !== c.source.ticket.revision + 1 ||
      !tickets.has(c.after.id) ||
      tickets.get(c.after.id).revision < c.after.revision ||
      state.audit.filter(
        (a) => a.action === "correction" && a.record_id === c.id,
      ).length !== 1
    )
      throw Error("invalid synthetic customer correction history");
  }
  for (const [n, a] of state.audit.entries()) {
    if (a.sequence !== n + 1 || !tickets.has(a.ticket_id))
      throw Error("audit chronology/target differs");
    const r = reads.get(a.read_id),
      c = corrections.find((c) => c.id === a.record_id);
    let before, after;
    if (a.action === "correction") {
      if (a.read_id !== null || !c || c.after.id !== a.ticket_id)
        throw Error("invalid correction audit");
      before = c.source;
      after = { instance_id: c.source.instance_id, ticket: c.after };
    } else {
      if (
        !r ||
        r.source.ticket.id !== a.ticket_id ||
        !r.decision ||
        (a.action === "update" &&
          (!updates.some((u) => u.id === a.record_id && u.read_id === r.id) ||
            r.status !== "applied")) ||
        (a.action === "transient_failure" &&
          (!failures.some((f) => f.id === a.record_id && f.read_id === r.id) ||
            r.status !== "failed")) ||
        (a.action === "unchanged" &&
          (a.record_id !== null || r.status !== "unchanged"))
      )
        throw Error("invalid support decision audit");
      before = r.source;
      after = { instance_id: r.source.instance_id, ticket: r.decision.after };
    }
    if (
      a.before_sha256 !== hash(canonical(before)) ||
      a.after_sha256 !== hash(canonical(after))
    )
      throw Error("audit hashes differ from original decision sources");
  }
  return state;
}
