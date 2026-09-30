import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAccountStore, fetchChannelUploads, fetchSubscriptionFeed, fetchYouTubeHome, formatYouTubeDuration, googleAuthUrl, handleAuthRequest, parseYouTubeSubscriptions } from "../auth.mjs";

test("google sign-in asks for offline YouTube read access", () => {
  const url = new URL(googleAuthUrl({
    clientId: "client",
    redirectUri: "http://localhost:4173/api/auth/google/callback",
    state: "state-1",
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.match(url.searchParams.get("scope"), /youtube\.readonly/);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("subscription payloads keep channel id and title", () => {
  const channels = parseYouTubeSubscriptions({
    items: [
      { snippet: { title: "Studio North", resourceId: { channelId: "UC123" }, thumbnails: { default: { url: "https://img.example/a.jpg" } } } },
      { snippet: { title: "", resourceId: { channelId: "UC000" } } },
    ],
  });
  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, "UC123");
  assert.equal(channels[0].title, "Studio North");
});

test("youtube durations use the watch-page clock", () => {
  assert.equal(formatYouTubeDuration("PT18M44S"), "18:44");
  assert.equal(formatYouTubeDuration("PT1H7M3S"), "1:07:03");
});

test("subscription feed keeps the latest upload from each channel", async () => {
  const feed = await fetchSubscriptionFeed("token", async (url) => {
    const href = String(url);
    if (href.includes("/subscriptions")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "Studio North", resourceId: { channelId: "UCstudio1234" } } }],
      }));
    }
    if (href.includes("playlistId=UUstudio1234")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "New glaze", publishedAt: "2026-09-01T00:00:00Z", resourceId: { videoId: "abcdefghijk" }, thumbnails: { medium: { url: "https://img.example/glaze.jpg" } } } }],
      }));
    }
    throw new Error(`Unexpected fetch ${href}`);
  });
  assert.equal(feed.channels[0].title, "Studio North");
  assert.equal(feed.videos[0].url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(feed.videos[0].speaker, "Studio North");
});

test("channel uploads return a longer slider of recent videos", async () => {
  const videos = await fetchChannelUploads("token", "UCstudio1234", async (url) => {
    const href = String(url);
    if (href.includes("playlistId=UUstudio1234") && href.includes("maxResults=30")) {
      return new Response(JSON.stringify({
        items: [
          { snippet: { title: "Latest firing", publishedAt: "2026-09-02T00:00:00Z", resourceId: { videoId: "latestvideo1" }, channelTitle: "Studio North" } },
          { snippet: { title: "Older bowl", publishedAt: "2026-08-02T00:00:00Z", resourceId: { videoId: "oldervideo01" }, channelTitle: "Studio North" } },
        ],
      }));
    }
    if (href.includes("/videos?part=contentDetails")) {
      return new Response(JSON.stringify({
        items: [{ id: "latestvideo1", contentDetails: { duration: "PT12M28S" } }],
      }));
    }
    throw new Error(`Unexpected fetch ${href}`);
  });
  assert.equal(videos.length, 2);
  assert.equal(videos[0].url, "https://www.youtube.com/watch?v=latestvideo1");
  assert.equal(videos[0].duration, "12:28");
  assert.equal(videos[1].duration, "");
});

