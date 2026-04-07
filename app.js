import { SPOTIFY_CONFIG } from "./config.js";

const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const refreshButton = document.getElementById("refreshButton");
const autoRefreshToggle = document.getElementById("autoRefreshToggle");
const statusValue = document.getElementById("statusValue");
const albumArt = document.getElementById("albumArt");
const trackName = document.getElementById("trackName");
const artistName = document.getElementById("artistName");
const albumName = document.getElementById("albumName");
const progress = document.getElementById("progress");

const TOKEN_STORAGE_KEY = "spotify_token_bundle";
const CODE_VERIFIER_KEY = "spotify_code_verifier";
const AUTO_REFRESH_KEY = "spotify_auto_refresh";

let autoRefreshInterval = null;

const isConfigReady = () => {
  return (
    SPOTIFY_CONFIG.clientId &&
    SPOTIFY_CONFIG.clientId !== "YOUR_SPOTIFY_CLIENT_ID" &&
    SPOTIFY_CONFIG.redirectUri
  );
};

const updateStatus = (message) => {
  statusValue.textContent = message;
};

const base64UrlEncode = (buffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
};

const generateRandomString = (length = 64) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => x.toString(16).padStart(2, "0")).join("");
};

const saveTokenBundle = (bundle) => {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(bundle));
};

const readTokenBundle = () => {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const clearTokenBundle = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
};

const isTokenExpired = (bundle) => {
  if (!bundle || !bundle.expires_at) {
    return true;
  }
  return Date.now() >= bundle.expires_at - 60000;
};

const buildAuthorizeUrl = async () => {
  const verifier = generateRandomString();
  const challenge = base64UrlEncode(await sha256(verifier));
  sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CONFIG.clientId,
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_CONFIG.scopes.join(" ")
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
};

const exchangeCodeForToken = async (code) => {
  const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error("Missing PKCE verifier");
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_verifier: verifier
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json();
  saveTokenBundle({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  });
};

const refreshAccessToken = async (bundle) => {
  if (!bundle?.refresh_token) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: "refresh_token",
    refresh_token: bundle.refresh_token
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = await response.json();
  const updatedBundle = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || bundle.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  };

  saveTokenBundle(updatedBundle);
  return updatedBundle;
};

const ensureValidToken = async () => {
  const bundle = readTokenBundle();
  if (!bundle) {
    return null;
  }

  if (!isTokenExpired(bundle)) {
    return bundle;
  }

  try {
    return await refreshAccessToken(bundle);
  } catch (error) {
    console.error(error);
    clearTokenBundle();
    return null;
  }
};

const formatProgress = (progressMs, durationMs) => {
  if (typeof progressMs !== "number" || typeof durationMs !== "number") {
    return "-";
  }
  const toTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  return `${toTime(progressMs)} / ${toTime(durationMs)}`;
};

const setTrackLoading = () => {
  albumArt.src = "";
  albumArt.style.opacity = "0.3";
  trackName.textContent = "Loading...";
  artistName.textContent = "-";
  albumName.textContent = "-";
  progress.textContent = "-";
};

const setTrackEmpty = (message) => {
  albumArt.src = "";
  albumArt.style.opacity = "0.3";
  trackName.textContent = message;
  artistName.textContent = "-";
  albumName.textContent = "-";
  progress.textContent = "-";
};

const renderTrack = (item, playback) => {
  const artists = item.artists.map((artist) => artist.name).join(", ");
  const image = item.album?.images?.[0]?.url;
  albumArt.src = image || "";
  albumArt.style.opacity = image ? "1" : "0.3";
  trackName.textContent = item.name || "Unknown track";
  artistName.textContent = artists || "Unknown artist";
  albumName.textContent = item.album?.name || "Unknown album";
  progress.textContent = formatProgress(
    playback.progress_ms,
    item.duration_ms
  );
};

const fetchCurrentlyPlaying = async () => {
  const bundle = await ensureValidToken();
  if (!bundle) {
    updateStatus("Not connected");
    setTrackEmpty("Connect Spotify to see playback");
    return;
  }

  setTrackLoading();
  updateStatus("Checking playback...");

  const response = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    {
      headers: {
        Authorization: `Bearer ${bundle.access_token}`
      }
    }
  );

  if (response.status === 204) {
    updateStatus("Nothing playing");
    setTrackEmpty("Nothing playing");
    return;
  }

  if (!response.ok) {
    const errorText = await response.text();
    updateStatus("Playback request failed");
    setTrackEmpty("Unable to load playback");
    console.error(errorText);
    return;
  }

  const data = await response.json();
  if (!data?.item) {
    updateStatus("Nothing playing");
    setTrackEmpty("Nothing playing");
    return;
  }

  updateStatus(data.is_playing ? "Playing" : "Paused");
  renderTrack(data.item, data);
};

const setAutoRefresh = (enabled) => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  if (enabled) {
    autoRefreshInterval = setInterval(fetchCurrentlyPlaying, 15000);
  }
  localStorage.setItem(AUTO_REFRESH_KEY, enabled ? "true" : "false");
};

const restoreAutoRefresh = () => {
  const stored = localStorage.getItem(AUTO_REFRESH_KEY);
  const enabled = stored === "true";
  autoRefreshToggle.checked = enabled;
  if (enabled) {
    setAutoRefresh(true);
  }
};

const handleAuthCallback = async () => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    updateStatus(`Auth error: ${error}`);
    return;
  }

  if (!code) {
    return;
  }

  try {
    updateStatus("Finishing sign in...");
    await exchangeCodeForToken(code);
    url.searchParams.delete("code");
    window.history.replaceState({}, document.title, url.toString());
  } catch (err) {
    console.error(err);
    updateStatus("Sign in failed");
  }
};

const updateButtons = (connected) => {
  loginButton.disabled = connected;
  logoutButton.disabled = !connected;
  refreshButton.disabled = !connected;
};

const init = async () => {
  if (!isConfigReady()) {
    updateStatus("Missing Spotify client ID");
    loginButton.disabled = true;
    refreshButton.disabled = true;
    logoutButton.disabled = true;
    setTrackEmpty("Set your client ID in config.js");
    return;
  }

  await handleAuthCallback();
  const bundle = await ensureValidToken();
  const connected = Boolean(bundle?.access_token);
  updateButtons(connected);
  updateStatus(connected ? "Connected" : "Not connected");
  restoreAutoRefresh();

  if (connected) {
    fetchCurrentlyPlaying();
  } else {
    setTrackEmpty("Connect Spotify to see playback");
  }
};

loginButton.addEventListener("click", async () => {
  if (!isConfigReady()) {
    updateStatus("Missing Spotify client ID");
    return;
  }
  const authorizeUrl = await buildAuthorizeUrl();
  window.location.assign(authorizeUrl);
});

logoutButton.addEventListener("click", () => {
  clearTokenBundle();
  sessionStorage.removeItem(CODE_VERIFIER_KEY);
  updateButtons(false);
  updateStatus("Logged out");
  setTrackEmpty("Connect Spotify to see playback");
});

refreshButton.addEventListener("click", fetchCurrentlyPlaying);

autoRefreshToggle.addEventListener("change", (event) => {
  setAutoRefresh(event.target.checked);
});

init();
