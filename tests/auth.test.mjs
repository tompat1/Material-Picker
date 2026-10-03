import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMemoryAccountStore, fetchChannelUploads, fetchSubscriptionFeed, fetchYouTubeHome, formatYouTubeDuration, googleAuthUrl, handleAuthRequest, parseYouTubeSubscriptions } from "../auth.mjs";
import { createFileAccountStore } from "../account-file.mjs";

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

test("subscription feed paginates to fetch all subscribed channels", async () => {
  const feed = await fetchSubscriptionFeed("token", async (url) => {
    const href = String(url);
    if (href.includes("/subscriptions") && !href.includes("pageToken=page2")) {
      return new Response(JSON.stringify({
        nextPageToken: "page2",
        items: [{ snippet: { title: "Channel 1", resourceId: { channelId: "UCchan1" } } }],
      }));
    }
    if (href.includes("/subscriptions") && href.includes("pageToken=page2")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "Channel 2", resourceId: { channelId: "UCchan2" } } }],
      }));
    }
    if (href.includes("playlistId=UUchan")) {
      return new Response(JSON.stringify({ items: [] }));
    }
    throw new Error(`Unexpected fetch ${href}`);
  });
  assert.equal(feed.channels.length, 2);
  assert.equal(feed.channels[0].title, "Channel 1");
  assert.equal(feed.channels[1].title, "Channel 2");
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
  assert.equal(home.videos[0].short, false);
});

test("youtube home marks videos that are on the channel Shorts list", async () => {
  const home = await fetchYouTubeHome("token", async (url) => {
    const href = String(url);
    if (href.includes("/subscriptions")) {
      return new Response(JSON.stringify({
        items: [{ snippet: { title: "Studio North", resourceId: { channelId: "UCstudio1234" } } }],
      }));
    }
    if (href.includes("playlistId=UUstudio1234")) {
      return new Response(JSON.stringify({
        items: [
          { snippet: { title: "Portrait clip", publishedAt: "2026-09-02T00:00:00Z", resourceId: { videoId: "shortvideo01" }, channelTitle: "Studio North" } },
          { snippet: { title: "Kiln tour", publishedAt: "2026-09-01T00:00:00Z", resourceId: { videoId: "longvideo001" }, channelTitle: "Studio North" } },
        ],
      }));
    }
    if (href.includes("playlistId=UUSHstudio1234")) {
      return new Response(JSON.stringify({
        items: [{ contentDetails: { videoId: "shortvideo01" } }],
      }));
    }
    if (href.includes("/playlists") || href.includes("playlistId=LL") || href.includes("/activities") || href.includes("/videos?part=contentDetails")) {
      return new Response(JSON.stringify({ items: [] }));
    }
    throw new Error(`Unexpected fetch ${href}`);
  });
  const portrait = home.videos.find((video) => video.title === "Portrait clip");
  const tour = home.videos.find((video) => video.title === "Kiln tour");
  assert.equal(portrait.short, true);
  assert.equal(tour.short, false);
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

test("logout clears the session cookie when storage cannot delete the session", async () => {
  const store = createMemoryAccountStore();
  const register = await handleAuthRequest(new Request("http://localhost:4173/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "long-enough" }),
  }), { store });
  const session = register.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  store.deleteSession = async () => {
    throw new Error("storage write failed");
  };
  const logout = await handleAuthRequest(new Request("http://localhost:4173/api/auth/logout", {
    method: "POST",
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  assert.match(cleared, /Max-Age=0/);
});

test("login, logout, and RSS add/remove persist through the feed library API", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "picker-auth-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stores = [
    ["memory", createMemoryAccountStore()],
    ["file", createFileAccountStore(path.join(directory, "accounts.json"))],
  ];
  const base = "http://localhost:4173";
  for (const [kind, store] of stores) {
    const call = (route, options = {}) => handleAuthRequest(new Request(`${base}${route}`, options), { store });
    const credentials = { email: `${kind}@example.com`, password: "long-enough" };
    const register = await call("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...credentials, name: "Feed tester" }),
    });
    assert.equal(register.status, 200, kind);
    const registeredCookie = register.headers.getSetCookie().find((item) => item.startsWith("picker_session="))?.split(";")[0];
    assert.ok(registeredCookie, kind);

    const logout = await call("/api/auth/logout", { method: "POST", headers: { cookie: registeredCookie } });
    assert.equal(logout.status, 200, kind);
    assert.match(logout.headers.getSetCookie().join(" "), /picker_session=;.*Max-Age=0/, kind);
    assert.equal((await (await call("/api/auth/me", { headers: { cookie: registeredCookie } })).json()).user, null, kind);
    assert.equal((await call("/api/feeds/library", { headers: { cookie: registeredCookie } })).status, 401, kind);

    const login = await call("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200, kind);
    const cookie = login.headers.getSetCookie().find((item) => item.startsWith("picker_session="))?.split(";")[0];
    assert.ok(cookie, kind);
    assert.equal((await (await call("/api/auth/me", { headers: { cookie } })).json()).user.email, credentials.email, kind);

    const feed = { id: "notes", url: "https://notes.example/feed.xml", title: "Desk notes", folderIds: [] };
    const put = (body) => call("/api/feeds/library", {
      method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await put({ feeds: [feed], folders: [] })).status, 200, kind);
    assert.deepEqual((await (await call("/api/feeds/library", { headers: { cookie } })).json()).feeds.map((item) => item.url), [feed.url], kind);
    const removed = await put({ feeds: [], folders: [], removedUrls: [feed.url] });
    assert.equal(removed.status, 200, kind);
    const saved = await (await call("/api/feeds/library", { headers: { cookie } })).json();
    assert.deepEqual(saved.feeds, [], kind);
    assert.deepEqual(saved.removedUrls, [feed.url], kind);
  }
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
