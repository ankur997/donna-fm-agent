/**
 * Donna FM — Google Takeout watch-history ingestion.
 * AJ exports "YouTube and YouTube Music → history → watch-history.json" from
 * https://takeout.google.com and uploads it. We parse it, drop entertainment
 * and ads, keep the last 30 days, and expose channel/title signal for the
 * taste profile.
 */

import fs from "fs";
import path from "path";
import { looksLikeEntertainment } from "./sources";

const DATA_DIR = path.join(process.cwd(), "data");
const WATCH_FILE = path.join(DATA_DIR, "donna-watch-history.json");

export interface WatchedVideo {
  title: string;       // video title (without "Watched " prefix)
  channel: string;     // channel name
  watchedAt: string;   // ISO
}

// Raw Takeout entry shape (only the fields we use)
interface TakeoutEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string; url?: string }[];
  time?: string;
  details?: { name?: string }[];
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Parse a raw Takeout watch-history JSON (array) into clean WatchedVideo[],
 * filtering ads, removed videos, entertainment, and anything older than `days`.
 */
export function parseTakeout(raw: unknown, days = 30): WatchedVideo[] {
  if (!Array.isArray(raw)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const out: WatchedVideo[] = [];

  for (const e of raw as TakeoutEntry[]) {
    // Must be a real watched YouTube video
    if (!e.titleUrl || !e.title) continue;
    if (!e.titleUrl.includes("watch?v=")) continue;
    // Skip ads
    if ((e.details ?? []).some((d) => (d.name ?? "").toLowerCase().includes("ads"))) continue;
    // Time window
    if (e.time && new Date(e.time).getTime() < cutoff) continue;

    const title = e.title.replace(/^Watched\s+/i, "").trim();
    const channel = e.subtitles?.[0]?.name?.trim() ?? "";
    if (!title) continue;
    // Drop entertainment / music
    if (looksLikeEntertainment(title, channel)) continue;

    out.push({ title, channel, watchedAt: e.time ?? "" });
  }
  return out;
}

/** Persist the cleaned watch history to disk. Returns the cleaned list. */
export function saveWatchHistory(raw: unknown, days = 30): WatchedVideo[] {
  ensureDir();
  const cleaned = parseTakeout(raw, days);
  fs.writeFileSync(
    WATCH_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), days, videos: cleaned }, null, 2)
  );
  return cleaned;
}

export interface WatchHistoryFile {
  updatedAt: string;
  days: number;
  videos: WatchedVideo[];
}

export function loadWatchHistory(): WatchHistoryFile | null {
  try {
    if (fs.existsSync(WATCH_FILE)) return JSON.parse(fs.readFileSync(WATCH_FILE, "utf-8"));
  } catch {}
  return null;
}
