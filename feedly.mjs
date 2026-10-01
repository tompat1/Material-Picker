import { sessionUser } from "./auth.mjs";

const FEEDLY_STATE_COOKIE = "picker_feedly_state";
const STATE_MS = 10 * 60 * 1000;
const FEEDLY_CLIENT_ID = "feedly";
const FEEDLY_CLIENT_SECRET = "0XP4XQ07VVMDWBKUHTJM4WUQ";

export function feedlyAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://cloud.feedly.com/v3/auth/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://cloud.feedly.com/subscriptions");
  url.searchParams.set("provider", "google");
  url.searchParams.set("migrate", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseFeedlySubscriptions(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((item) => ({
      id: String(item?.id || ""),
      title: String(item?.title || "Untitled feed"),
      website: String(item?.website || ""),
      category: String(item?.categories?.[0]?.label || ""),
    }))
    .filter((item) => item.id.startsWith("feed/"))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function parseFeedlyItems(payload) {
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows.slice(0, 40).map((item) => ({
    id: String(item?.id || ""),
    title: plainText(item?.title) || "Untitled",
    url: String(item?.alternate?.[0]?.href || item?.canonical?.[0]?.href || item?.originId || ""),
    feedTitle: String(item?.origin?.title || ""),
    published: Number(item?.published) || 0,
    excerpt: plainText(item?.summary?.content || item?.content?.content).slice(0, 280),
  })).filter((item) => item.url.startsWith("http"));
}

export async function handleFeedlyRequest(request, options = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/feedly")) return null;
  const store = options.store;
  if (!store) return json(503, { error: "Account storage is not connected yet." });
  const fetchImpl = options.fetchImpl || fetch;
  const credentials = {
    clientId: options.clientId || FEEDLY_CLIENT_ID,
    clientSecret: options.clientSecret || FEEDLY_CLIENT_SECRET,
  };
  if (request.method === "GET" && url.pathname === "/api/feedly/start") {
    const user = await sessionUser(request, store);
    if (!user) return redirect("/?feedly=signin");
    const state = crypto.randomUUID();
    await store.putState(state, new Date(Date.now() + STATE_MS).toISOString());
    return redirect(feedlyAuthUrl({ ...credentials, redirectUri: callbackUrl(url), state }), [
      cookie(FEEDLY_STATE_COOKIE, state, url, STATE_MS),
    ]);
  }
  if (request.method === "GET" && url.pathname === "/api/feedly/callback") {
    return handleCallback(request, url, store, fetchImpl, credentials);
  }
  if (request.method === "GET" && url.pathname === "/api/feedly/home") {
    try {
      return await handleHome(request, url, store, fetchImpl, credentials);
    } catch (error) {
      return json(error.status || 502, { error: error.message || "Feedly could not be loaded." });
    }
  }
  return json(404, { error: "Unknown Feedly route." });
}

async function handleCallback(request, url, store, fetchImpl, credentials) {
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = readCookie(request, FEEDLY_STATE_COOKIE);
  const user = await sessionUser(request, store);
  if (!user || !code || !state || state !== cookieState || !(await store.takeState(state))) {
    return redirect("/?desk=feeds&feedly=error", [clearCookie(FEEDLY_STATE_COOKIE, url)]);
  }
  try {
    const tokens = await exchangeCode(code, callbackUrl(url), credentials, fetchImpl);
    await store.saveFeedlyTokens(user.id, tokens);
  } catch {
    return redirect("/?desk=feeds&feedly=error", [clearCookie(FEEDLY_STATE_COOKIE, url)]);
  }
  return redirect("/?desk=feeds", [clearCookie(FEEDLY_STATE_COOKIE, url)]);
}

async function handleHome(request, url, store, fetchImpl, credentials) {
  const user = await sessionUser(request, store);
  if (!user) return json(401, { error: "Sign in to Picker first." });
  const accessToken = await accessTokenFor(store, user.id, credentials, fetchImpl);
  const subscriptions = await feedlyJson("https://cloud.feedly.com/v3/subscriptions", accessToken, fetchImpl);
  const feeds = parseFeedlySubscriptions(subscriptions);
  const requested = url.searchParams.get("feed") || "all";
  let streamId = requested;
  if (requested === "all") {
    const profile = await feedlyJson("https://cloud.feedly.com/v3/profile", accessToken, fetchImpl);
    if (!profile?.id) throw Object.assign(new Error("Feedly did not return your account."), { status: 502 });
    streamId = `user/${profile.id}/category/global.all`;
  } else if (!requested.startsWith("feed/") && !requested.startsWith("user/")) {
    return json(400, { error: "That feed is not available." });
  }
  const contents = await feedlyJson(
    `https://cloud.feedly.com/v3/streams/contents?count=40&ranked=newest&streamId=${encodeURIComponent(streamId)}`,
    accessToken,
    fetchImpl,
  );
  return json(200, { feeds, items: parseFeedlyItems(contents), streamId });
}

async function accessTokenFor(store, userId, credentials, fetchImpl) {
  const saved = await store.feedlyTokensForUser(userId);
  if (!saved?.refreshToken && !saved?.accessToken) {
    const error = new Error("Connect Feedly to load your feeds.");
    error.status = 401;
    throw error;
  }
  if (saved.accessToken && Date.parse(saved.accessExpiresAt) > Date.now() + 60_000) return saved.accessToken;
  const refreshed = await refreshToken(saved.refreshToken, credentials, fetchImpl);
  await store.saveFeedlyTokens(userId, {
    feedlyId: refreshed.feedlyId || saved.feedlyId || "",
    refreshToken: refreshed.refreshToken || saved.refreshToken,
    accessToken: refreshed.accessToken,
    accessExpiresAt: refreshed.accessExpiresAt,
  });
  return refreshed.accessToken;
}

async function exchangeCode(code, redirectUri, credentials, fetchImpl) {
  const payload = await tokenRequest({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  }, fetchImpl);
  return tokenSet(payload);
}

async function refreshToken(refreshTokenValue, credentials, fetchImpl) {
  const payload = await tokenRequest({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
  }, fetchImpl);
  return tokenSet(payload);
}

async function tokenRequest(fields, fetchImpl) {
  const response = await fetchImpl("https://cloud.feedly.com/v3/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.errorMessage || "Feedly did not finish signing in.");
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }
  return payload;
}

async function feedlyJson(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, { headers: { authorization: `OAuth ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.errorMessage || "Feedly could not load that feed.");
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }
  return payload;
}

function tokenSet(payload) {
  return {
    feedlyId: String(payload.id || ""),
    refreshToken: payload.refresh_token || "",
    accessToken: payload.access_token,
    accessExpiresAt: new Date(Date.now() + (Number(payload.expires_in) || 3600) * 1000).toISOString(),
  };
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function callbackUrl(url) {
  return `${url.origin}/api/feedly/callback`;
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

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  cookies.forEach((item) => headers.append("set-cookie", item));
  return new Response(null, { status: 302, headers });
}
