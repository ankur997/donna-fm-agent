/**
 * Donna FM Curator (v2)
 * ─ Curates top 3 YouTube recommendations: search-based, popularity-filtered,
 *   respected-source-gated, de-duplicated by speaker AND topic across channels.
 * ─ Stores sent history and user feedback.
 * ─ Feedback suppresses by speaker / topic-key / source (reliable, not fuzzy).
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

// ── Storage ────────────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(process.cwd(), "data");
const PREFS_FILE = path.join(DATA_DIR, "donna-fm-prefs.json");
const SENT_FILE  = path.join(DATA_DIR, "donna-fm-sent.json");

export interface DonnaFmPrefs {
  likedTopics:       string[];
  dislikedTopics:    string[];
  likedSources:      string[];
  dislikedSources:   string[];
  likedSpeakers:     string[];   // NEW — speakers AJ liked
  dislikedSpeakers:  string[];   // NEW — speakers to suppress (any channel)
  dislikedTopicKeys: string[];   // NEW — topic-keys to suppress (any channel)
  feedbackHistory:   FeedbackEntry[];
  substackFeeds?:    { name: string; url: string }[];
}

export interface FeedbackEntry {
  ts: string;
  recId: string;
  title: string;
  source: string;
  reaction: "liked" | "disliked" | "more_like";
}

export interface SentRecommendation {
  id: string;
  sentAt: string;
  items: RecommendationItem[];
}

export interface RecommendationItem {
  slot: 1 | 2 | 3;
  title: string;
  source: string;            // channel name
  summary: string;
  url: string;
  type: "youtube" | "substack" | "podcast";
  topics: string[];
  speaker?: string;          // NEW — main speaker/guest (for cross-channel dedup)
  topicKey?: string;         // NEW — normalized core topic (for cross-channel dedup)
}

// Candidate passed into curation (from youtubeSearch)
export interface CurationCandidate {
  title: string;
  source: string;
  url: string;
  description: string;
  type: "youtube";
  viewsPerDay?: number;
  publishedAt?: string;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyPrefs(): DonnaFmPrefs {
  return {
    likedTopics: [], dislikedTopics: [], likedSources: [], dislikedSources: [],
    likedSpeakers: [], dislikedSpeakers: [], dislikedTopicKeys: [], feedbackHistory: [],
  };
}

export function loadPrefs(): DonnaFmPrefs {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const p = JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8"));
      return { ...emptyPrefs(), ...p }; // backfill new fields on old files
    }
  } catch {}
  return emptyPrefs();
}

export function savePrefs(prefs: DonnaFmPrefs) {
  ensureDir();
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

export function loadSentHistory(): SentRecommendation[] {
  try {
    if (fs.existsSync(SENT_FILE)) return JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
  } catch {}
  return [];
}

export function saveSentRec(rec: SentRecommendation) {
  ensureDir();
  const history = loadSentHistory();
  history.unshift(rec);
  // Keep last 120 sends (~60 days) so the 30-day de-dup window always has data
  fs.writeFileSync(SENT_FILE, JSON.stringify(history.slice(0, 120), null, 2));
}

export function getLastSent(): SentRecommendation | null {
  const h = loadSentHistory();
  return h.length > 0 ? h[0] : null;
}

// ── Feedback ────────────────────────────────────────────────────────────────────
function uniqPush(arr: string[], v?: string, cap = 40) {
  if (!v) return;
  if (!arr.includes(v)) arr.push(v);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}
function remove(arr: string[], v?: string) {
  if (!v) return arr;
  return arr.filter((x) => x !== v);
}

function applyReactionToPrefs(
  prefs: DonnaFmPrefs,
  item: RecommendationItem,
  reaction: "liked" | "disliked" | "more_like"
) {
  const positive = reaction === "liked" || reaction === "more_like";
  if (positive) {
    item.topics.forEach((t) => { uniqPush(prefs.likedTopics, t, 30); prefs.dislikedTopics = remove(prefs.dislikedTopics, t); });
    uniqPush(prefs.likedSources, item.source, 20);
    uniqPush(prefs.likedSpeakers, item.speaker, 30);
    prefs.dislikedSources   = remove(prefs.dislikedSources, item.source);
    prefs.dislikedSpeakers  = remove(prefs.dislikedSpeakers, item.speaker);
    prefs.dislikedTopicKeys = remove(prefs.dislikedTopicKeys, item.topicKey);
  } else {
    item.topics.forEach((t) => { uniqPush(prefs.dislikedTopics, t, 30); prefs.likedTopics = remove(prefs.likedTopics, t); });
    uniqPush(prefs.dislikedSources, item.source, 20);
    uniqPush(prefs.dislikedSpeakers, item.speaker, 30);     // suppress this speaker on ANY channel
    uniqPush(prefs.dislikedTopicKeys, item.topicKey, 30);   // suppress this topic on ANY channel
    prefs.likedSources  = remove(prefs.likedSources, item.source);
    prefs.likedSpeakers = remove(prefs.likedSpeakers, item.speaker);
  }
}

export function applyFeedback(slot: 1 | 2 | 3, reaction: "liked" | "disliked" | "more_like") {
  const last = getLastSent();
  if (!last) return "No recent recommendations to give feedback on.";
  const item = last.items.find((i) => i.slot === slot);
  if (!item) return `Slot ${slot} not found in last recommendations.`;

  const prefs = loadPrefs();
  prefs.feedbackHistory.unshift({ ts: new Date().toISOString(), recId: last.id, title: item.title, source: item.source, reaction });
  prefs.feedbackHistory = prefs.feedbackHistory.slice(0, 100);
  applyReactionToPrefs(prefs, item, reaction);
  savePrefs(prefs);

  const emoji = reaction === "liked" ? "👍" : reaction === "more_like" ? "➕" : "👎";
  return `${emoji} Got it! "${item.title}" — I'll ${reaction === "disliked" ? "show less of this speaker & topic" : "find more like this"}.`;
}

export function applyFeedbackById(recId: string, slot: 1 | 2 | 3, reaction: "liked" | "disliked" | "more_like"): string {
  const rec = loadSentHistory().find((r) => r.id === recId);
  if (!rec) return "Recommendation not found.";
  const item = rec.items.find((i) => i.slot === slot);
  if (!item) return `Slot ${slot} not found.`;

  const prefs = loadPrefs();
  prefs.feedbackHistory.unshift({ ts: new Date().toISOString(), recId, title: item.title, source: item.source, reaction });
  prefs.feedbackHistory = prefs.feedbackHistory.slice(0, 100);
  applyReactionToPrefs(prefs, item, reaction);
  savePrefs(prefs);
  return "ok";
}

// ── Curation engine ───────────────────────────────────────────────────────────
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Strip lone UTF-16 surrogates (from slicing emoji) + control chars so the
 *  string is safe to embed in the JSON sent to the Anthropic API. */
