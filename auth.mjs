const SESSION_COOKIE = "picker_session";
const STATE_COOKIE = "picker_oauth_state";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltText, hash] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !saltText || !hash) return false;
  const next = await hashPassword(password, base64ToBytes(saltText));
  return safeEqual(next.split("$")[2] || "", hash);
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function storedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAccount(body) {
  const email = storedEmail(body?.email);
  const password = String(body?.password || "");
  const name = String(body?.name || "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Enter a valid email address.");
    error.status = 400;
    throw error;
  }
  if (password.length < 8) {
    const error = new Error("Use a password of at least 8 characters.");
    error.status = 400;
    throw error;
  }
  return { email, password, name };
}

export function googleAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email profile ${YOUTUBE_SCOPE}`);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

function youtubeThumb(thumbnails, fallback = "") {
  return String(thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || fallback || "");
}

export function formatYouTubeDuration(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return "";
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const pad = (part) => String(part).padStart(2, "0");
  if (hours) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export async function fetchSubscriptionFeed(accessToken, fetchImpl = fetch, options = {}) {
  const channelLimit = options.channelLimit || 15;
  const perChannel = options.perChannel || 1;
  const videoLimit = options.videoLimit || 12;
  const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=${channelLimit}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "YouTube could not load subscriptions.");
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }
  const channels = parseYouTubeSubscriptions(payload);
  const videos = [];
  await Promise.all(channels.map(async (channel) => {
    if (!channel.id.startsWith("UC")) return;
    const playlistId = `UU${channel.id.slice(2)}`;
    const latest = await fetchImpl(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${perChannel}&playlistId=${playlistId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!latest.ok) return;
    const data = await latest.json().catch(() => ({}));
    for (const item of Array.isArray(data.items) ? data.items : []) {
      const snippet = item?.snippet;
      const videoId = snippet?.resourceId?.videoId;
      if (!videoId || !snippet?.title || snippet.title === "Private video" || snippet.title === "Deleted video") continue;
      videos.push({
        title: snippet.title,
        speaker: channel.title,
        channelId: channel.id,
        channelThumbnail: channel.thumbnail || "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: youtubeThumb(snippet.thumbnails, channel.thumbnail),
        duration: "",
        source: "youtube",
        publishedAt: snippet.publishedAt || "",
      });
    }
  }));
  videos.sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
  return { channels, videos: videos.slice(0, videoLimit) };
}

function youtubeVideo(snippet, source = "youtube") {
  const videoId = String(snippet?.resourceId?.videoId || "");
  const title = String(snippet?.title || "").trim();
  if (!videoId || !title || title === "Private video" || title === "Deleted video") return null;
  return {
    title,
    speaker: String(snippet.videoOwnerChannelTitle || snippet.channelTitle || ""),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: String(snippet.videoOwnerChannelId || snippet.channelId || ""),
    channelThumbnail: "",
    thumbnail: youtubeThumb(snippet.thumbnails),
    duration: "",
    source,
    publishedAt: String(snippet.publishedAt || ""),
  };
}

export async function fetchPlaylistVideos(accessToken, playlistId, fetchImpl = fetch) {
  if (!/^[\w-]{2,80}$/.test(playlistId)) return [];
  const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=12&playlistId=${encodeURIComponent(playlistId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => youtubeVideo(item?.snippet))
    .filter(Boolean);
}

async function fetchYouTubePlaylists(accessToken, fetchImpl) {
  const response = await fetchImpl("https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=25", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload.items) ? payload.items : []).flatMap((item) => {
    const id = String(item?.id || "");
    const title = String(item?.snippet?.title || "").trim();
    if (!id || !title) return [];
    return [{
      id,
      title,
      thumbnail: youtubeThumb(item.snippet?.thumbnails),
      count: Number(item.contentDetails?.itemCount || 0),
    }];
  });
}

async function fetchYouTubeActivity(accessToken, fetchImpl) {
  const response = await fetchImpl("https://www.googleapis.com/youtube/v3/activities?part=snippet,contentDetails&mine=true&maxResults=15", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload.items) ? payload.items : []).flatMap((item) => {
    const details = item?.contentDetails || {};
    const videoId = details.upload?.videoId
      || details.like?.resourceId?.videoId
      || details.playlistItem?.resourceId?.videoId
      || details.favorite?.resourceId?.videoId
      || "";
    if (!videoId) return [];
    const snippet = item.snippet || {};
    const kind = snippet.type === "upload" ? "Upload" : snippet.type === "like" ? "Liked" : snippet.type === "playlistItem" ? "Playlist" : "YouTube";
    const video = youtubeVideo({
      title: snippet.title,
      channelTitle: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      thumbnails: snippet.thumbnails,
      resourceId: { videoId },
    }, kind);
    return video ? [video] : [];
  });
}

async function attachYouTubeDurations(accessToken, videos, fetchImpl) {
  const ids = [...new Set(videos.map((video) => {
    const match = String(video.url || "").match(/[?&]v=([\w-]{6,})/);
    return match?.[1] || "";
  }).filter(Boolean))].slice(0, 50);
  if (!ids.length) return videos;
  try {
    const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(",")}&maxResults=50`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return videos;
    const payload = await response.json().catch(() => ({}));
    const durations = new Map((payload.items || []).map((item) => [item.id, formatYouTubeDuration(item.contentDetails?.duration)]));
    return videos.map((video) => {
      const match = String(video.url || "").match(/[?&]v=([\w-]{6,})/);
      const duration = durations.get(match?.[1] || "") || video.duration;
      return duration ? { ...video, duration } : video;
    });
  } catch {
    return videos;
  }
}

