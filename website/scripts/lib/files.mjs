import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Readers always see a complete file; unchanged assets keep their timestamps. */
export function writeFileAtomically(file, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  try { if (readFileSync(file).equals(bytes)) return; } catch (error) { if (error.code !== "ENOENT") throw error; }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
