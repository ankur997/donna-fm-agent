/**
 * Donna FM — core send pipeline.
 * Search YouTube → filter (popular, respected, on-topic, English-only) → de-dupe
 * by speaker/topic → curate top 3 via Claude → send via Twilio WhatsApp.
 * Ported from Mission Control's /api/donna/whatsapp-send route (now removed there)
 * so a Donna FM bug/outage can never take Mission Control down with it.
 */

import {
  curateRecommendations,
  formatHeaderMessage,
  formatItemMessage,
  saveSentRec,
  loadSentHistory,
  SentRecommendation,
  RecommendationItem,
  CurationCandidate,
} from "./lib/donnaFmCurator.js";
import { searchYouTubeCandidates } from "./lib/donna/youtubeSearch.js";
import { getTasteProfile } from "./lib/donna/tasteProfile.js";
import { TOPIC_QUERIES, followedPeopleQueries } from "./lib/donna/sources.js";
import { QuotaExhaustedError, QuotaBudgetError } from "./lib/donna/quotaBudget.js";
import { logYouTubeItem, extractVideoId } from "./lib/donna/youtube-log.js";

export async function sendTwilioWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from || !to) return { ok: false, error: "Twilio env vars not configured" };

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

/**
 * Round-robin merge of several query lists, taking one query from each list in
 * turn until all are exhausted. Added 2026-09-01: with the followed-people list
 * (67 names) added on top of taste + topic queries, plain concatenation would let
 * whichever list comes first fully consume the downstream 45-query cap and starve
 * the others — same failure mode as the "only 1 recommendation" bug, just moved.
 * AJ chose "just raise the flat cap, no rotation" (no rotation across days/runs),
 * but within a single run we still need every group represented once ordering hits
 * the cap — that's what this does; it isn't day-based rotation.
 */
function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/** Build the full search query set: followed people + AJ's fixed topics + taste-derived queries. */
async function buildQueries(): Promise<string[]> {
  const peopleQueries = followedPeopleQueries();
  const topicQueries = Object.values(TOPIC_QUERIES).flat();
  let tasteQueries: string[] = [];
  try {
    const profile = await getTasteProfile();
    tasteQueries = profile.searchQueries ?? [];
  } catch (e) {
    console.warn("[DonnaFM] taste profile unavailable:", e);
  }
  return Array.from(new Set(interleave([peopleQueries, tasteQueries, topicQueries])));
}

export interface SendResult {
  ok: boolean;
  slot: "morning" | "evening";
  skipped?: boolean;
  reason?: string;
  error?: string;
  items?: RecommendationItem[];
  candidatesConsidered?: number;
  /** True when the run died on the YouTube daily search quota, not on content. */
  quotaExhausted?: boolean;
}

export async function sendRecommendations(
  slot: "morning" | "evening",
  dryRun = false,
  opts: { scheduled?: boolean } = {}
): Promise<SendResult> {
  const to = process.env.USER_WHATSAPP_NUMBER;
  if (!to && !dryRun) {
    return { ok: false, slot, error: "USER_WHATSAPP_NUMBER not set" };
  }

  try {
    const recId = `${slot}-${new Date().toISOString().slice(0, 10)}`;

    // Idempotency: don't re-send a slot already sent today (skip in dryRun).
    if (!dryRun && loadSentHistory().some((r) => r.id === recId)) {
      console.log(`[DonnaFM] ${recId} already sent today — skipping`);
      return { ok: true, slot, skipped: true, reason: "already sent today" };
    }

    // ── Search YouTube (topics + taste) ──────────────────────────────────────
    const queries = await buildQueries();
    const found = await searchYouTubeCandidates(queries, 25, { scheduled: opts.scheduled === true });

    const candidates: CurationCandidate[] = found.map((v) => ({
      title: v.title,
      source: v.channelName,
      url: v.url,
      description: v.description,
      type: "youtube" as const,
      viewsPerDay: Math.round(v.viewsPerDay),
      publishedAt: v.publishedAt,
    }));

    if (candidates.length === 0) {
      return { ok: false, slot, error: "No content available to curate", candidatesConsidered: 0 };
    }

    // ── Curate top 3 ──────────────────────────────────────────────────────────
    const items: RecommendationItem[] = await curateRecommendations(slot, candidates);
    if (items.length === 0) {
      return { ok: false, slot, error: "Curation returned no items", candidatesConsidered: candidates.length };
    }

    // ── Dry run: return without sending ───────────────────────────────────────
    if (dryRun) {
      return { ok: true, slot, items, candidatesConsidered: candidates.length };
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    const headerResult = await sendTwilioWhatsApp(to as string, formatHeaderMessage(slot));
    if (!headerResult.ok) {
      console.error("[DonnaFM] Twilio header send failed:", headerResult.error);
      return { ok: false, slot, error: headerResult.error };
    }
    for (const item of items) {
      await new Promise((r) => setTimeout(r, 600));
      const r = await sendTwilioWhatsApp(to as string, formatItemMessage(item));
      if (!r.ok) console.warn(`[DonnaFM] Item ${item.slot} send failed:`, r.error);
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    const sentRec: SentRecommendation = { id: recId, sentAt: new Date().toISOString(), items };
    saveSentRec(sentRec);

    // ── YouTube log (for future feedback-based filtering) ────────────────────
    try {
      const sentAt = new Date().toISOString();
      for (const item of items) {
        if (item.type !== "youtube") continue;
        const videoId = extractVideoId(item.url);
        if (!videoId) continue;
        logYouTubeItem({
          videoId, title: item.title, channelName: item.source, url: item.url,
          thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          sentAt, recId, slot: item.slot, topics: item.topics ?? [], summary: item.summary,
        });
      }
    } catch (e) {
      console.warn("[DonnaFM] YouTube log write failed:", e);
    }

    console.log(`[DonnaFM] Sent ${slot} recommendations (${items.length} items)`);
    return { ok: true, slot, items };
  } catch (err) {
    console.error("[DonnaFM] Error:", err);
    // Quota failures get their own honest label. Reporting them as generic
    // errors (or worse, as "No content available to curate") is what made the
    // 2026-09-01 / 09-02 misses take a full RCA to explain.
    if (err instanceof QuotaExhaustedError || err instanceof QuotaBudgetError) {
      return { ok: false, slot, quotaExhausted: true, error: err.message };
    }
    return { ok: false, slot, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
