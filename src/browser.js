import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { hash, same, matches } from "./schema.js";
import { argumentsFor } from "./native.js";
const allowedPath = (pathname, method) =>
  (method === "GET" &&
    /^\/$|^\/tickets\/[A-Za-z0-9_-]+(?:\/attachments\/[A-Za-z0-9_-]+)?$|^\/assets\/style\.css$/.test(
      pathname,
    )) ||
  (method === "POST" && /^\/tickets\/[A-Za-z0-9_-]+$/.test(pathname));
export class BrowserSession {
  constructor(origin, captureDir, owner) {
    Object.assign(this, { origin, captureDir, owner });
    this.browser = null;
    this.context = null;
    this.page = null;
    this.step = 0;
    this.trace = [];
    this.blocked = [];
    this.closeAttempted = false;
    this.closed = false;
    this.observedRead = null;
    this.observedAttachments = new Map();
  }
  block(kind, url) {
    const detail = { kind, url };
    this.blocked.push(detail);
    this.owner.failure ??= new Error(
      "browser blocked an operation outside its portal boundary",
    );
    this.owner.receipt.data.blockedRequests = this.blocked;
    try {
      this.owner.receipt.save();
    } catch {}
  }
  local(url, method = "GET") {
    const u = new URL(url);
    return (
      u.origin === this.origin &&
      !u.username &&
      !u.password &&
      allowedPath(u.pathname, method)
    );
  }
  async open() {
    this.owner.basicGuard();
    try {
      this.browser = await chromium.launch({
        headless: true,
        timeout: 10000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        env: Object.fromEntries(
          [
            "PATH",
            "HOME",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USER",
            "LOGNAME",
            "LANG",
            "LC_ALL",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "SystemRoot",
            "WINDIR",
          ]
            .filter((k) => typeof process.env[k] === "string")
            .map((k) => [k, process.env[k]]),
        ),
      });
      this.owner.receipt.data.lifecycle.browserAllocated = true;
      this.owner.basicGuard();
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: false,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      this.owner.receipt.data.lifecycle.contextAllocated = true;
      this.owner.basicGuard();
      this.context.setDefaultTimeout(4000);
      this.context.setDefaultNavigationTimeout(5000);
      this.abort = () => {
        this.cancelPromise ??= this.close();
        this.cancelPromise.catch((e) => {
          this.owner.failure ??= e;
        });
      };
      this.owner.signal.addEventListener("abort", this.abort, { once: true });
      if (this.owner.signal.aborted) this.abort();
      this.owner.basicGuard();
      await this.context.route("**/*", async (route) => {
        let response;
        try {
          const request = route.request();
          if (!this.local(request.url(), request.method())) {
            this.block("http", request.url());
            await route.abort("blockedbyclient");
            return;
          }
          this.owner.basicGuard();
          response = await route.fetch({
            headers: {
              ...request.headers(),
              "x-support-operation": this.owner.portal.credential,
            },
            maxRedirects: 0,
            timeout: Math.max(
              1,
              Math.min(
                5000,
                Math.ceil(this.owner.deadline - performance.now()),
              ),
            ),
          });
          let currentUrl = request.url();
          // Follow each qualified redirect ourselves, preserving the private scope.
          // Chromium receives the real final page without an uncontrolled redirect chain.
          for (let hop = 0; response.headers().location; hop++) {
            const location = new URL(response.headers().location, currentUrl)
              .href;
            if (
              hop >= 4 ||
              ![301, 302, 303, 307, 308].includes(response.status()) ||
              !this.local(location, "GET") ||
              (request.method() === "POST" &&
                hop === 0 &&
                response.status() !== 303)
            ) {
              this.block("redirect", location);
              await route.abort("blockedbyclient");
              return;
            }
            this.owner.basicGuard();
            await response.dispose();
            response = await this.context.request.get(location, {
              headers: { "x-support-operation": this.owner.portal.credential },
              maxRedirects: 0,
              timeout: Math.max(
                1,
                Math.min(
                  5000,
                  Math.ceil(this.owner.deadline - performance.now()),
                ),
              ),
            });
            currentUrl = location;
            this.lastRedirect = location;
            (this.owner.receipt.data.redirects ??= []).push({
              from: request.url(),
              to: location,
              method: "GET",
            });
          }
          if (response.status() >= 300 && response.status() < 400)
            throw Error("browser redirect lacks a qualified Location");
          if (
            response
              .headers()
              ["content-disposition"]?.toLowerCase()
              .includes("attachment")
          ) {
            this.block("download", currentUrl);
            await route.abort("blockedbyclient");
            return;
          }
          await route.fulfill({ response });
        } catch (e) {
          if (!this.owner.signal.aborted) {
            this.owner.failure ??= e;
            try {
              await route.abort("failed");
            } catch {}
          }
        } finally {
          await response?.dispose().catch(() => {});
        }
      });
      await this.context.routeWebSocket("**/*", (socket) => {
        this.block("websocket", socket.url());
        socket.close();
      });
      this.context.on("page", (page) => {
        if (this.page && page !== this.page) {
          this.block("popup", page.url());
          void page.close().catch(() => {});
        }
      });
      this.page = await this.context.newPage();
      this.page.on("download", (download) => {
        this.block("download", download.url());
        void download.cancel().catch(() => {});
      });
      this.page.on("dialog", (dialog) => {
        void dialog.dismiss().catch(() => {});
      });
      const initial = await this.page.goto(this.origin, {
        waitUntil: "domcontentloaded",
      });
      if (!initial || !initial.ok())
        throw new Error("portal startup did not return a successful page");
      await this.owner.guard();
      return this;
    } catch (e) {
      if (!this.closeAttempted)
        try {
          await this.close();
        } catch (close) {
          e.cleanupError = close.message;
        }
      else await this.cancelPromise?.catch(() => {});
      throw e;
    }
  }
  assertLocal() {
    this.owner.basicGuard();
    if (
      this.closeAttempted ||
      !(
        this.local(this.page.url(), "GET") ||
        this.local(this.page.url(), "POST")
      )
    )
      throw new Error("browser is closed or outside its configured portal");
    if (this.blocked.length) throw new Error("browser boundary was violated");
  }
  async observe(action = "inspect") {
    this.assertLocal();
    await this.owner.guard();
    const screenshot = path.join(
        this.captureDir,
        `step-${String(this.step++).padStart(2, "0")}.png`,
      ),
      item = { action, status: "prepared", screenshot };
    this.owner.receipt.data.observations.push(item);
    this.owner.receipt.save();
    await this.page.screenshot({
      path: screenshot,
      fullPage: false,
      timeout: 4000,
    });
    fs.chmodSync(screenshot, 0o600);
    const raw = fs.readFileSync(screenshot);
    item.screenshotBytes = raw.length;
    item.screenshotSha256 = hash(raw);
    if (raw.length > 8 * 1024 * 1024)
      throw new Error("screenshot exceeds retained limit");
    const text = await this.page.locator("body").innerText(),
      controls = await this.page
        .locator("a,button,input:not([type=hidden]),select,textarea")
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const style = getComputedStyle(el);
              return (
                !el.hidden &&
                style.display !== "none" &&
                style.visibility !== "hidden"
              );
            })
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent ?? "").trim().slice(0, 160),
              label: Array.from(el.labels ?? [])
                .map((l) => l.textContent.trim())
                .join(" "),
              value: "value" in el ? String(el.value) : "",
              disabled: "disabled" in el ? el.disabled : false,
              ...(el.tagName === "SELECT"
                ? { options: Array.from(el.options).map((o) => o.label) }
                : {}),
            })),
        );
    const view = {
      url: this.page.url(),
      title: await this.page.title(),
      text: text.slice(0, 12000),
      text_truncated: text.length > 12000,
      controls: controls.slice(0, 128),
      controls_truncated: controls.length > 128,
      alerts: await this.page.getByRole("alert").allTextContents(),
    };
    const attachment =
      /^\/tickets\/([A-Za-z0-9_-]+)\/attachments\/([A-Za-z0-9_-]+)$/.exec(
        new URL(view.url).pathname,
      );
    if (attachment) {
      const element = this.page.locator("[data-attachment-read]");
      if (
        (await element.count()) !== 1 ||
        !(await element.isVisible()) ||
        view.text_truncated
      )
        throw Error("attachment observation is missing or truncated");
      const metadata = await element.evaluate((el) => ({
          id: el.dataset.attachmentRead,
          hash: el.dataset.attachmentSha256,
          text: el.textContent,
        })),
        snapshot = await this.owner.guard(),
        read = snapshot.state.attachment_reads?.find(
          (r) => r.id === metadata.id,
        ),
        normalize = (text) =>
          text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      if (
        !read ||
        read.content_sha256 !== metadata.hash ||
        read.ticket_id !== attachment[1] ||
        read.attachment.id !== attachment[2] ||
        read.scope.operation_id !== this.owner.portal.scope.id ||
        read.instance_id !== (snapshot.state.instance_id ?? null) ||
        metadata.text !== normalize(read.attachment.content) ||
        !view.text.includes(await element.innerText())
      )
        throw Error(
          "attachment view differs from genuine scoped original evidence",
        );
      this.observedAttachments.set(read.attachment.id, {
        id: read.id,
        hash: read.content_sha256,
      });
      item.attachmentRead = { id: read.id, contentSha256: read.content_sha256 };
    }
    const matched = /^\/tickets\/([A-Za-z0-9_-]+)$/.exec(
      new URL(view.url).pathname,
    );
    if (matched) {
      if (this.owner.allowWrites && view.text_truncated)
        throw Error(
          "ticket conversation observation is truncated; cannot authorize submit",
        );
      const fields = await this.page
        .locator('form[method="post"]')
        .evaluateAll((forms) =>
          forms.map((f) => ({
            readId: f.querySelector('input[name="read_id"]')?.value,
            hash: f.querySelector('input[name="read_sha256"]')?.value,
          })),
        );
      if (fields.length) {
        if (fields.length !== 1) throw Error("ambiguous observed ticket form");
        const current = await this.owner.guard(),
          read = current.state.reads?.find((r) => r.id === fields[0].readId);
        if (
          !read ||
          read.content_sha256 !== fields[0].hash ||
          read.source.ticket.id !== matched[1] ||
          read.scope.operation_id !== this.owner.portal.scope.id
        )
          throw Error("observed ticket read does not belong to this operation");
        this.observedRead = {
          id: read.id,
          hash: read.content_sha256,
          ticketId: matched[1],
        };
        item.observedRead = { id: read.id, contentSha256: read.content_sha256 };
      }
    }

    Object.assign(item, view, { status: "captured" });
    this.trace.push({ ...view, screenshot });
    this.owner.receipt.save();
    return view;
  }
  async execute(name, args) {
    this.assertLocal();
    argumentsFor[name]?.parse(args);
    await this.owner.guard();
    if (name === "browser_inspect") return this.observe();
    let locator, meta;
    if (name === "browser_click") {
      if (args.name === "Submit update" && !this.owner.allowWrites)
        throw new Error("writes_not_authorized");
      locator = this.page.getByRole(args.role, {
        name: args.name,
        exact: true,
      });
    } else if (name === "browser_fill" || name === "browser_select")
      locator = this.page.getByLabel(args.label, { exact: true });
    else throw new Error("unknown browser tool");
    if (
      (await locator.count()) !== 1 ||
      !(await locator.isVisible()) ||
      !(await locator.isEnabled())
    )
      throw new Error("browser action requires one visible enabled control");
    meta = await locator.evaluate((el) => ({
      tag: el.tagName,
      type: el.type,
      href: el.getAttribute("href"),
      formAction: el.form?.action,
      method: el.form?.method,
      valid: el.form?.checkValidity(),
      hash: el.form?.querySelector('input[name="read_sha256"]')?.value,
      readId: el.form?.querySelector('input[name="read_id"]')?.value,
    }));
    if (name === "browser_click") {
      if (
        args.role === "link" &&
        (!meta.href || !this.local(new URL(meta.href, this.page.url()).href))
      )
        throw new Error("unqualified browser link");
      if (meta.formAction) {
        const method = meta.method.toUpperCase();
        if (!this.local(meta.formAction, method) || !meta.valid)
          throw new Error("form validation or destination failed");
        if (method === "POST") {
          const id = /^\/tickets\/([A-Za-z0-9_-]+)$/.exec(
            new URL(meta.formAction).pathname,
          )?.[1];
          if (!this.owner.allowWrites || !this.owner.portal.scope.allow_writes)
            throw Error("writes_not_authorized");
          if (
            !this.observedRead ||
            this.observedRead.ticketId !== id ||
            this.observedRead.hash !== meta.hash ||
            this.observedRead.id !== meta.readId ||
            new URL(this.page.url()).pathname !== `/tickets/${id}`
          )
            throw Error(
              "save requires the actual exact observed ticket read/hash",
            );
          const current = await this.owner.guard(),
            read = current.state.reads?.find((r) => r.id === meta.readId);
          if (
            !read ||
            read.status !== "observed" ||
            !matches(read.source.ticket, this.owner.portal.scope.target)
          )
            throw Error("save lacks exact target/read authority");
          for (const id of read.source.ticket.policy.required_attachment_ids) {
            const observed = this.observedAttachments.get(id),
              proof = current.state.attachment_reads?.find(
                (a) => a.id === observed?.id,
              );
            if (
              !proof ||
              proof.content_sha256 !== observed.hash ||
              proof.scope.operation_id !== this.owner.portal.scope.id ||
              proof.instance_id !== read.source.instance_id ||
              proof.instruction_sha256 !==
                read.source.ticket.policy.instruction_sha256 ||
              !same(
                proof.attachment,
                read.source.ticket.attachments.find((a) => a.id === id),
              )
            )
              throw Error(
                "submit requires genuine current relevant attachment observations",
              );
          }
        }
      }
      this.lastRedirect = null;
      this.dispatchPrepared();
      await locator.click();
      if (meta.formAction && meta.method.toUpperCase() === "POST") {
        const url = new URL(this.page.url()),
          snapshot = await this.owner.guard(),
          read = snapshot.state.reads?.find((r) => r.id === meta.readId),
          ticket = snapshot.state.tickets.find(
            (c) => c.id === this.observedRead.ticketId,
          );
        if (
          url.pathname !== new URL(meta.formAction).pathname ||
          !this.lastRedirect ||
          new URL(this.lastRedirect).searchParams.get("receipt") !==
            meta.readId ||
          !read ||
          !["applied", "unchanged"].includes(read.status) ||
          !same(read.decision.after, ticket)
        ) {
          const failed = await this.observe("failed submission");
          throw Object.assign(
            Error(
              failed.alerts.join("; ") || "form submission was not confirmed",
            ),
            { observation: failed },
          );
        }
        this.owner.receipt.data.actions.at(-1).savedReadId = meta.readId;
      }
    } else if (name === "browser_fill") {
      if (
        !(
          (meta.tag === "INPUT" &&
            ["text", "search", "email"].includes(meta.type)) ||
          meta.tag === "TEXTAREA"
        )
      )
        throw new Error(
          "only visible business search/address/reply fields are writable",
        );
      this.dispatchPrepared();
      await locator.fill(args.value);
    } else {
      if (meta.tag !== "SELECT")
        throw new Error("only visible business selects are writable");
      this.dispatchPrepared();
      await locator.selectOption({ label: args.option });
    }
    await this.page.waitForLoadState("domcontentloaded");
    const view = await this.observe(`${name} ${JSON.stringify(args)}`);
    if (view.alerts.length)
      throw Object.assign(new Error(view.alerts.join("; ")), {
        observation: view,
      });
    return view;
  }
  dispatchPrepared() {
    const action = this.owner.activeAction;
    if (!action || action.status !== "prepared")
      throw new Error("browser dispatch lacks prepared application authority");
    action.dispatchPrepared = true;
    action.dispatchPreparedAt = new Date().toISOString();
    this.owner.receipt.save();
    this.owner.basicGuard();
  }
  async close() {
    if (this.closeAttempted) throw new Error("browser close already attempted");
    this.closeAttempted = true;
    const errors = [];
    this.owner.signal.removeEventListener("abort", this.abort);
    if (this.context)
      try {
        await this.context.close();
        this.owner.receipt.data.lifecycle.contextClosed = true;
      } catch (e) {
        errors.push(e);
      }
    else this.owner.receipt.data.lifecycle.contextClosed = true;
    if (this.browser)
      try {
        await this.browser.close();
        this.owner.receipt.data.lifecycle.browserClosed = true;
      } catch (e) {
        errors.push(e);
      }
    else this.owner.receipt.data.lifecycle.browserClosed = true;
    if (errors.length) throw errors[0];
    this.closed = true;
  }
}
