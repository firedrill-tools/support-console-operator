import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateState, hash } from "./schema.js";
import { parseJSON } from "./json.js";
import { authority } from "./datasets.js";
export const MAX_SOURCE = 8 * 1024 * 1024;
export function readSource(file) {
  const initial = fs.lstatSync(file);
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size > MAX_SOURCE
  )
    throw new Error("bounded regular source required");
  const fd = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(fd),
      bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    if (
      bytes.length > MAX_SOURCE ||
      before.dev !== initial.dev ||
      before.ino !== initial.ino ||
      before.dev !== current.dev ||
      before.ino !== current.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length !== before.size
    )
      throw new Error("source changed while reading");
    const state = validateState(
      parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    authority(file, state);
    return {
      state,
      bytes,
      digest: hash(bytes),
      identity: `${before.dev}:${before.ino}`,
    };
  } finally {
    fs.closeSync(fd);
  }
}
export function saveSource(file, state, prior) {
  validateState(state);
  const raw = Buffer.from(JSON.stringify(state, null, 2) + "\n");
  if (raw.length > MAX_SOURCE) throw new Error("source size limit exceeded");
  const staged = path.join(path.dirname(file), `.support-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(staged, "wx", 0o600);
    try {
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const current = readSource(file);
    if (current.digest !== prior.digest || current.identity !== prior.identity)
      throw new Error("source changed before commit");
    fs.renameSync(staged, file);
    const parent = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  } finally {
    fs.rmSync(staged, { force: true });
  }
}
