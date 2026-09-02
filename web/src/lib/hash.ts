// Tamper-evident hash chain for live-generated turns — the TS mirror of
// backend/src/juro/transcript.py's chain_turns(). Each turn's hash covers
// every turn before it, so an edit to any past turn breaks the chain.
import { createHash } from "crypto";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: sorted keys, no extra whitespace — matches transcript.py's `_canonical`. */
function canonical(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(obj));
}

export function nextHash(prevHash: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(prevHash + canonical(payload)).digest("hex");
}

export const GENESIS_HASH = "genesis";

/** Short display form of a chain's last hash, e.g. "f3a9…c7e1". */
export function shortRoot(hash: string): string {
  return hash === GENESIS_HASH ? "—" : `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}
