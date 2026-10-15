import fs from "node:fs";
import path from "node:path";

export class Store {
  constructor(file) {
    this.file = path.resolve(file);
    if (!fs.existsSync(this.file)) throw new Error(`workspace file missing: ${this.file}; copy fixtures/starter.json first`);
    this.read();
  }
  read() {
    const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (!Array.isArray(data.tickets) || !Array.isArray(data.audit)) throw new Error("invalid support workspace");
    return data;
  }
  write(data) {
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temp, this.file);
  }
  ticket(id) { return this.read().tickets.find((item) => item.id === id); }
  submit(id, input) {
    const data = this.read();
    const ticket = data.tickets.find((item) => item.id === id);
    if (!ticket) return { error: "ticket_not_found" };
    if (!ticket.accessible) return { error: "access_denied" };
    if (Number(input.revision) !== ticket.revision) return { error: "stale_revision" };
    if (ticket.failNextSubmit) {
      ticket.failNextSubmit = false;
      data.audit.push({ ticketId: id, event: "transient_submission_failure" });
      this.write(data);
      return { error: "submit_failed_retryable" };
    }
    const address = String(input.address || "").trim();
    const reply = String(input.reply || "").trim();
    const status = String(input.status || "");
    if (!address || address.length > 160 || reply.length < 15 || reply.length > 1000 || !["Open", "Resolved"].includes(status)) return { error: "invalid_form" };
    if (ticket.id === "T-401" && status === "Resolved" && (!reply.includes(address) || address !== "48 Spadina Avenue, Unit 12, Toronto, ON")) return { error: "correction_not_acknowledged" };
    ticket.address = address;
    ticket.reply = reply;
    ticket.status = status;
    ticket.revision += 1;
    data.audit.push({ ticketId: id, event: "submitted", address, status, revision: ticket.revision });
    this.write(data);
    return { ticket };
  }
}
