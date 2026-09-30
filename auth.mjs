const SESSION_COOKIE = "picker_session";
const STATE_COOKIE = "picker_oauth_state";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

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
      let user = [...users.values()].find((item) => item.googleSub === googleSub);
      if (!user) {
        user = {
          id: crypto.randomUUID(),
          googleSub,
          email: profile.email || "",
          name: profile.name || "",
          picture: profile.picture || "",
          createdAt: new Date().toISOString(),
        };
        users.set(user.id, user);
      } else {
        user.email = profile.email || user.email;
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
      });
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
      const existing = await db.prepare("SELECT id, email, name, picture, created_at FROM users WHERE google_sub = ?").bind(googleSub).first();
      const id = existing?.id || crypto.randomUUID();
      if (!existing) {
        await db.prepare("INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, googleSub, profile.email || "", profile.name || "", profile.picture || "", new Date().toISOString())
          .run();
      } else {
        await db.prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?")
          .bind(profile.email || existing.email || "", profile.name || existing.name || "", profile.picture || existing.picture || "", id)
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
  };
}

export async function handleAuthRequest(request, options) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth") && url.pathname !== "/api/youtube/subscriptions") return null;
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
  return json(404, { error: "Unknown account route." });
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
  const sessionId = await store.createSession(user.id);
  return redirect("/", [cookie(SESSION_COOKIE, sessionId, url, SESSION_MS), clearCookie(STATE_COOKIE, url)]);
}

async function handleSubscriptions(request, store, options) {
  const user = await currentUser(request, store);
  if (!user) return json(401, { error: "Sign in with Google to load YouTube subscriptions." });
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = await freshAccessToken(user.id, store, options, fetchImpl);
  const response = await fetchImpl("https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return json(502, { error: "YouTube could not load subscriptions. Reconnect Google if this keeps happening." });
  }
  const payload = await response.json();
  return json(200, { channels: parseYouTubeSubscriptions(payload) });
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
