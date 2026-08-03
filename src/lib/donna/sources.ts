/**
 * Donna FM — curated sources, topic queries, quality gates.
 * Edit RESPECTED_CHANNELS to tune which channels/speakers Donna trusts.
 */

// ── AJ's interest topics → YouTube search queries ───────────────────────────────
// Each topic maps to a few high-signal search phrases.
export const TOPIC_QUERIES: Record<string, string[]> = {
  "world politics":            ["geopolitics analysis", "foreign policy interview", "global economy outlook"],
  "technology":                ["technology deep dive", "future of technology talk"],
  "education and innovation":  ["future of education", "education innovation talk", "edtech keynote"],
  "ai":                        ["artificial intelligence interview", "AI strategy talk", "frontier AI research discussion"],
  "leadership":                ["leadership keynote", "CEO leadership interview", "Gokul Rajaram interview", "Gokul Rajaram podcast"],
  "business":                  ["business strategy interview", "scaling company founder talk"],
  "venture capital":           ["venture capital interview", "VC investing thesis"],
  "private equity":            ["private equity interview", "buyout investing discussion"],
  // ── Added 2026-08-03: AJ wants the mix broadened beyond AI/VC — think like a
  // leader, business commentator, policy-watcher, hardcore operator, and people
  // manager who has to keep updating himself.
  "people management":         ["people management strategies talk", "org leadership culture interview", "team building executive talk"],
  "policy and regulation":     ["regulatory policy analysis", "government policy business impact", "public policy talk"],
  "operations and execution":  ["operational excellence talk", "scaling operations interview", "execution strategy leadership"],
  "purpose driven business":   ["purpose driven business talk", "social impact business interview", "conscious capitalism talk"],
  "innovation":                ["innovation strategy talk", "disruptive innovation interview"],
  "history":                   ["geopolitical history analysis", "history lessons leadership", "empire history interview"],
};

// ── Respected channels / speakers (the allowlist) ───────────────────────────────
// Match is by channelTitle (case-insensitive substring). Add channelId later if you
// want exact matching. `topics` is informational only.
export interface RespectedChannel { name: string; topics: string[]; }

export const RESPECTED_CHANNELS: RespectedChannel[] = [
  // VC / startups / business
  { name: "a16z",                       topics: ["venture capital", "technology", "ai"] },
  { name: "Andreessen Horowitz",        topics: ["venture capital", "technology"] },
  { name: "Y Combinator",               topics: ["business", "venture capital"] },
  { name: "Sequoia Capital",            topics: ["venture capital"] },
  { name: "Lenny's Podcast",            topics: ["business", "leadership"] },
  { name: "All-In Podcast",             topics: ["venture capital", "business", "world politics"] },
  { name: "20VC",                       topics: ["venture capital"] },
  { name: "Twenty Minute VC",           topics: ["venture capital"] },
  { name: "The Tim Ferriss Show",       topics: ["leadership", "business"] },
  { name: "Invest Like the Best",       topics: ["business", "private equity", "venture capital"] },
  { name: "Acquired",                   topics: ["business", "technology"] },
  { name: "Stanford Graduate School of Business", topics: ["leadership", "business"] },
  { name: "Harvard Business Review",    topics: ["leadership", "business"] },
  { name: "TED",                        topics: ["education and innovation", "leadership"] },
  { name: "TEDx Talks",                 topics: ["education and innovation"] },
  { name: "Stanford",                   topics: ["education and innovation", "ai"] },
  { name: "MIT",                        topics: ["technology", "ai", "education and innovation"] },
  // AI / tech
  { name: "Lex Fridman",                topics: ["ai", "technology", "world politics"] },
  { name: "Y Combinator",               topics: ["ai"] },
  { name: "Two Minute Papers",          topics: ["ai"] },
  { name: "DeepMind",                   topics: ["ai"] },
  { name: "OpenAI",                     topics: ["ai"] },
  { name: "Nvidia",                     topics: ["ai", "technology"] },
  { name: "a16z",                       topics: ["ai"] },
  // World / economy / politics — established media
  { name: "Bloomberg",                  topics: ["business", "world politics"] },
  { name: "Bloomberg Originals",        topics: ["business", "technology"] },
  { name: "Financial Times",            topics: ["world politics", "business"] },
  { name: "The Economist",              topics: ["world politics", "business"] },
  { name: "CNBC",                       topics: ["business"] },
  { name: "CNBC-TV18",                  topics: ["business"] },
  { name: "World Economic Forum",       topics: ["world politics", "leadership"] },
  { name: "Council on Foreign Relations", topics: ["world politics"] },
  { name: "Carnegie Endowment",         topics: ["world politics"] },
  // People management / org leadership
  { name: "Simon Sinek",                topics: ["people management", "leadership"] },
  { name: "Masters of Scale",           topics: ["people management", "leadership", "business"] },
  { name: "First Round Review",         topics: ["people management", "business"] },
  // Policy & regulation
  { name: "Brookings Institution",      topics: ["policy and regulation", "world politics"] },
  // Operations & execution excellence
  { name: "McKinsey & Company",         topics: ["operations and execution", "business"] },
  { name: "How I Built This",           topics: ["operations and execution", "business"] },
  // Purpose-driven business / social impact
  { name: "Skoll Foundation",           topics: ["purpose driven business"] },
  // Innovation
  { name: "Fast Company",               topics: ["innovation", "technology"] },
  // History (geopolitical/business-relevant, not general entertainment history)
  { name: "Hardcore History Podcast by Dan Carlin", topics: ["history"] },
  { name: "Empire • World History",     topics: ["history", "world politics"] },
  // India ecosystem (AJ-relevant)
  { name: "Raj Shamani",                topics: ["business", "leadership"] },
  { name: "Prime Venture Partners",     topics: ["venture capital"] },
  { name: "The Ken",                    topics: ["business"] },
  { name: "ET Now",                     topics: ["business"] },
  { name: "Moneycontrol",               topics: ["business"] },
  { name: "Nikhil Kamath",              topics: ["business", "venture capital"] },
  { name: "WTF is with Nikhil Kamath",  topics: ["business"] },
];