function sanitize(str: string): string {
  return (str || "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "$1")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function curateRecommendations(
  slot: "morning" | "evening",
  candidatesIn: CurationCandidate[]
): Promise<RecommendationItem[]> {
  const prefs = loadPrefs();
  const client = new Anthropic({
    apiKey: process.env.APP_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY,
  });

  // De-dupe vs last 30 days — by URL, title, AND speaker/topicKey (cross-channel)
  const cutoffMs = Date.now() - 9 * 24 * 60 * 60 * 1000; // 9 days — 14d exhausted the candidate pool within ~5 days (2026-07-16 incident)
  const recent = loadSentHistory().filter((r) => new Date(r.sentAt).getTime() >= cutoffMs);
  const sentUrls = new Set<string>();
  const sentTitles = new Set<string>();
  const sentSpeakers = new Set<string>();
  const sentTopicKeys = new Set<string>();
  for (const rec of recent) {
    for (const it of rec.items) {
      if (it.url) sentUrls.add(it.url.trim());
      if (it.title) sentTitles.add(normKey(it.title));
      if (it.speaker) sentSpeakers.add(normKey(it.speaker));
      if (it.topicKey) sentTopicKeys.add(normKey(it.topicKey));
    }
  }

  const dislikedSources = prefs.dislikedSources.map((s) => s.toLowerCase());

  // Deterministic pre-filter (cheap, reliable)
  const seen = new Set<string>();
  const candidates = candidatesIn.filter((c) => {
    if (!c.title || !c.url) return false;
    const tk = normKey(c.title);
    if (seen.has(tk)) return false;
    if (sentUrls.has(c.url.trim())) return false;
    if (sentTitles.has(tk)) return false;
    if (dislikedSources.includes(c.source.toLowerCase())) return false;
    seen.add(tk);
    return true;
  }).slice(0, 30);

  if (candidates.length === 0) {
    console.log("[DonnaFM] No fresh candidates after pre-filter");
    return [];
  }

  const candidateList = candidates
    .map((c, i) => `[${i + 1}] "${c.title}" — ${c.source}\n    ${c.description.slice(0, 160)}`)
    .join("\n\n");

  const avoid = [
    sentSpeakers.size ? `Recently-featured speakers (do NOT repeat, even on a different channel): ${Array.from(sentSpeakers).slice(0, 25).join("; ")}` : "",
    sentTopicKeys.size ? `Recently-covered topics (do NOT repeat): ${Array.from(sentTopicKeys).slice(0, 25).join("; ")}` : "",
    prefs.dislikedSpeakers.length ? `BANNED speakers (never pick): ${prefs.dislikedSpeakers.slice(0, 25).join("; ")}` : "",
    prefs.dislikedTopicKeys.length ? `BANNED topics (never pick): ${prefs.dislikedTopicKeys.slice(0, 25).join("; ")}` : "",
    prefs.dislikedSources.length ? `BANNED channels: ${prefs.dislikedSources.slice(0, 25).join("; ")}` : "",
  ].filter(Boolean).join("\n");

  const likes = [
    prefs.likedSpeakers.length ? `Liked speakers: ${prefs.likedSpeakers.slice(0, 12).join(", ")}` : "",
    prefs.likedSources.length ? `Liked channels: ${prefs.likedSources.slice(0, 12).join(", ")}` : "",
    prefs.likedTopics.length ? `Liked topics: ${prefs.likedTopics.slice(0, 12).join(", ")}` : "",
  ].filter(Boolean).join("\n") || "No explicit likes yet.";

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: `You are Donna FM, a recommendation curator for AJ — Co-Founder & CBO of Sunstone (Indian edtech). AJ listens to long-form YouTube during commutes/workouts.
Allowed topics ONLY: world politics, technology, education & innovation, AI, leadership, business, venture capital (VCs), private equity (PEs). Reject anything off-topic or entertainment.
${slot === "morning" ? "Morning: energising, strategic, big-picture." : "Evening: reflective, deep dives, slower-paced."}
For each pick, identify the primary SPEAKER/guest (the person, e.g. "Sam Altman"), and a short TOPIC KEY (3-5 words capturing the core subject, e.g. "AI scaling laws"). These are used to avoid repeating the same speaker or topic across different channels.`,
    messages: [{
      role: "user",
      content: `AJ's preferences:\n${sanitize(likes)}\n\nEXCLUSIONS:\n${sanitize(avoid) || "(none yet)"}\n\nCandidates:\n${sanitize(candidateList)}\n\nPick the best 3 for AJ's ${slot} listen. The 3 picks must each have a DISTINCT speaker AND distinct topic from one another, and must NOT match any excluded/recently-featured speaker or topic. For each write a punchy 20-25 word summary. Return ONLY a JSON array:\n[{"slot":1,"index":N,"speaker":"...","topicKey":"...","summary":"...","topics":["t1","t2"]}, ...]`,
    }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = raw.match(/\[[\s\S]*\]/);

  const fallback = (): RecommendationItem[] => {
    console.log("[DonnaFM] Claude parse failed — velocity fallback");
    const picks: RecommendationItem[] = [];
    const usedSpeakers = new Set(Array.from(sentSpeakers));
    for (const c of candidates) {
      const spk = normKey(c.source);
      if (usedSpeakers.has(spk)) continue;
      usedSpeakers.add(spk);
      picks.push({
        slot: (picks.length + 1) as 1 | 2 | 3,
        title: c.title, source: c.source, summary: c.description.slice(0, 120),
        url: c.url, type: "youtube", topics: [], speaker: c.source, topicKey: normKey(c.title).split(" ").slice(0, 4).join(" "),
      });
      if (picks.length === 3) break;
    }
    return picks;
  };

  if (!match) return fallback();
  try {
    const picks: Array<{ slot: 1|2|3; index: number; speaker: string; topicKey: string; summary: string; topics: string[] }> = JSON.parse(match[0]);
    const results = picks
      .filter((p) => p.index >= 1 && p.index <= candidates.length)
      .map((p) => {
        const c = candidates[p.index - 1];
        return {
          slot: p.slot,
          title: c.title,
          source: c.source,
          summary: p.summary,
          url: c.url,
          type: "youtube" as const,
          topics: p.topics || [],
          speaker: p.speaker || c.source,
          topicKey: p.topicKey || "",
        };
      });
    return results.length > 0 ? results : fallback();
  } catch {
    return fallback();
  }
}

// ── Format WhatsApp messages ──────────────────────────────────────────────────
const SLOT_EMOJI: Record<number, string> = { 1: "1️⃣", 2: "2️⃣", 3: "3️⃣" };
const TYPE_ICON:  Record<string, string> = { youtube: "▶️", substack: "📝", podcast: "🎙️" };

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

export function formatHeaderMessage(slot: "morning" | "evening"): string {
  const header = slot === "morning" ? "🌅 *Donna FM — Morning Edition*" : "🌙 *Donna FM — Evening Edition*";
  const date = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" });
  return `${header}\n${date}\n\nHere are your top 3 picks 👇\nSwipe any one and reply *like* or *dislike*`;
}

export function formatItemMessage(item: RecommendationItem): string {
  const slot = SLOT_EMOJI[item.slot] ?? `${item.slot}.`;
  const icon = TYPE_ICON[item.type] || "🔗";
  const title = truncate(item.title, 80);
  const summary = truncate(item.summary, 120);
  return `${slot} *${title}*\n${item.source}\n${summary}\n\n${icon} ${item.url}`;
}

export function formatWhatsAppMessage(slot: "morning" | "evening", items: RecommendationItem[]): string {
  return [formatHeaderMessage(slot), "", ...items.map(formatItemMessage)].join("\n\n");
}

export function findSlotFromBody(body: string): 1 | 2 | 3 | null {
  const t = body.trimStart();
  if (t.startsWith("1️⃣") || t.startsWith("1⃣")) return 1;
  if (t.startsWith("2️⃣") || t.startsWith("2⃣")) return 2;
  if (t.startsWith("3️⃣") || t.startsWith("3⃣")) return 3;
  return null;
}
