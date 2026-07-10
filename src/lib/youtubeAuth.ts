import { google } from "googleapis";
import fs from "fs";
import path from "path";

const YOUTUBE_TOKEN_PATH = process.env.YOUTUBE_TOKEN_PATH
  || path.join(process.cwd(), "data", "youtube-token.json");

export function getYouTubeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || "https://mc.aj2k.in/api/auth/youtube/callback"
  );
}

export function getYouTubeAuthUrl(): string {
  const auth = getYouTubeOAuthClient();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.readonly",
      // youtube.force-ssl (restricted scope) removed — not needed for feed/viewing behaviour.
      // It was causing Google to issue short-lived (~29h) refresh tokens in Testing mode.
    ],
  });
}

export function saveYouTubeToken(tokens: object) {
  fs.mkdirSync(path.dirname(YOUTUBE_TOKEN_PATH), { recursive: true });
  fs.writeFileSync(YOUTUBE_TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function loadYouTubeToken(): { access_token: string; refresh_token?: string; scope?: string } | null {
  try {
    if (!fs.existsSync(YOUTUBE_TOKEN_PATH)) return null;
    const t = JSON.parse(fs.readFileSync(YOUTUBE_TOKEN_PATH, "utf-8"));
    if (!t.access_token) return null;
    return t;
  } catch {
    return null;
  }
}

export function isYouTubeConnected(): boolean {
  return loadYouTubeToken() !== null;
}

/**
 * Returns true if the stored refresh token has expired.
 * This happens when the Google Cloud OAuth app is in "Testing" mode —
 * refresh tokens are issued with a short TTL (often ~24-29h).
 * Fix: publish the app in Google Cloud Console → OAuth consent screen.
 */
export function isYouTubeRefreshTokenExpired(): boolean {
  const token = loadYouTubeToken() as Record<string, unknown> | null;
  if (!token) return false;
  const refreshExpiresIn = token.refresh_token_expires_in as number | undefined;
  const expiryDate       = token.expiry_date as number | undefined;
  if (!refreshExpiresIn || !expiryDate) return false;

  // Access token was issued ~1 hour before expiry_date.
  // Refresh token was issued at the same time.
  const issuedAtMs         = expiryDate - 3600 * 1000;
  const refreshExpiresAtMs = issuedAtMs + refreshExpiresIn * 1000;
  return Date.now() > refreshExpiresAtMs;
}

/**
 * Returns the absolute timestamp (ms) at which the refresh token expires,
 * or null if unknown (not connected, or token predates refresh_token_expires_in).
 * Used to send an advance-warning WhatsApp alert before the Testing-mode
 * ~7-day refresh token lapses (see comment above isYouTubeRefreshTokenExpired).
 */
export function getYouTubeRefreshExpiryMs(): number | null {
  const token = loadYouTubeToken() as Record<string, unknown> | null;
  if (!token) return null;
  const refreshExpiresIn = token.refresh_token_expires_in as number | undefined;
  const expiryDate       = token.expiry_date as number | undefined;
  if (!refreshExpiresIn || !expiryDate) return null;
  const issuedAtMs = expiryDate - 3600 * 1000;
  return issuedAtMs + refreshExpiresIn * 1000;
}

export async function getRefreshedYouTubeToken(): Promise<string | null> {
  const token = loadYouTubeToken();
  if (!token) return null;

  // Short-circuit early if we can already tell the refresh token is expired
  if (isYouTubeRefreshTokenExpired()) {
    console.warn("[YouTube] Refresh token has expired — user must re-authorise");
    return null;
  }

  const auth = getYouTubeOAuthClient();
  auth.setCredentials(token as Parameters<typeof auth.setCredentials>[0]);

  // Auto-save refreshed tokens to disk whenever googleapis rotates them
  auth.on("tokens", (newTokens) => {
    const existing = loadYouTubeToken() as Record<string, unknown> | null;
    saveYouTubeToken({ ...(existing ?? {}), ...newTokens });
  });

  // Proactive refresh: if the token expires within 10 minutes, force a refresh now
  // rather than waiting for googleapis to notice at call time.
  // This prevents the health check from seeing a briefly-stale token right at expiry.
  const expiryDate = (token as Record<string, unknown>).expiry_date as number | undefined;
  const expiresInMs = expiryDate ? expiryDate - Date.now() : Infinity;
  const needsProactiveRefresh = expiresInMs < 10 * 60 * 1000; // < 10 minutes

  try {
    if (needsProactiveRefresh && (token as Record<string, unknown>).refresh_token) {
      // Force a token refresh by calling refreshAccessToken directly
      const { credentials } = await auth.refreshAccessToken();
      saveYouTubeToken({ ...(token as Record<string, unknown>), ...credentials });
      return (credentials.access_token as string) ?? token.access_token;
    }

    const { token: accessToken } = await auth.getAccessToken();
    return accessToken ?? token.access_token;
  } catch (err) {
    // If refresh fails (revoked token, network error, etc.), log it but don't
    // silently return the expired token — return null so callers know auth is broken
    console.error("[YouTube] Token refresh failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
