import "dotenv/config";
import cron from "node-cron";
import { sendRecommendations, sendTwilioWhatsApp } from "./send.js";
import { loadSentHistory } from "./lib/donnaFmCurator.js";

// Long-running scheduler. Runs under pm2 in production.
// Mirrors the exact schedule Donna FM had inside Mission Control's
// instrumentation.ts (now removed there): 9 AM and 7 PM IST daily.

const TZ = process.env.TZ || "Asia/Kolkata";

function log(m: string) {
  console.log(`[DonnaFM:scheduler] ${new Date().toISOString()} ${m}`);
}

/**
 * Tell AJ when a push fails. Added 2026-09-02: the 09-01 evening and 09-02
 * morning pushes both died on an exhausted YouTube quota and NOTHING said so —
 * the failure was only visible in pm2 logs. A missed push must be loud.
 */
async function alertFailure(slot: "morning" | "evening", reason: string, willRetry: boolean) {
  const to = process.env.USER_WHATSAPP_NUMBER;
  if (!to) return;
  const retryLine = willRetry
    ? "\n\nWill retry automatically once the quota window resets (~12:30-1:30 PM IST)."
    : "";
  const body = `⚠️ Donna FM: ${slot} push did not go out.\n\nReason: ${reason}${retryLine}`;
  try {
    const r = await sendTwilioWhatsApp(to, body);
    if (!r.ok) log(`failure-alert send failed: ${r.error}`);
  } catch (e) {
    log(`failure-alert threw: ${String(e)}`);
  }
}

async function runSlot(slot: "morning" | "evening", opts: { alertOnFailure?: boolean } = {}) {
  try {
    log(`Triggering ${slot} recommendations...`);
    const result = await sendRecommendations(slot, false, { scheduled: true });
    if (result.ok) {
      log(`✓ ${slot} sent — ${result.items?.length ?? 0} items${result.skipped ? " (skipped, already sent)" : ""}`);
      return result;
    }
    log(`✗ ${slot} failed: ${result.error}`);
    if (opts.alertOnFailure !== false) {
      // A quota failure is recoverable later today; anything else is not.
      await alertFailure(slot, result.error ?? "unknown", result.quotaExhausted === true);
    }
    return result;
  } catch (err) {
    log(`${slot} unexpected error: ${String(err)}`);
    if (opts.alertOnFailure !== false) await alertFailure(slot, String(err), false);
    return undefined;
  }
}

/** Has this slot already gone out today? */
function alreadySentToday(slot: "morning" | "evening"): boolean {
  const recId = `${slot}-${new Date().toISOString().slice(0, 10)}`;
  try {
    return loadSentHistory().some((r) => r.id === recId);
  } catch {
    return false;
  }
}

/**
 * Post-quota-reset recovery (added 2026-09-02).
 * The YouTube quota window rolls over at midnight US-Pacific — ~12:30 PM IST in
 * summer, ~1:30 PM IST in winter. If the 9 AM morning push died on quota, a
 * fresh budget exists a few hours later, so re-run it rather than losing the day.
 * Both attempts are no-ops when the slot already went out (sendRecommendations
 * dedupes per slot per day, and we check first to avoid burning search calls).
 */
async function recoverMissedMorning() {
  if (alreadySentToday("morning")) return;
  log("Morning push missing after quota reset — attempting recovery...");
  await runSlot("morning");
}

log(`starting. tz=${TZ}`);

// Donna FM — 9 AM and 7 PM IST
cron.schedule("0 9 * * *", () => runSlot("morning"), { timezone: TZ });
cron.schedule("0 19 * * *", () => runSlot("evening"), { timezone: TZ });

// Recovery attempts, just after each possible quota-reset time (PDT then PST).
cron.schedule("40 12 * * *", () => recoverMissedMorning(), { timezone: TZ });
cron.schedule("40 13 * * *", () => recoverMissedMorning(), { timezone: TZ });

log("Scheduled: 9:00 AM and 7:00 PM IST daily (+ morning recovery at 12:40 / 1:40 PM IST)");

// Startup catch-up for the morning slot only (matches old Mission Control behaviour):
// if the process restarts between 9:00 and 11:00 AM IST, send the morning batch now.
// sendRecommendations() already dedupes per-slot-per-day, so this is a safe no-op
// if morning was already sent.
{
  const nowIST = new Date().toLocaleString("en-US", { timeZone: TZ });
  const istDate = new Date(nowIST);
  const istHour = istDate.getHours();
  const istMin = istDate.getMinutes();
  if ((istHour > 9 || (istHour === 9 && istMin >= 0)) && istHour < 11) {
    log("Started after 9 AM IST — checking if morning send needs catch-up...");
    setTimeout(() => runSlot("morning"), 25_000);
  }
}

// Startup catch-up for evening slot: if process restarts between 7:00 PM and 9:00 PM IST,
// send the evening batch now. sendRecommendations() dedupes, so safe if already sent.
{
  const nowIST2 = new Date().toLocaleString("en-US", { timeZone: TZ });
  const istDate2 = new Date(nowIST2);
  const istHour2 = istDate2.getHours();
  const istMin2 = istDate2.getMinutes();
  if ((istHour2 > 19 || (istHour2 === 19 && istMin2 >= 0)) && istHour2 < 21) {
    log("Started after 7 PM IST — checking if evening send needs catch-up...");
    setTimeout(() => runSlot("evening"), 30_000);
  }
}

// Keep the process alive.
process.stdin.resume();
