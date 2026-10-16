import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./state.js";
import { digest, targetSchema, managed, matches, same } from "./schema.js";
import { parseJSON } from "./json.js";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OWNER_HEADER = "synthetic-local-controller-v1";
const esc = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const layout = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Relay Support</title><link rel="stylesheet" href="/assets/style.css"></head><body><header><a class="brand" href="/">RELAY <span>/ SUPPORT</span></a><span class="header-right">LOCAL TICKET CONSOLE</span></header><main>${body}</main></body></html>`;
const errorPage = (reason, id = null) =>
  layout(
    "Update not saved",
    `<a class="back" href="${id ? "/tickets/" + encodeURIComponent(id) : "/"}">← ${id ? "Ticket" : "Tickets"}</a><div role="alert" class="warning"><h1>Update was not saved.</h1><p>${esc(reason)}. Reopen the ticket and verify its current source before retrying.</p></div>`,
  );
const registration = z.strictObject({
    task_sha256: digest,
    allow_writes: z.boolean(),
    target: targetSchema.nullable(),
  }),
  form = z.strictObject({
    read_id: z.string().uuid(),
    read_sha256: digest,
    revision: z
      .string()
      .regex(/^[1-9]\d{0,15}$/)
      .refine((v) => Number.isSafeInteger(Number(v))),
    address: z.string().max(160),
    reply: z.string().max(1000),
    status: z.enum(["Open", "Resolved"]),
  });
function credential(req) {
  const value = req.headers["x-support-operation"];
  if (value === undefined) return null;
  if (typeof value !== "string") throw Error("unknown_operation");
  return value;
}
function fields(raw) {
  const value = Object.create(null);
  if (!raw) return value;
  for (const pair of raw.split("&")) {
    const index = pair.indexOf("="),
      key = decodeURIComponent(
        (index < 0 ? pair : pair.slice(0, index)).replaceAll("+", " "),
      ),
      item = decodeURIComponent(
        (index < 0 ? "" : pair.slice(index + 1)).replaceAll("+", " "),
      );
    if (Object.hasOwn(value, key)) throw Error("duplicate field");
    value[key] = item;
  }
  return value;
}
function query(req, allowed) {
  const q = fields(new URL(req.originalUrl, "http://local").search.slice(1));
  if (Object.keys(q).some((k) => !allowed.includes(k)))
    throw Error("invalid_query");
  return q;
}
export function createApp(file) {
  const store = new Store(file),
    app = express();
  app.locals.store = store;
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    try {
      const host = new URL("http://" + req.headers.host);
      if (
        host.username ||
        host.password ||
        !["127.0.0.1", "localhost"].includes(host.hostname) ||
        Number(host.port || 80) !== req.socket.localPort ||
        host.pathname !== "/" ||
        host.search ||
        host.hash
      )
        throw Error("invalid_host");
      if (
        req.method === "POST" &&
        req.headers.origin &&
        req.headers.origin !== host.origin
      )
        throw Error("foreign_origin");
      next();
    } catch {
      res.status(403).send(errorPage("local_origin_required"));
    }
  });
  app.use(express.raw({ type: () => true, limit: "1mb" }));
  app.use((req, res, next) => {
    if (!Buffer.isBuffer(req.body)) return next();
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(req.body),
        type = (req.get("content-type") ?? "").split(";")[0];
      if (type === "application/json") req.body = parseJSON(raw);
      else if (type === "application/x-www-form-urlencoded")
        req.body = fields(raw);
      else throw Error("unsupported content type");
      next();
    } catch {
      res.status(400).send(errorPage("ambiguous_or_invalid_request"));
    }
  });
  app.use("/assets", express.static(path.join(root, "public")));
  // Synthetic local controller marker, not authentication. Model browser paths
  // never expose API routes or this application-owned header.
  app.use("/api", (req, res, next) =>
    req.headers["x-support-owner"] === OWNER_HEADER
      ? next()
      : res.status(403).send(errorPage("local_controller_required")),
  );
  app.post("/api/operator-sessions", (req, res) => {
    const b = registration.parse(req.body);
    res
      .status(201)
      .json(store.registerOperation(b.task_sha256, b.allow_writes, b.target));
  });
  app.post("/api/operator-sessions/close", (req, res) => {
    z.strictObject({}).parse(req.body);
    res.json(store.closeOperation(credential(req)));
  });
  app.get("/api/source", (req, res) => {
    const snap = store.snapshot();
    store.operation(snap.state, credential(req), true);
    res.json({
      synthetic: true,
      version: 1,
      instance_id: snap.state.instance_id ?? null,
      managed: managed(snap.state),
      sha256: snap.digest,
      body_base64: snap.bytes.toString("base64"),
    });
  });
  app.get("/api/state", (req, res) => {
    const state = store.read();
    store.operation(state, credential(req));
    res.json(state);
  });
  app.get("/", (req, res) => {
    const state = store.read();
    store.operation(state, credential(req));
    const q = query(req, ["q"]).q ?? "";
    if (q.length > 240 || /[\x00-\x1f\x7f]/.test(q))
      throw Error("invalid_search");
    const term = q.trim().toLowerCase(),
      tickets = state.tickets.filter(
        (t) =>
          !term ||
          (t.accessible
            ? `${t.id} ${t.customer} ${t.email} ${t.subject}`
            : t.id
          )
            .toLowerCase()
            .includes(term),
      ),
      rows = tickets
        .map(
          (t) =>
            `<tr><td><strong>${esc(t.id)}</strong><small>${t.accessible ? esc(t.customer) : "Restricted ticket"}</small></td><td>${t.accessible ? esc(t.subject) : "Restricted"}</td><td>${t.accessible ? esc(t.email) : "—"}</td><td><span class="status">${t.accessible ? esc(t.status) : "Restricted"}</span></td><td><a href="/tickets/${encodeURIComponent(t.id)}">Open ${esc(t.id)} →</a></td></tr>`,
        )
        .join("");
    res.send(
      layout(
        "Tickets",
        `<div class="eyebrow">INBOX / TICKETS</div><h1>Resolve with the full record.</h1><p class="intro">Review the conversation, attachments and the latest customer correction before saving.</p><form method="get" class="search"><label for="query">Search tickets</label><div><input id="query" name="q" value="${esc(q)}" placeholder="Ticket ID, customer, or subject"><button>Search</button></div></form><div class="table-head"><h2>Queue</h2><span>${tickets.length} tickets</span></div><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Subject</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No matching tickets</td></tr>'}</tbody></table></div>`,
      ),
    );
  });
  app.get("/tickets/:id", (req, res) => {
    const receipt = query(req, ["receipt"]).receipt,
      creds = credential(req),
      initial = store.read(),
      op = store.operation(initial, creds);
    if (receipt) {
      z.string().uuid().parse(receipt);
      const r = initial.reads?.find((r) => r.id === receipt);
      if (
        !r ||
        r.source.ticket.id !== req.params.id ||
        r.scope.operation_id !== (op?.id ?? null) ||
        !["applied", "unchanged"].includes(r.status) ||
        !r.decision
      )
        throw Error("unknown_saved_receipt");
    }
    const result = store.observeTicket(req.params.id, creds);
    if (result.error)
      return res
        .status(result.error === "access_denied" ? 403 : 404)
        .send(errorPage(result.error));
    const { ticket, read } = result,
      state = store.read(),
      current = store.operation(state, creds);
    let saved = "";
    if (receipt) {
      const prior = state.reads.find((r) => r.id === receipt);
      saved = same(prior.decision.after, ticket)
        ? `<div role="status" class="notice">${prior.status === "unchanged" ? "No ticket fields changed." : "Ticket update saved."} Check the current address, reply and revision below.</div>`
        : '<div role="status" class="notice">The earlier saved ticket has since changed. Review its current source.</div>';
    }
    const messages = ticket.messages
        .map(
          (m) =>
            `<article class="message"><div><strong>${esc(m.author)}</strong><time>${esc(m.at)}</time></div><p>${esc(m.text)}</p></article>`,
        )
        .join(""),
      attachments = ticket.attachments
        .map(
          (a) =>
            `<li><a href="/tickets/${encodeURIComponent(ticket.id)}/attachments/${encodeURIComponent(a.id)}">Open ${esc(a.name)} →</a></li>`,
        )
        .join(""),
      options = ["Open", "Resolved"]
        .map(
          (s) =>
            `<option ${s === ticket.status ? "selected" : ""}>${s}</option>`,
        )
        .join(""),
      allowed =
        managed(state) &&
        (!current || (current.allow_writes && matches(ticket, current.target))),
      missing = allowed && store.attachmentProofs(state, read).includes(null);
    const controls = allowed
      ? `<form method="post" action="/tickets/${encodeURIComponent(ticket.id)}"><input type="hidden" name="revision" value="${ticket.revision}"><input type="hidden" name="read_id" value="${read.id}"><input type="hidden" name="read_sha256" value="${read.content_sha256}"><label for="address">Delivery address</label><input id="address" name="address" value="${esc(ticket.address)}" required><label for="reply">Customer reply</label><textarea id="reply" name="reply" rows="6" required>${esc(ticket.reply)}</textarea><label for="status">Ticket status</label><select id="status" name="status">${options}</select>${missing ? '<p class="hint" role="status">Read the relevant attachments, then reopen this ticket before submitting.</p>' : ""}<button ${missing ? "disabled" : ""}>Submit update</button></form>`
      : '<div class="notice" role="status">Read only. This visit cannot update this ticket.</div>';
    res.send(
      layout(
        ticket.subject,
        `<a class="back" href="/">← Tickets</a><div class="eyebrow">TICKET / ${esc(ticket.id)}</div><h1>${esc(ticket.subject)}</h1><p class="intro">${esc(ticket.customer)} · ${esc(ticket.email)} · Revision ${ticket.revision}</p>${saved}<div class="columns"><section><div class="panel"><div class="panel-head"><h2>Conversation</h2><span>${ticket.messages.length} MESSAGES</span></div>${messages}</div><div class="panel"><div class="panel-head"><h2>Attachments</h2><span>${ticket.attachments.length} FILES</span></div><ul>${attachments || "<li>None</li>"}</ul></div></section><section class="panel edit"><div class="panel-head"><h2>Resolution</h2><span>REVISION ${ticket.revision}</span></div><p class="hint">Save only after checking the latest customer message. A failed submit does not update ticket fields.</p>${controls}</section></div>`,
      ),
    );
  });
  app.get("/tickets/:id/attachments/:attachment", (req, res) => {
    query(req, []);
    const result = store.observeAttachment(
      req.params.id,
      req.params.attachment,
      credential(req),
    );
    if (result.error)
      return res
        .status(result.error === "attachment_not_found" ? 404 : 403)
        .send(errorPage(result.error));
    const { attachment, read } = result;
    res.send(
      layout(
        attachment.name,
        `<a class="back" href="/tickets/${encodeURIComponent(req.params.id)}">← ${esc(req.params.id)}</a><div class="eyebrow">ATTACHMENT / ${esc(attachment.id)}</div><h1>${esc(attachment.name)}</h1><div class="document" data-attachment-read="${read.id}" data-attachment-sha256="${read.content_sha256}">${esc(attachment.content)}</div><p class="hint">Compare this with later customer messages before acting.</p>`,
      ),
    );
  });
  app.post("/tickets/:id", (req, res) => {
    const body = form.parse(req.body),
      result = store.submit(
        req.params.id,
        { ...body, revision: Number(body.revision) },
        credential(req),
      );
    if (result.error)
      return res
        .status(
          result.error === "access_denied"
            ? 403
            : result.error === "submit_failed_retryable"
              ? 503
              : 409,
        )
        .send(errorPage(result.error, req.params.id));
    res.redirect(
      303,
      `/tickets/${encodeURIComponent(req.params.id)}?receipt=${result.read_id}`,
    );
  });
  app.use((error, _req, res, _next) =>
    res
      .status(error.status === 413 ? 413 : 422)
      .send(
        errorPage(
          [
            "operation_closed",
            "unknown_operation",
            "revision_exhausted",
            "managed_workspace_required",
          ].includes(error?.message)
            ? error.message
            : "invalid_source_or_request",
        ),
      ),
  );
  return app;
}
export function startServer(file, port = 8787) {
  return new Promise((resolve, reject) => {
    const server = createApp(file).listen(port, "127.0.0.1", () =>
      resolve(server),
    );
    server.once("error", reject);
  });
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  startServer(
    path.resolve(process.env.SUPPORT_WORKSPACE_FILE || "workspace.json"),
    Number(process.env.PORT || 8787),
  )
    .then((server) =>
      console.log(
        `Support console on http://127.0.0.1:${server.address().port}`,
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
