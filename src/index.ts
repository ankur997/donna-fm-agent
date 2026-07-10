import "dotenv/config";
import cron from "node-cron";
import { sendRecommendations } from "./send.js";

// Long-running scheduler. Runs under pm2 in production.
// Mirrors the exact schedule Donna FM had inside Mission Control's
// instrumentation.ts (now removed there): 9 AM and 7 PM IST daily.

const TZ = process.env.TZ || "Asia/Kolkata";

function log(m: string) {
  console.log(`[DonnaFM:scheduler] ${new Date().toISOString()} ${m}`);
}

async function runSlot(slot: "morning" | "evening") {
  try {
    log(`Triggering ${slot} recommendations...`);
    const result = await sendRecommendations(slot);
    if (result.ok) {
      log(`✓ ${slot} sent — ${result.items?.length ?? 0} items${result.skipped ? " (skipped, already sent)" : ""}`);
    } else {
      log(`✗ ${slot} failed: ${result.error}`);
    }
  } catch (err) {
    log(`${slot} unexpected error: ${String(err)}`);
  }
}

log(`starting. tz=${TZ}`);

// Donna FM — 9 AM and 7 PM IST
cron.schedule("0 9 * * *", () => runSlot("morning"), { timezone: TZ });
cron.schedule("0 19 * * *", () => runSlot("evening"), { timezone: TZ });
log("Scheduled: 9:00 AM and 7:00 PM IST daily");

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

// Keep the process alive.
process.stdin.resume();
