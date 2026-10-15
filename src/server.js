import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./state.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Relay Support</title><link rel="stylesheet" href="/assets/style.css"></head><body><header><a class="brand" href="/">RELAY <span>/ SUPPORT</span></a><span class="header-right">LOCAL TICKET CONSOLE</span></header><main>${body}</main></body></html>`;

export function createApp(file) {
  const store = new Store(file); const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use("/assets", express.static(path.join(root, "public")));
  app.get("/", (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const tickets = store.read().tickets.filter((ticket) => !q || `${ticket.id} ${ticket.customer} ${ticket.email} ${ticket.subject}`.toLowerCase().includes(q));
    const rows = tickets.map((ticket) => `<tr><td><strong>${esc(ticket.id)}</strong><small>${esc(ticket.customer)}</small></td><td>${esc(ticket.subject)}</td><td>${esc(ticket.email)}</td><td><span class="status">${esc(ticket.status)}</span></td><td><a href="/tickets/${encodeURIComponent(ticket.id)}">Open ${esc(ticket.id)} →</a></td></tr>`).join("");
    res.send(layout("Tickets", `<div class="eyebrow">INBOX / TICKETS</div><h1>Resolve with the full record.</h1><p class="intro">Review the conversation, attachments and the latest customer correction before saving.</p><form method="get" class="search"><label for="query">Search tickets</label><div><input id="query" name="q" value="${esc(req.query.q || "")}" placeholder="Ticket ID, customer, or subject"><button>Search</button></div></form><div class="table-head"><h2>Queue</h2><span>${tickets.length} tickets</span></div><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Subject</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No matching tickets</td></tr>'}</tbody></table></div>`));
  });
  app.get("/tickets/:id", (req, res) => {
    const ticket = store.ticket(req.params.id);
    if (!ticket) return res.status(404).send(layout("Not found", '<div role="alert" class="warning"><h1>Ticket not found</h1></div>'));
    if (!ticket.accessible) return res.status(403).send(layout("Access denied", `<a class="back" href="/">← Tickets</a><div role="alert" class="warning"><h1>Access denied</h1><p>${esc(ticket.id)} is restricted. No ticket details or update controls are available.</p></div>`));
    const messages = ticket.messages.map((item) => `<article class="message"><div><strong>${esc(item.author)}</strong><time>${esc(item.at)}</time></div><p>${esc(item.text)}</p></article>`).join("");
    const attachments = ticket.attachments.map((item) => `<li><a href="/tickets/${encodeURIComponent(ticket.id)}/attachments/${encodeURIComponent(item.id)}">Open ${esc(item.name)} →</a></li>`).join("");
    const status = ["Open", "Resolved"].map((option) => `<option ${option === ticket.status ? "selected" : ""}>${option}</option>`).join("");
    const saved = req.query.saved ? '<div role="status" class="notice">Ticket update saved. Check the current address, reply and revision below.</div>' : "";
    res.send(layout(ticket.subject, `<a class="back" href="/">← Tickets</a><div class="eyebrow">TICKET / ${esc(ticket.id)}</div><h1>${esc(ticket.subject)}</h1><p class="intro">${esc(ticket.customer)} · ${esc(ticket.email)} · Revision ${ticket.revision}</p>${saved}<div class="columns"><section><div class="panel"><div class="panel-head"><h2>Conversation</h2><span>${ticket.messages.length} MESSAGES</span></div>${messages}</div><div class="panel"><div class="panel-head"><h2>Attachments</h2><span>${ticket.attachments.length} FILES</span></div><ul>${attachments || "<li>None</li>"}</ul></div></section><section class="panel edit"><div class="panel-head"><h2>Resolution</h2><span>REVISION ${ticket.revision}</span></div><p class="hint">Save only after checking the latest customer message. A failed submit does not update the ticket.</p><form method="post" action="/tickets/${encodeURIComponent(ticket.id)}"><input type="hidden" name="revision" value="${ticket.revision}"><label for="address">Delivery address</label><input id="address" name="address" value="${esc(ticket.address)}" required><label for="reply">Customer reply</label><textarea id="reply" name="reply" rows="6" required>${esc(ticket.reply)}</textarea><label for="status">Ticket status</label><select id="status" name="status">${status}</select><button>Submit update</button></form></section></div>`));
  });
  app.get("/tickets/:id/attachments/:attachment", (req, res) => {
    const ticket = store.ticket(req.params.id);
    if (!ticket || !ticket.accessible) return res.status(403).send(layout("Access denied", '<div role="alert" class="warning"><h1>Attachment inaccessible</h1></div>'));
    const attachment = ticket.attachments.find((item) => item.id === req.params.attachment);
    if (!attachment) return res.status(404).send(layout("Not found", "<h1>Attachment not found</h1>"));
    res.send(layout(attachment.name, `<a class="back" href="/tickets/${encodeURIComponent(ticket.id)}">← ${esc(ticket.id)}</a><div class="eyebrow">ATTACHMENT / ${esc(attachment.id)}</div><h1>${esc(attachment.name)}</h1><div class="document">${esc(attachment.content)}</div><p class="hint">Compare this with later customer messages before acting.</p>`));
  });
  app.post("/tickets/:id", (req, res) => {
    const result = store.submit(req.params.id, req.body);
    if (result.error) {
      const code = result.error === "access_denied" ? 403 : result.error === "submit_failed_retryable" ? 503 : 409;
      return res.status(code).send(layout("Submit failed", `<a class="back" href="/tickets/${encodeURIComponent(req.params.id)}">← Ticket</a><div role="alert" class="warning"><h1>Update was not saved.</h1><p>${esc(result.error)}. Reopen the ticket and verify its current revision before retrying.</p></div>`));
    }
    res.redirect(303, `/tickets/${encodeURIComponent(req.params.id)}?saved=1`);
  });
  app.get("/api/state", (_req, res) => res.json(store.read()));
  return app;
}
export function startServer(file, port = 8787) { return new Promise((resolve) => { const server = createApp(file).listen(port, "127.0.0.1", () => resolve(server)); }); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(path.resolve(process.env.SUPPORT_WORKSPACE_FILE || "workspace.json"), Number(process.env.PORT || 8787)).then(() => console.log("Support console listening on 127.0.0.1"));
}
