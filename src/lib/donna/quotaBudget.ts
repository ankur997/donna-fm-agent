/**
 * Donna FM — YouTube search-quota budget guard.
 *
 * WHY THIS EXISTS (2026-09-02 RCA):
 * On 2026-09-01 a batch of manual dry-runs burned all 100 of this Google Cloud
 * project's daily `search.list` calls. The next two SCHEDULED pushes — evening
 * 7 PM IST on 09-01 and morning 9 AM IST on 09-02 — both got nothing but 429s,
 * produced zero candidates, and failed with the misleading error "No content
 * available to curate". Nobody was alerted; the pushes just silently vanished.
 *
 * Two structural problems, both fixed here and in the callers:
 *  1. Manual/ad-hoc runs could starve scheduled runs. Now manual runs may only
 *     ever consume the non-reserved slice of the window.
 *  2. Quota exhaustion looked identical to "no good content". Now it's a
 *     distinct, named failure that the scheduler alerts on.
 *
 * QUOTA WINDOW: YouTube Data API quota resets at midnight America/Los_Angeles,
 * i.e. ~12:30 PM IST during PDT and ~1:30 PM IST during PST. The window key is
 * therefore the current *Pacific* date, not the local/IST date. That boundary is
 * why one window spans the 7 PM IST evening run AND the NEXT day's 9 AM IST
 * morning run — the pair that died together on 09-01/09-02.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "youtube-quota.json");

/** Hard ceiling for this GCP project, measured via a live 429 on 2026-09-01. */
export const DAILY_SEARCH_LIMIT = 100;

/**
 * Calls held back for the two scheduled runs (2 x 30-query cap = 60) plus slack
 * for a retry or a startup catch-up. Manual runs can never dip into this.
 */
export const RESERVED_FOR_SCHEDULED = 70;

/** What a manual/CLI run is allowed to spend in a single quota window. */
export const MANUAL_ALLOWANCE = DAILY_SEARCH_LIMIT - RESERVED_FOR_SCHEDULED; // 30

/** A few calls kept in hand even for scheduled runs, for retries. */
const SCHEDULED_TAIL_BUFFER = 5;

export class QuotaBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaBudgetError";
  }
}

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

interface QuotaState {
  window: string;      // Pacific date, e.g. "2026-09-02"
  searchCalls: number; // search.list calls spent in this window
}

/** Current quota window key = today's date in America/Los_Angeles. */
export function currentWindow(): string {
  // en-CA gives YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function readState(): QuotaState {
  const window = currentWindow();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as QuotaState;
    if (raw && raw.window === window && typeof raw.searchCalls === "number") return raw;
  } catch {
    // missing or corrupt — treat as a fresh window
  }
  return { window, searchCalls: 0 };
}

function writeState(state: QuotaState): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn("[DonnaFM/quota] could not persist quota state:", e);
  }
}

/** search.list calls already spent in the current window. */
export function spent(): number {
  return readState().searchCalls;
}

/**
 * How many search.list calls this run is allowed to make.
 * Scheduled runs may use the whole window (minus a small tail buffer);
 * manual runs may only use the non-reserved slice.
 */
export function allowance(scheduled: boolean): number {
  const used = spent();
  const ceiling = scheduled
    ? DAILY_SEARCH_LIMIT - SCHEDULED_TAIL_BUFFER
    : MANUAL_ALLOWANCE;
  return Math.max(0, ceiling - used);
}

/** Record that `n` search.list calls were made. */
export function recordCalls(n: number): void {
  const state = readState();
  state.searchCalls += n;
  writeState(state);
}

/**
 * Mark the window as fully spent — called when the API itself returns a
 * quota 429, which is ground truth and beats our own local counter (the
 * counter can under-count if calls were made from elsewhere, e.g. Mission
 * Control's YouTube features sharing the same project).
 */
export function markExhausted(): void {
  writeState({ window: currentWindow(), searchCalls: DAILY_SEARCH_LIMIT });
}

/** Human-readable reset hint for logs and alerts. */
export function resetHint(): string {
  return "resets at midnight US-Pacific (~12:30 PM IST in summer, ~1:30 PM IST in winter)";
}