export async function fetchYouTubeHome(accessToken, fetchImpl = fetch) {
  const feed = await fetchSubscriptionFeed(accessToken, fetchImpl, { channelLimit: 20, perChannel: 2, videoLimit: 24 });
  const [playlists, liked, activity] = await Promise.all([
    fetchYouTubePlaylists(accessToken, fetchImpl).catch(() => []),
    fetchPlaylistVideos(accessToken, "LL", fetchImpl).catch(() => []),
    fetchYouTubeActivity(accessToken, fetchImpl).catch(() => []),
  ]);
  const timed = await attachYouTubeDurations(accessToken, [...feed.videos, ...liked], fetchImpl);
  return {
    ...feed,
    videos: timed.slice(0, feed.videos.length),
    playlists,
    liked: timed.slice(feed.videos.length),
    activity,
  };
}

export function parseYouTubeSubscriptions(payload) {
  return (Array.isArray(payload?.items) ? payload.items : []).flatMap((item) => {
    const id = String(item?.snippet?.resourceId?.channelId || "");
    const title = String(item?.snippet?.title || "").trim();
    if (!id || !title) return [];
    return [{
      id,
      title,
      thumbnail: String(item?.snippet?.thumbnails?.default?.url || item?.snippet?.thumbnails?.medium?.url || ""),
    }];
  });
}

