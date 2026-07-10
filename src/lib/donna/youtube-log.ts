import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "donna-youtube-log.json");

export interface YouTubeLogEntry {
  videoId: string;
  title: string;
  channelName: string;
  url: string;
  thumbnail: string;
  sentAt: string;
  recId: string;
  slot: number;
  feedback: "like" | "dislike" | null;
  topics: string[];
  summary?: string;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getYouTubeLog(): YouTubeLogEntry[] {
  try {
    if (fs.existsSync(LOG_FILE)) return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveLog(entries: YouTubeLogEntry[]) {
  ensureDir();
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") {
      return u.pathname.slice(1).split("?")[0];
    }
    return u.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

export function logYouTubeItem(entry: Omit<YouTubeLogEntry, "feedback">): void {
  const log = getYouTubeLog();
  // Don't duplicate same video across multiple sends
  if (log.some((e) => e.videoId === entry.videoId)) return;
  log.unshift({ ...entry, feedback: null });
  saveLog(log.slice(0, 300));
}

export function setVideoFeedback(
  videoId: string,
  feedback: "like" | "dislike" | null
): YouTubeLogEntry | null {
  const log = getYouTubeLog();
  const idx = log.findIndex((e) => e.videoId === videoId);
  if (idx === -1) return null;
  log[idx].feedback = feedback;
  saveLog(log);
  return log[idx];
}

export function getDislikedVideoIds(): Set<string> {
  return new Set(
    getYouTubeLog()
      .filter((e) => e.feedback === "dislike")
      .map((e) => e.videoId)
  );
}

export function getLikedChannels(): string[] {
  const seen = new Set<string>();
  return getYouTubeLog()
    .filter((e) => e.feedback === "like")
    .map((e) => e.channelName)
    .filter((ch) => { if (seen.has(ch)) return false; seen.add(ch); return true; });
}
