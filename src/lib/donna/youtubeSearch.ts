/**
 * Donna FM — YouTube search-based candidate generation.
 * Searches YouTube (not just subscriptions) for "becoming popular" long-form
 * videos from respected channels, across AJ's topics + taste-derived queries.
 */

import { getRefreshedYouTubeToken } from "../youtubeAuth.js";
import {
  THRESHOLDS,
  passesQualityGate,
  looksLikeEntertainment,
  looksLikeNonEnglish,
} from "./sources";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export interface SearchedVideo {
  id: string;
  title: string;
  channelName: string;
  channelId: string;
  description: string;
  url: string;
  thumbnail?: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  viewsPerDay: number;
  subscriberCount: number;
  source: "youtube";
}

function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return parseInt(m[1] || "0") * 3600 + parseInt(m[2] || "0") * 60 + parseInt(m[3] || "0");
}

async function ytGet<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${YOUTUBE_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[DonnaFM/search] ${res.status} on ${path.slice(0, 60)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface SearchListItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelId?: string; channelTitle?: string };
}
interface VideoListItem {
  id: string;
  snippet?: {
    title?: string; description?: string; publishedAt?: string;
    channelId?: string; channelTitle?: string;
    thumbnails?: { medium?: { url?: string } };
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
}
interface ChannelListItem {
  id: string;
  statistics?: { subscriberCount?: string };
}

/**
 * Run YouTube searches for the given query strings and return enriched,
 * quality- and popularity-filtered candidates.
 */
export async function searchYouTubeCandidates(
  queries: string[],
  perQuery = 8
): Promise<SearchedVideo[]> {
  const token = await getRefreshedYouTubeToken();
  if (!token) {
    console.warn("[DonnaFM/search] No YouTube token — cannot search");
    return [];
  }

  const publishedAfter = new Date(
    Date.now() - THRESHOLDS.MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // 1. Collect video IDs from each search (order=viewCount → most-viewed first)
  const idSet = new Set<string>();
  const uniqueQueries = Array.from(new Set(queries.filter(Boolean))).slice(0, 18);
  for (const q of uniqueQueries) {
    const data = await ytGet<{ items: SearchListItem[] }>(
      `/search?part=snippet&type=video&order=viewCount&relevanceLanguage=en` +
        `&publishedAfter=${encodeURIComponent(publishedAfter)}` +
        `&maxResults=${perQuery}&q=${encodeURIComponent(q)}`,
      token
    );
    for (const it of data?.items ?? []) {
      const vid = it.id?.videoId;
      if (vid) idSet.add(vid);
    }
  }
  const ids = Array.from(idSet);
  if (ids.length === 0) return [];

  // 2. Hydrate full video data (snippet + duration + stats) in batches of 50
  const videos: VideoListItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    const data = await ytGet<{ items: VideoListItem[] }>(
      `/videos?part=snippet,contentDetails,statistics&id=${batch}&maxResults=50`,
      token
    );
    for (const it of data?.items ?? []) videos.push(it);
  }

  // 3. Subscriber counts for all involved channels
  const channelIds = Array.from(
    new Set(videos.map((v) => v.snippet?.channelId).filter(Boolean) as string[])
  );
  const subsMap = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50).join(",");
    const data = await ytGet<{ items: ChannelListItem[] }>(
      `/channels?part=statistics&id=${batch}&maxResults=50`,
      token
    );
    for (const c of data?.items ?? []) {
      subsMap.set(c.id, parseInt(c.statistics?.subscriberCount ?? "0", 10) || 0);
    }
  }

  // 4. Build, filter, score
  const now = Date.now();
  const out: SearchedVideo[] = [];
  for (const v of videos) {
    const id = v.id;
    const title = v.snippet?.title ?? "";
    const description = (v.snippet?.description ?? "").slice(0, 400);
    const channelId = v.snippet?.channelId ?? "";
    const channelName = v.snippet?.channelTitle ?? "";
    const publishedAt = v.snippet?.publishedAt ?? "";
    if (!id || !title || !publishedAt) continue;

    const durationSeconds = parseDuration(v.contentDetails?.duration ?? "");
    const viewCount = parseInt(v.statistics?.viewCount ?? "0", 10) || 0;
    const ageMs = now - new Date(publishedAt).getTime();
    const ageHours = ageMs / 3_600_000;
    const ageDays = Math.max(ageMs / 86_400_000, 0.5);
    const viewsPerDay = viewCount / ageDays;
    const subscriberCount = subsMap.get(channelId) ?? 0;

    // Duration / shorts
    if (durationSeconds < THRESHOLDS.MIN_DURATION_SECONDS) continue;
    // Age window — not brand new, not older than 30d
    if (ageHours < THRESHOLDS.MIN_AGE_HOURS) continue;
    if (ageDays > THRESHOLDS.MAX_AGE_DAYS) continue;
    // Popularity / "becoming popular"
    if (viewCount < THRESHOLDS.MIN_TOTAL_VIEWS) continue;
    if (viewsPerDay < THRESHOLDS.MIN_VIEWS_PER_DAY) continue;
    // Entertainment / low-signal
    if (looksLikeEntertainment(title, description)) continue;
    // Language filter — only English content
    if (looksLikeNonEnglish(title, channelName)) continue;
    // Respected source gate
    if (!passesQualityGate(channelName, subscriberCount)) continue;

    out.push({
      id, title, channelName, channelId, description,
      url: `https://youtube.com/watch?v=${id}`,
      thumbnail: v.snippet?.thumbnails?.medium?.url,
      publishedAt, durationSeconds, viewCount, viewsPerDay, subscriberCount,
      source: "youtube",
    });
  }

  // Highest velocity first
  return out.sort((a, b) => b.viewsPerDay - a.viewsPerDay);
}