export function createMemoryAccountStore() {
  const users = new Map();
  const sessions = new Map();
  const states = new Map();
  const tokens = new Map();
  return {
    async putState(id, expiresAt) {
      states.set(id, expiresAt);
    },
    async takeState(id) {
      const expiresAt = states.get(id);
      states.delete(id);
      return Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
    },
    async upsertGoogleUser(profile, tokenSet) {
      const googleSub = String(profile.sub || "");
      if (!googleSub) throw new Error("Google did not return an account id.");
      const email = storedEmail(profile.email);
      let user = [...users.values()].find((item) => item.googleSub === googleSub);
      if (!user && email) {
        user = [...users.values()].find((item) => item.email === email);
        if (user) user.googleSub = googleSub;
      }
      if (!user) {
        user = {
          id: crypto.randomUUID(),
          googleSub,
          email,
          name: profile.name || "",
          picture: profile.picture || "",
          createdAt: new Date().toISOString(),
        };
        users.set(user.id, user);
      } else {
        user.email = email || user.email;
        user.name = profile.name || user.name;
        user.picture = profile.picture || user.picture;
      }
      const current = tokens.get(user.id) || {};
      tokens.set(user.id, {
        refreshToken: tokenSet.refreshToken || current.refreshToken || "",
        accessToken: tokenSet.accessToken || "",
        accessExpiresAt: tokenSet.accessExpiresAt || "",
      });
      return publicUser(user, tokens.get(user.id));
    },
    async passwordUserByEmail(email) {
      const user = [...users.values()].find((item) => item.email === email && item.passwordHash);
      return user ? { ...publicUser(user, tokens.get(user.id)), passwordHash: user.passwordHash } : null;
    },
    async createPasswordUser({ email, name, passwordHash }) {
      if ([...users.values()].some((item) => item.email === email)) {
        const error = new Error("An account with that email already exists.");
        error.status = 409;
        throw error;
      }
      const user = {
        id: crypto.randomUUID(),
        googleSub: "",
        email,
        name,
        picture: "",
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      users.set(user.id, user);
      return publicUser(user, null);
    },
    async createSession(userId) {
      const id = crypto.randomUUID();
      sessions.set(id, { userId, expiresAt: new Date(Date.now() + SESSION_MS).toISOString() });
      return id;
    },
    async userForSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
      const user = users.get(session.userId);
      if (!user) return null;
      return publicUser(user, tokens.get(user.id));
    },
    async deleteSession(sessionId) {
      sessions.delete(sessionId);
    },
    async tokensForUser(userId) {
      return tokens.get(userId) || null;
    },
    async saveTokens(userId, tokenSet) {
      const current = tokens.get(userId) || {};
      tokens.set(userId, {
        refreshToken: tokenSet.refreshToken || current.refreshToken || "",
        accessToken: tokenSet.accessToken || current.accessToken || "",
        accessExpiresAt: tokenSet.accessExpiresAt || current.accessExpiresAt || "",
        subscriptions: current.subscriptions || null,
      });
    },
    async saveSubscriptions(userId, subscriptions) {
      const current = tokens.get(userId) || {};
      tokens.set(userId, { ...current, subscriptions });
    },
    async subscriptionsForUser(userId) {
      return tokens.get(userId)?.subscriptions || null;
    },
  };
}

