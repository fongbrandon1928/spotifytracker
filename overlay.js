import { SPOTIFY_CONFIG } from "./config.js";

const overlay = document.getElementById("overlay");
const connectButton = document.getElementById("connectButton");
const albumArt = document.getElementById("albumArt");
const trackName = document.getElementById("trackName");
const artistName = document.getElementById("artistName");
const progressFill = document.getElementById("progressFill");

const TOKEN_KEY = "spotify_token_bundle";
const VERIFIER_KEY = "spotify_code_verifier";
const POLL_MS = 5000;

let lastTrackId = null;
let localProgressMs = 0;
let trackDurationMs = 0;
let isPlaying = false;
let tickTimer = null;

/* ── Crypto helpers (PKCE) ──────────────────────────── */

const base64Url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sha256 = (plain) =>
  crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));

const randomHex = (len = 64) => {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

/* ── Token management ──────────────────────────────── */

const saveToken = (b) => localStorage.setItem(TOKEN_KEY, JSON.stringify(b));
const readToken = () => {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
};
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const isExpired = (b) => !b?.expires_at || Date.now() >= b.expires_at - 60_000;

const refreshToken = async (bundle) => {
  if (!bundle?.refresh_token) return null;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CONFIG.clientId,
      grant_type: "refresh_token",
      refresh_token: bundle.refresh_token,
    }),
  });

  if (!res.ok) throw new Error("Token refresh failed");

  const d = await res.json();
  const updated = {
    access_token: d.access_token,
    refresh_token: d.refresh_token || bundle.refresh_token,
    expires_at: Date.now() + d.expires_in * 1000,
  };
  saveToken(updated);
  return updated;
};

const validToken = async () => {
  const b = readToken();
  if (!b) return null;
  if (!isExpired(b)) return b;
  try {
    return await refreshToken(b);
  } catch {
    clearToken();
    return null;
  }
};

/* ── Auth flow (PKCE) ──────────────────────────────── */

const startLogin = async () => {
  const verifier = randomHex();
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CONFIG.clientId,
    redirect_uri: SPOTIFY_CONFIG.overlayRedirectUri || SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_CONFIG.scopes.join(" "),
  });

  window.location.assign(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
};

const handleCallback = async () => {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CONFIG.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_CONFIG.overlayRedirectUri || SPOTIFY_CONFIG.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) return;

  const d = await res.json();
  saveToken({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + d.expires_in * 1000,
  });

  url.searchParams.delete("code");
  history.replaceState({}, document.title, url.toString());
};

/* ── Now-playing fetch & render ────────────────────── */

const updateProgressBar = () => {
  if (trackDurationMs <= 0) return;
  const pct = Math.min((localProgressMs / trackDurationMs) * 100, 100).toFixed(2);
  progressFill.style.width = `${pct}%`;
};

const startTick = () => {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    if (!isPlaying || trackDurationMs <= 0) return;
    localProgressMs = Math.min(localProgressMs + 1000, trackDurationMs);
    updateProgressBar();
  }, 1000);
};

const stopTick = () => {
  clearInterval(tickTimer);
  tickTimer = null;
};

const applyScrollIfNeeded = (span) => {
  span.classList.remove("scrolling");
  span.style.removeProperty("--scroll-distance");
  span.style.removeProperty("--scroll-duration");

  requestAnimationFrame(() => {
    const container = span.parentElement;
    const overflow = span.scrollWidth - container.clientWidth;
    if (overflow > 0) {
      const duration = Math.max(5, overflow / 30);
      span.style.setProperty("--scroll-distance", `-${overflow}px`);
      span.style.setProperty("--scroll-duration", `${duration}s`);
      span.classList.add("scrolling");
    }
  });
};

const renderTrack = (item, data) => {
  const newId = item.id;
  const artUrl = item.album?.images?.[0]?.url;

  if (newId !== lastTrackId) {
    lastTrackId = newId;
    trackName.textContent = item.name || "Unknown";
    artistName.textContent =
      item.artists?.map((a) => a.name).join(", ") || "Unknown";

    applyScrollIfNeeded(trackName);
    applyScrollIfNeeded(artistName);

    if (artUrl) {
      albumArt.classList.remove("loaded");
      albumArt.onload = () => albumArt.classList.add("loaded");
      albumArt.src = artUrl;
    }
  }

  localProgressMs = data.progress_ms ?? 0;
  trackDurationMs = item.duration_ms ?? 0;
  isPlaying = data.is_playing;
  updateProgressBar();
  startTick();
};

const poll = async () => {
  const bundle = await validToken();
  if (!bundle) {
    overlay.classList.add("hidden");
    connectButton.classList.remove("hidden");
    return;
  }

  connectButton.classList.add("hidden");

  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${bundle.access_token}` } }
  );

  if (res.status === 204 || !res.ok) {
    overlay.classList.add("hidden");
    isPlaying = false;
    stopTick();
    return;
  }

  const data = await res.json();
  if (!data?.item || !data.is_playing) {
    overlay.classList.add("hidden");
    isPlaying = false;
    stopTick();
    return;
  }

  overlay.classList.remove("hidden");
  renderTrack(data.item, data);
};

/* ── Bootstrap ─────────────────────────────────────── */

const init = async () => {
  await handleCallback();
  connectButton.addEventListener("click", startLogin);
  poll();
  setInterval(poll, POLL_MS);
};

init();
