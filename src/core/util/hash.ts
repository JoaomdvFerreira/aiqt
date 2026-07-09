import { createHash } from "node:crypto";

/** SHA-256 hex digest of `content`, prefixed `sha256:` per the AIQT packet contract. */
export function sha256Hex(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