test("youtube home keeps subscriptions, playlists, likes, and activity", async () => {
  const home = await fetchYouTubeHome("token", async (url) => {
    const href = String(url);
    if (href.includes("/subscriptions")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "Studio North", resourceId: { channelId: "UCstudio1234" } } }],
      }));
    }
    if (href.includes("playlistId=UUstudio1234")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "New glaze", publishedAt: "2026-09-01T00:00:00Z", resourceId: { videoId: "abcdefghijk" } } }],
      }));
    }
    if (href.includes("/playlists")) {
      return new Response(JSON.stringify({
        items: [{ id: "PLstudio", snippet: { title: "Kiln notes" }, contentDetails: { itemCount: 3 } }],
      }));
    }
    if (href.includes("playlistId=LL")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "Liked bowl", resourceId: { videoId: "likedvideoid" }, channelTitle: "Clay" } }],
      }));
    }
    if (href.includes("/activities")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { type: "like", title: "Liked bowl", publishedAt: "2026-09-02T00:00:00Z", channelTitle: "Clay" }, contentDetails: { like: { resourceId: { videoId: "likedvideoid" } } } }],
      }));
    }
    throw new Error(`Unexpected fetch ${href}`);
  });
  assert.equal(home.videos[0].title, "New glaze");
  assert.equal(home.playlists[0].title, "Kiln notes");
  assert.equal(home.liked[0].url, "https://www.youtube.com/watch?v=likedvideoid");
  assert.equal(home.activity[0].source, "Liked");
});

test("email accounts can be created and signed in without Google", async () => {
  const store = createMemoryAccountStore();
  const register = await handleAuthRequest(new Request("http://localhost:4173/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "long-enough" }),
  }), { store });
  assert.equal(register.status, 200);
  const session = register.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  const me = await handleAuthRequest(new Request("http://localhost:4173/api/auth/me", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store });
  assert.equal((await me.json()).user.email, "ada@example.com");
  const again = await handleAuthRequest(new Request("http://localhost:4173/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "wrong-password" }),
  }), { store });
  assert.equal(again.status, 401);
});

test("linking Google keeps the password email lowercase", async () => {
  const store = createMemoryAccountStore();
  const register = await handleAuthRequest(new Request("http://localhost:4173/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "long-enough" }),
  }), { store });
  assert.equal(register.status, 200);
  const start = await handleAuthRequest(new Request("http://localhost:4173/api/auth/google/start"), {
    store,
    clientId: "client",
    clientSecret: "secret",
  });
  const stateCookie = start.headers.getSetCookie().find((item) => item.startsWith("picker_oauth_state="));
  const state = decodeURIComponent(stateCookie.split(";")[0].slice("picker_oauth_state=".length));
  const callback = await handleAuthRequest(
    new Request(`http://localhost:4173/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `picker_oauth_state=${state}` },
    }),
    {
      store,
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
        }
        if (String(url).includes("userinfo")) {
          return new Response(JSON.stringify({ sub: "google-ada", email: "Ada@Example.com", name: "Ada Lovelace" }));
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    },
  );
  assert.equal(callback.status, 302);
  const login = await handleAuthRequest(new Request("http://localhost:4173/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "long-enough" }),
  }), { store });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.email, "ada@example.com");
});

test("google callback creates a session and marks YouTube connected", async () => {
  const store = createMemoryAccountStore();
  const start = await handleAuthRequest(new Request("http://localhost:4173/api/auth/google/start"), {
    store,
    clientId: "client",
    clientSecret: "secret",
    fetchImpl: async () => {
      throw new Error("start should not fetch");
    },
  });
  assert.equal(start.status, 302);
  const stateCookie = start.headers.getSetCookie().find((item) => item.startsWith("picker_oauth_state="));
  const state = decodeURIComponent(stateCookie.split(";")[0].slice("picker_oauth_state=".length));
  const callback = await handleAuthRequest(
    new Request(`http://localhost:4173/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `picker_oauth_state=${state}` },
    }),
    {
      store,
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
        }
        if (String(url).includes("userinfo")) {
          return new Response(JSON.stringify({ sub: "google-1", email: "ada@example.com", name: "Ada" }));
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    },
  );
  assert.equal(callback.status, 302);
  const session = callback.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  const me = await handleAuthRequest(new Request("http://localhost:4173/api/auth/me", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store, clientId: "client", clientSecret: "secret" });
  const body = await me.json();
  assert.equal(body.user.email, "ada@example.com");
  assert.equal(body.user.youtubeConnected, true);
});
