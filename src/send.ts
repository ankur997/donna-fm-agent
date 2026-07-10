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
import { TOPIC_QUERIES } from "./lib/donna/sources.js";
import { logYouTubeItem, extractVideoId } from "./lib/donna/youtube-log.js";

async function sendTwilioWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
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

/** Build the full search query set: AJ's fixed topics + taste-derived queries. */
async function buildQueries(): Promise<string[]> {
  const topicQueries = Object.values(TOPIC_QUERIES).flat();
  let tasteQueries: string[] = [];
  try {
    const profile = await getTasteProfile();
    tasteQueries = profile.searchQueries ?? [];
  } catch (e) {
    console.warn("[DonnaFM] taste profile unavailable:", e);
  }
  return Array.from(new Set([...tasteQueries, ...topicQueries]));
}

export interface SendResult {
  ok: boolean;
  slot: "morning" | "evening";
  skipped?: boolean;
  reason?: string;
  error?: string;
  items?: RecommendationItem[];
  candidatesConsidered?: number;
}

export async function sendRecommendations(
  slot: "morning" | "evening",
  dryRun = false
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
    const found = await searchYouTubeCandidates(queries);

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
    return { ok: false, slot, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