export function createD1AccountStore(db) {
  return {
    async putState(id, expiresAt) {
      await db.prepare("INSERT OR REPLACE INTO oauth_states (id, expires_at) VALUES (?, ?)").bind(id, expiresAt).run();
    },
    async takeState(id) {
      const row = await db.prepare("SELECT expires_at FROM oauth_states WHERE id = ?").bind(id).first();
      await db.prepare("DELETE FROM oauth_states WHERE id = ?").bind(id).run();
      return Boolean(row && Date.parse(row.expires_at) > Date.now());
    },
    async upsertGoogleUser(profile, tokenSet) {
      const googleSub = String(profile.sub || "");
      if (!googleSub) throw new Error("Google did not return an account id.");
      const email = storedEmail(profile.email);
      let existing = await db.prepare("SELECT id, email, name, picture, created_at FROM users WHERE google_sub = ?").bind(googleSub).first();
      if (!existing && email) {
        existing = await db.prepare("SELECT id, email, name, picture, created_at FROM users WHERE email = ?").bind(email).first();
        if (existing) await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(googleSub, existing.id).run();
      }
      const id = existing?.id || crypto.randomUUID();
      if (!existing) {
        await db.prepare("INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, googleSub, email, profile.name || "", profile.picture || "", new Date().toISOString())
          .run();
      } else {
        await db.prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?")
          .bind(email || existing.email || "", profile.name || existing.name || "", profile.picture || existing.picture || "", id)
          .run();
      }
      const current = await db.prepare("SELECT refresh_token FROM youtube_tokens WHERE user_id = ?").bind(id).first();
      const refreshToken = tokenSet.refreshToken || current?.refresh_token || "";
      await db.prepare(`INSERT INTO youtube_tokens (user_id, refresh_token, access_token, access_expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          refresh_token = excluded.refresh_token,
          access_token = excluded.access_token,
          access_expires_at = excluded.access_expires_at`)
        .bind(id, refreshToken, tokenSet.accessToken || "", tokenSet.accessExpiresAt || "")
        .run();
      const user = await db.prepare("SELECT id, email, name, picture FROM users WHERE id = ?").bind(id).first();
      return publicUser(rowToUser(user), { refreshToken });
    },
    async passwordUserByEmail(email) {
      const row = await db.prepare("SELECT id, email, name, picture, password_hash FROM users WHERE email = ?").bind(email).first();
      if (!row?.password_hash) return null;
      const token = await db.prepare("SELECT refresh_token FROM youtube_tokens WHERE user_id = ?").bind(row.id).first();
      return { ...publicUser(rowToUser(row), token), passwordHash: row.password_hash };
    },
    async createPasswordUser({ email, name, passwordHash }) {
      const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (existing) {
        const error = new Error("An account with that email already exists.");
        error.status = 409;
        throw error;
      }
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO users (id, google_sub, email, name, picture, password_hash, created_at) VALUES (?, NULL, ?, ?, '', ?, ?)")
        .bind(id, email, name, passwordHash, new Date().toISOString())
        .run();
      return { id, email, name, picture: "", youtubeConnected: false };
    },
    async createSession(userId) {
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(id, userId, new Date(Date.now() + SESSION_MS).toISOString())
        .run();
      return id;
    },
    async userForSession(sessionId) {
      const session = await db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").bind(sessionId).first();
      if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
      const user = await db.prepare("SELECT id, email, name, picture FROM users WHERE id = ?").bind(session.user_id).first();
      if (!user) return null;
      const token = await db.prepare("SELECT refresh_token FROM youtube_tokens WHERE user_id = ?").bind(user.id).first();
      return publicUser(rowToUser(user), token ? { refreshToken: token.refresh_token } : null);
    },
    async deleteSession(sessionId) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    },
    async tokensForUser(userId) {
      const row = await db.prepare("SELECT refresh_token, access_token, access_expires_at FROM youtube_tokens WHERE user_id = ?").bind(userId).first();
      if (!row) return null;
      return {
        refreshToken: row.refresh_token || "",
        accessToken: row.access_token || "",
        accessExpiresAt: row.access_expires_at || "",
      };
    },
    async saveTokens(userId, tokenSet) {
      const current = await this.tokensForUser(userId);
      await db.prepare(`INSERT INTO youtube_tokens (user_id, refresh_token, access_token, access_expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          refresh_token = excluded.refresh_token,
          access_token = excluded.access_token,
          access_expires_at = excluded.access_expires_at`)
        .bind(
          userId,
          tokenSet.refreshToken || current?.refreshToken || "",
          tokenSet.accessToken || "",
          tokenSet.accessExpiresAt || "",
        )
        .run();
    },
    async saveSubscriptions(userId, subscriptions) {
      await db.prepare("UPDATE youtube_tokens SET subscriptions_json = ? WHERE user_id = ?")
        .bind(JSON.stringify(subscriptions), userId)
        .run();
    },
    async subscriptionsForUser(userId) {
      const row = await db.prepare("SELECT subscriptions_json FROM youtube_tokens WHERE user_id = ?").bind(userId).first();
      if (!row?.subscriptions_json) return null;
      try {
        return JSON.parse(row.subscriptions_json);
      } catch {
        return null;
      }
    },
  };
}

