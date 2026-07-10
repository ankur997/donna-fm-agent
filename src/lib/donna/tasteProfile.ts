/**
 * Donna FM — taste profile.
 * Combines AJ's YouTube "Liked videos" (auto, via API) with his uploaded Takeout
 * watch history (manual) to derive the channels, speakers and topic keywords he
 * actually consumes. Cached to disk and rebuilt at most weekly.
 */

import fs from "fs";
import path from "path";
import { getRefreshedYouTubeToken } from "../youtubeAuth.js";
import { looksLikeEntertainment } from "./sources";
import { loadWatchHistory } from "./watchHistory";

const DATA_DIR = path.join(process.cwd(), "data");
const PROFILE_FILE = path.join(DATA_DIR, "donna-taste-profile.json");
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const REBUILD_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // weekly

export interface TasteProfile {
  builtAt: string;
  topChannels: string[];   // most-watched/liked channels
  topKeywords: string[];   // recurring topic words from titles
  searchQueries: string[]; // taste-derived YouTube search strings
  sources: { liked: number; watched: number };
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","at","by","from",
  "is","are","was","were","be","been","this","that","these","those","how","why","what",
  "who","when","where","you","your","i","we","they","it","its","his","her","their",
  "vs","ep","episode","full","part","ft","feat","podcast","interview","talk","video",
  "2024","2025","2026","new","best","top","my","me","about","into","out","up","do","does",
  // brand-noise stopwords
  "sunstone","colleges","college","mba","bca","btech","exam","admission","campus",
  "placement","degree","students","student","course","courses","vedam","stride","mirai",
]);

/**
 * Channels owned/operated by Ankur's company or watched purely for business monitoring.
 * Excluded from taste profile so they don't skew recommendations toward student content.
 */
const BLOCKED_CHANNELS = [
  "MBA Fundas by Sunstone",
  "Sunstone",
  "BCA Fundas by Sunstone",
  "Campus to CEO",
  "Vedam School of Technology",
  "Vedam",
  "Stride",
  "Mirai",
  "Alta",
  "JITO",
  "StartupIndia",
];

function isBlockedChannel(channel: string): boolean {
  const c = (channel || "").trim().toLowerCase();
  return BLOCKED_CHANNELS.some(b => c === b.toLowerCase() || c.startsWith(b.toLowerCase() + " "));
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function ytGet<T>(p: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${YOUTUBE_API}${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface PlaylistItem {
  snippet?: { title?: string; videoOwnerChannelTitle?: string; channelTitle?: string };
}

/** Fetch titles + channels from the user's "Liked videos" playlist (id "LL"). */
async function fetchLikedVideos(token: string, max = 100): Promise<{ title: string; channel: string }[]> {
  const out: { title: string; channel: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 2 && out.length < max; page++) {
    const data = await ytGet<{ items: PlaylistItem[]; nextPageToken?: string }>(
      `/playlistItems?part=snippet&playlistId=LL&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token
    );
    if (!data?.items?.length) break;
    for (const it of data.items) {
      const title = it.snippet?.title ?? "";
      const channel = it.snippet?.videoOwnerChannelTitle ?? it.snippet?.channelTitle ?? "";
      if (title && title !== "Private video" && title !== "Deleted video") {
        out.push({ title, channel });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

function topN(counts: Map<string, number>, n: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map((e) => e[0]);
}

/** Build the taste profile from liked videos + watch history. */
export async function buildTasteProfile(): Promise<TasteProfile> {
  ensureDir();
  const token = await getRefreshedYouTubeToken();

  const liked = token ? await fetchLikedVideos(token) : [];
  const watch = loadWatchHistory()?.videos ?? [];

  const channelCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();

  const ingest = (title: string, channel: string) => {
    if (!title) return;
    if (looksLikeEntertainment(title, channel)) return;
    if (isBlockedChannel(channel)) return;  // skip company/monitoring channels
    if (channel) channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 4 || STOPWORDS.has(raw)) continue;
      wordCounts.set(raw, (wordCounts.get(raw) ?? 0) + 1);
    }
  };

  for (const v of liked) ingest(v.title, v.channel);
  for (const v of watch) ingest(v.title, v.channel);

  const topChannels = topN(channelCounts, 8);
  const topKeywords = topN(wordCounts, 12);

  // Taste-derived search queries: a few top channels + keyword pairs
  const searchQueries: string[] = [];
  for (const c of topChannels.slice(0, 4)) searchQueries.push(`${c} interview`);
  for (let i = 0; i + 1 < topKeywords.length && searchQueries.length < 8; i += 2) {
    searchQueries.push(`${topKeywords[i]} ${topKeywords[i + 1]}`);
  }

  const profile: TasteProfile = {
    builtAt: new Date().toISOString(),
    topChannels,
    topKeywords,
    searchQueries,
    sources: { liked: liked.length, watched: watch.length },
  };
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
  return profile;
}

export function loadTasteProfile(): TasteProfile | null {
  try {
    if (fs.existsSync(PROFILE_FILE)) return JSON.parse(fs.readFileSync(PROFILE_FILE, "utf-8"));
  } catch {}
  return null;
}

/** Return a profile, rebuilding if missing or older than a week. */
export async function getTasteProfile(forceRebuild = false): Promise<TasteProfile> {
  const existing = loadTasteProfile();
  const stale =
    !existing || Date.now() - new Date(existing.builtAt).getTime() > REBUILD_AFTER_MS;
  if (forceRebuild || stale) {
    try {
      return await buildTasteProfile();
    } catch (e) {
      console.warn("[DonnaFM/taste] rebuild failed:", e);
      if (existing) return existing;
      return {
        builtAt: new Date().toISOString(),
        topChannels: [], topKeywords: [], searchQueries: [],
        sources: { liked: 0, watched: 0 },
      };
    }
  }
  return existing;
}