// ── Entertainment / low-signal exclusions ──────────────────────────────────────
export const ENTERTAINMENT_KEYWORDS: string[] = [
  "music video", "official video", "official audio", "lyrics", "song", "album",
  "trailer", "teaser", "movie", "film scene", "reaction", "vlog", "prank",
  "gameplay", "gaming", "live stream highlights", "comedy", "stand up", "stand-up",
  "cricket highlights", "match highlights", "ipl", "bollywood", "celebrity",
  "unboxing", "asmr", "shorts", "tiktok", "challenge",
];

// ── Quality / popularity thresholds (tune here) ─────────────────────────────────
export const THRESHOLDS = {
  MIN_DURATION_SECONDS: 600,     // >= 10 min (no Shorts / clips)
  MIN_AGE_HOURS: 72,             // skip brand-new uploads (need proven traction)
  MAX_AGE_DAYS: 30,              // only the last 30 days
  MIN_TOTAL_VIEWS: 10000,        // absolute floor
  MIN_VIEWS_PER_DAY: 800,   // lowered from 1500 — ensures enough candidates reach curation       // "becoming popular" velocity floor
  OFFLIST_MIN_SUBSCRIBERS: 100000, // a non-allowlisted channel needs >= 100k subs
};

/** Case-insensitive substring match against the respected-channel allowlist. */
export function isRespectedChannel(channelName: string): boolean {
  const n = (channelName || "").toLowerCase();
  if (!n) return false;
  return RESPECTED_CHANNELS.some((c) => n.includes(c.name.toLowerCase()));
}

/** A candidate passes the quality gate if it's on the allowlist OR the channel is large. */
export function passesQualityGate(channelName: string, subscriberCount: number): boolean {
  if (isRespectedChannel(channelName)) return true;
  return subscriberCount >= THRESHOLDS.OFFLIST_MIN_SUBSCRIBERS;
}

/** True if title/description looks like entertainment/music/low-signal content. */
export function looksLikeEntertainment(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return ENTERTAINMENT_KEYWORDS.some((k) => text.includes(k));
}

// ── Language filter ────────────────────────────────────────────────────────────
// Reject videos/channels whose titles contain non-Latin scripts.
// Covers Tamil (0B80-0BFF), Malayalam (0D00-0D7F), Telugu (0C00-0C7F),
// Kannada (0C80-0CFF), Devanagari/Hindi (0900-097F), Bengali (0980-09FF),
// Gujarati (0A80-0AFF), Punjabi/Gurmukhi (0A00-0A7F), Arabic (0600-06FF),
// Chinese/CJK (4E00-9FFF), and other common non-Latin blocks.
const NON_LATIN_PATTERN = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/;

/** Returns true if title or channelName contains non-Latin script characters. */
export function looksLikeNonEnglish(title: string, channelName: string): boolean {
  return NON_LATIN_PATTERN.test(title) || NON_LATIN_PATTERN.test(channelName);
}

// ── AI hard-cap detection ───────────────────────────────────────────────────────
// AJ wants at most 1 AI-topic pick per batch — the mix had become AI-dominated.
// This is a content-based check (title/description), independent of whatever
// topic label Claude assigns, so the cap can't be talked around.
const AI_REGEX = /\b(ai|artificial intelligence|chatgpt|openai|anthropic|claude|gemini|llm|large language model|machine learning|generative ai|gpt-\d|agi|neural network)\b/i;

/** Returns true if title/description reads as AI-topic content. */
export function looksLikeAI(title: string, description: string): boolean {
  return AI_REGEX.test(`${title} ${description}`);
}