export async function handleAuthRequest(request, options) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth") && !url.pathname.startsWith("/api/youtube/")) return null;
  const store = options.store;
  if (!store) {
    return json(503, {
      configured: false,
      user: null,
      error: "Account storage is not connected yet. Apply the D1 migration on the hosted app.",
    });
  }
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json(200, await mePayload(request, store, options));
  }
  if (request.method === "POST" && (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/login")) {
    return handlePasswordAuth(request, url, store, url.pathname.endsWith("/register"));
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const sessionId = readCookie(request, SESSION_COOKIE);
    if (sessionId) await store.deleteSession(sessionId);
    return json(200, { ok: true }, [clearCookie(SESSION_COOKIE, url)]);
  }
  if (request.method === "GET" && url.pathname === "/api/auth/google/start") {
    if (!options.clientId || !options.clientSecret) {
      return json(503, { error: "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    }
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + STATE_MS).toISOString();
    await store.putState(state, expiresAt);
    const redirectUri = callbackUrl(url);
    return redirect(googleAuthUrl({ clientId: options.clientId, redirectUri, state }), [
      cookie(STATE_COOKIE, state, url, STATE_MS),
    ]);
  }
  if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
    return handleGoogleCallback(request, url, store, options);
  }
  if (request.method === "GET" && url.pathname === "/api/youtube/subscriptions") {
    try {
      return await handleSubscriptions(request, store, options);
    } catch (error) {
      return json(error.status || 502, { error: error.message || "Subscriptions could not be loaded." });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/youtube/home") {
    try {
      return await handleYouTubeHome(request, store, options);
    } catch (error) {
      return json(error.status || 502, { error: error.message || "YouTube could not be loaded." });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/youtube/playlist") {
    try {
      return await handleYouTubePlaylist(request, url, store, options);
    } catch (error) {
      return json(error.status || 502, { error: error.message || "That playlist could not be loaded." });
    }
  }
  return json(404, { error: "Unknown account route." });
}

async function handlePasswordAuth(request, url, store, creating) {
  try {
    const body = await request.json().catch(() => ({}));
    const account = normalizeAccount(body);
    if (creating) {
      const passwordHash = await hashPassword(account.password);
      const user = await store.createPasswordUser({ email: account.email, name: account.name, passwordHash });
      return sessionResponse(url, store, user);
    }
    const record = await store.passwordUserByEmail(account.email);
    if (!record || !(await verifyPassword(account.password, record.passwordHash))) {
      return json(401, { error: "That email and password do not match." });
    }
    const { passwordHash, ...user } = record;
    return sessionResponse(url, store, user);
  } catch (error) {
    return json(error.status || 400, { error: error.message || "The account could not be saved." });
  }
}

async function sessionResponse(url, store, user) {
  const sessionId = await store.createSession(user.id);
  return json(200, { user }, [cookie(SESSION_COOKIE, sessionId, url, SESSION_MS)]);
}

async function mePayload(request, store, options) {
  const user = await currentUser(request, store);
  return {
    configured: Boolean(options.clientId && options.clientSecret),
    user,
  };
}

async function handleGoogleCallback(request, url, store, options) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const cookieState = readCookie(request, STATE_COOKIE);
  const stateOk = state && state === cookieState && await store.takeState(state);
  if (!stateOk || !code) return redirect("/?auth=failed", [clearCookie(STATE_COOKIE, url)]);
  const redirectUri = callbackUrl(url);
  const fetchImpl = options.fetchImpl || fetch;
  const tokens = await exchangeCode({ code, redirectUri, clientId: options.clientId, clientSecret: options.clientSecret, fetchImpl });
  const profile = await fetchGoogleProfile(tokens.accessToken, fetchImpl);
  const user = await store.upsertGoogleUser(profile, tokens);
  try {
    const synced = await fetchYouTubeHome(tokens.accessToken, fetchImpl);
    await store.saveSubscriptions(user.id, { ...synced, syncedAt: new Date().toISOString() });
  } catch {
    // Sign-in still completes. The Subscriptions feed can retry with the saved token.
  }
  const sessionId = await store.createSession(user.id);
  return redirect("/?desk=youtube", [cookie(SESSION_COOKIE, sessionId, url, SESSION_MS), clearCookie(STATE_COOKIE, url)]);
}

async function handleSubscriptions(request, store, options) {
  const user = await currentUser(request, store);
  if (!user) return json(401, { error: "Sign in with Google to load YouTube subscriptions." });
  const fetchImpl = options.fetchImpl || fetch;
  let cached = await store.subscriptionsForUser(user.id);
  const fresh = cached?.syncedAt && Date.now() - Date.parse(cached.syncedAt) < 15 * 60 * 1000;
  if (!fresh) {
    const accessToken = await freshAccessToken(user.id, store, options, fetchImpl);
    const synced = await fetchSubscriptionFeed(accessToken, fetchImpl);
    cached = { ...synced, syncedAt: new Date().toISOString() };
    await store.saveSubscriptions(user.id, cached);
  }
  const videos = Array.isArray(cached?.videos) ? cached.videos : [];
  return json(200, { channels: cached?.channels || [], videos, results: videos });
}

async function cachedYouTubeHome(userId, store, options, fetchImpl) {
  let cached = await store.subscriptionsForUser(userId);
  const fresh = cached?.syncedAt && Array.isArray(cached.playlists) && Date.now() - Date.parse(cached.syncedAt) < 15 * 60 * 1000;
  if (fresh) return cached;
  const accessToken = await freshAccessToken(userId, store, options, fetchImpl);
  cached = { ...await fetchYouTubeHome(accessToken, fetchImpl), syncedAt: new Date().toISOString() };
  await store.saveSubscriptions(userId, cached);
  return cached;
}

async function handleYouTubeHome(request, store, options) {
  const user = await currentUser(request, store);
  if (!user) return json(401, { error: "Sign in with Google to open My YouTube." });
  const fetchImpl = options.fetchImpl || fetch;
  const cached = await cachedYouTubeHome(user.id, store, options, fetchImpl);
  return json(200, {
    channels: cached.channels || [],
    subscriptions: cached.videos || [],
    playlists: cached.playlists || [],
    liked: cached.liked || [],
    activity: cached.activity || [],
  });
}

async function handleYouTubePlaylist(request, url, store, options) {
  const user = await currentUser(request, store);
  if (!user) return json(401, { error: "Sign in with Google to open this playlist." });
  const playlistId = url.searchParams.get("id") || "";
  if (!/^[\w-]{2,80}$/.test(playlistId)) return json(400, { error: "That playlist is not available." });
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = await freshAccessToken(user.id, store, options, fetchImpl);
  const videos = await fetchPlaylistVideos(accessToken, playlistId, fetchImpl);
  return json(200, { videos, results: videos });
}

async function freshAccessToken(userId, store, options, fetchImpl) {
  const tokens = await store.tokensForUser(userId);
  if (!tokens?.refreshToken && !tokens?.accessToken) {
    throw Object.assign(new Error("YouTube is not connected for this account."), { status: 401 });
  }
  if (tokens.accessToken && Date.parse(tokens.accessExpiresAt || 0) > Date.now() + 30_000) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken;
  const refreshed = await refreshAccessToken({
    refreshToken: tokens.refreshToken,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetchImpl,
  });
  await store.saveTokens(userId, refreshed);
  return refreshed.accessToken;
}

async function exchangeCode({ code, redirectUri, clientId, clientSecret, fetchImpl }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return readTokenResponse(await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }));
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl }) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const tokens = await readTokenResponse(await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }));
  return { ...tokens, refreshToken };
}

async function readTokenResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "Google did not return an access token.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    accessExpiresAt: new Date(Date.now() + (Number(payload.expires_in) || 3600) * 1000).toISOString(),
  };
}

async function fetchGoogleProfile(accessToken, fetchImpl) {
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok || !profile.sub) throw new Error("Google did not return a profile.");
  return profile;
}

async function currentUser(request, store) {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  return store.userForSession(sessionId);
}

function publicUser(user, tokens) {
  return {
    id: user.id,
    email: user.email || "",
    name: user.name || "",
    picture: user.picture || "",
    youtubeConnected: Boolean(tokens?.refreshToken),
  };
}

function rowToUser(row) {
  return { id: row.id, email: row.email || "", name: row.name || "", picture: row.picture || "" };
}

function callbackUrl(url) {
  return `${url.origin}/api/auth/google/callback`;
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function cookie(name, value, url, maxAgeMs) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

function clearCookie(name, url) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function json(status, data, cookies = []) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  cookies.forEach((item) => headers.append("set-cookie", item));
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  cookies.forEach((item) => headers.append("set-cookie", item));
  return new Response(null, { status: 302, headers });
}
