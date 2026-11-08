import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createD1AccountStore, createMemoryAccountStore, fetchChannelUploads, fetchSubscriptionFeed, fetchYouTubeHome, formatYouTubeDuration, googleAuthUrl, handleAuthRequest, parseYouTubeSubscriptions } from "../auth.mjs";
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
    const folders = Array.from({ length: 6 }, (_, index) => ({ id: `folder-${index + 1}`, name: `Folder ${index + 1}` }));
    const put = (body) => call("/api/feeds/library", {
      method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await put({ feeds: [feed], folders, favoriteFolderIds: folders.map((folder) => folder.id) })).status, 200, kind);
    const library = await (await call("/api/feeds/library", { headers: { cookie } })).json();
    assert.deepEqual(library.feeds.map((item) => item.url), [feed.url], kind);
    assert.deepEqual(library.favoriteFolderIds, folders.slice(0, 5).map((folder) => folder.id), kind);
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

function createFakeD1() {
  const users = new Map();
  const sessions = new Map();
  const userFeeds = new Map();
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM users WHERE id = ?")) return users.get(args[0]) || null;
              if (sql.includes("FROM users WHERE email = ?")) {
                for (const u of users.values()) if (u.email === args[0]) return u;
                return null;
              }
              if (sql.includes("FROM sessions WHERE id = ?")) return sessions.get(args[0]) || null;
              if (sql.includes("FROM user_feeds WHERE user_id = ?")) return userFeeds.get(args[0]) || null;
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO users")) {
                users.set(args[0], {
                  id: args[0], email: args[1], name: args[2], picture: "",
                  password_hash: args[3], google_sub: null, created_at: args[4],
                });
              } else if (sql.includes("INSERT INTO sessions")) {
                sessions.set(args[0], { id: args[0], user_id: args[1], expires_at: args[2] });
              } else if (sql.includes("DELETE FROM sessions WHERE id = ?")) {
                sessions.delete(args[0]);
              } else if (sql.includes("INSERT INTO user_feeds")) {
                userFeeds.set(args[0], { user_id: args[0], library_json: args[1], updated_at: args[2] });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("per-user changes across app state and feeds persist across logout and login in memory, file, and D1 stores", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "picker-user-state-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stores = [
    ["memory", createMemoryAccountStore()],
    ["file", createFileAccountStore(path.join(directory, "accounts.json"))],
    ["d1", createD1AccountStore(createFakeD1())],
  ];
  const base = "http://localhost:4173";

  for (const [kind, store] of stores) {
    const call = (route, options = {}) => handleAuthRequest(new Request(`${base}${route}`, options), { store });
    const credentials = { email: `user-${kind}@example.com`, password: "long-enough-password" };
    const register = await call("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...credentials, name: "Persistent User" }),
    });
    assert.equal(register.status, 200, kind);
    const cookie1 = register.headers.getSetCookie().find((item) => item.startsWith("picker_session="))?.split(";")[0];

    const statePayload = {
      selectedId: "vid-1",
      videos: [{ id: "vid-1", title: "Saved Talk", url: "https://www.youtube.com/watch?v=abcdefghijk", notes: "My note" }],
      collections: [{ id: "col-1", name: "Watch Later" }],
      playlists: [{ id: "pl-1", name: "Favourites Mix", videoIds: ["vid-1"] }],
      favourites: ["vid-1"],
      youtubeFavoriteChannels: ["UCfav1"],
      youtubeRemovedChannels: ["UCrem1"],
      youtubeSubFilter: "favourites",
      thumbnailStyle: "new-age",
      merchCart: [{ id: "hoodie-black:L", productId: "hoodie-black", option: "L", qty: 2 }],
      recentSearches: ["quantum computing", "oled monitor"],
    };
    const putState = await call("/api/auth/state", {
      method: "PUT",
      headers: { cookie: cookie1, "content-type": "application/json" },
      body: JSON.stringify(statePayload),
    });
    assert.equal(putState.status, 200, kind);

    const feedPayload = {
      feeds: [{ id: "f-1", url: "https://example.com/rss.xml", title: "Example RSS", folderIds: ["fol-1"] }],
      folders: [{ id: "fol-1", name: "Tech" }],
      favoriteFolderIds: ["fol-1"],
      customTopics: ["Rust", "WebGPU"],
      read: { "item-1": "2026-11-02T10:00:00.000Z" },
      starred: { "item-1": true },
      archived: { "item-2": "2026-11-02T10:05:00.000Z" },
      savedItems: [{ id: "item-1", feedId: "f-1", title: "Saved Article", link: "https://example.com/post-1" }],
      feedSort: "active",
      dismissedDiscoverInvite: true,
    };
    const putFeeds = await call("/api/feeds/library", {
      method: "PUT",
      headers: { cookie: cookie1, "content-type": "application/json" },
      body: JSON.stringify(feedPayload),
    });
    assert.equal(putFeeds.status, 200, kind);

    // Log out completely
    const logout = await call("/api/auth/logout", { method: "POST", headers: { cookie: cookie1 } });
    assert.equal(logout.status, 200, kind);

    // Log back in on a clean session
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200, kind);
    const cookie2 = login.headers.getSetCookie().find((item) => item.startsWith("picker_session="))?.split(";")[0];

    const me = await (await call("/api/auth/me", { headers: { cookie: cookie2 } })).json();
    assert.equal(me.user.email, credentials.email, kind);
    assert.equal(me.state.selectedId, "vid-1", kind);
    assert.equal(me.state.videos.length, 1, kind);
    assert.equal(me.state.videos[0].notes, "My note", kind);
    assert.deepEqual(me.state.collections, [{ id: "col-1", name: "Watch Later" }], kind);
    assert.deepEqual(me.state.playlists, [{ id: "pl-1", name: "Favourites Mix", videoIds: ["vid-1"] }], kind);
    assert.deepEqual(me.state.favourites, ["vid-1"], kind);
    assert.deepEqual(me.state.youtubeFavoriteChannels, ["UCfav1"], kind);
    assert.deepEqual(me.state.youtubeRemovedChannels, ["UCrem1"], kind);
    assert.equal(me.state.youtubeSubFilter, "favourites", kind);
    assert.equal(me.state.thumbnailStyle, "new-age", kind);

    // Verify widget latest endpoint works with session cookie
    const widgetRes = await call("/api/widget/latest", { headers: { cookie: cookie2 } });
    assert.equal(widgetRes.status, 200, kind);
    const widgetJson = await widgetRes.json();
    assert.equal(widgetJson.ok, true, kind);
    assert.ok(Array.isArray(widgetJson.items), kind);
    assert.equal(widgetJson.items[0]?.title, "Saved Article", kind);
    assert.deepEqual(me.state.merchCart, [{ id: "hoodie-black:L", productId: "hoodie-black", option: "L", qty: 2 }], kind);
    assert.deepEqual(me.state.recentSearches, ["quantum computing", "oled monitor"], kind);

    const restoredFeeds = await (await call("/api/feeds/library", { headers: { cookie: cookie2 } })).json();
    assert.equal(restoredFeeds.feeds.length, 1, kind);
    assert.deepEqual(restoredFeeds.customTopics, ["Rust", "WebGPU"], kind);
    assert.deepEqual(restoredFeeds.read, { "item-1": "2026-11-02T10:00:00.000Z" }, kind);
    assert.deepEqual(restoredFeeds.starred, { "item-1": true }, kind);
    assert.deepEqual(restoredFeeds.archived, { "item-2": "2026-11-02T10:05:00.000Z" }, kind);
    assert.equal(restoredFeeds.savedItems.length, 1, kind);
    assert.equal(restoredFeeds.savedItems[0].title, "Saved Article", kind);
    assert.equal(restoredFeeds.feedSort, "active", kind);
    assert.equal(restoredFeeds.dismissedDiscoverInvite, true, kind);
  }
});

test("widget latest endpoint authenticates with widget token, loads configured feeds, resolves feed titles, and handles nonnumeric limits", async () => {
  const store = createMemoryAccountStore();
  const base = "http://localhost:4173";
  let fetchCallCount = 0;
  const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tech News</title>
    <link>https://technews.example</link>
    <item>
      <title>Latest Tech Breakthrough</title>
      <link>https://technews.example/breakthrough</link>
      <pubDate>Sun, 08 Nov 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

  const customFetch = async (url) => {
    fetchCallCount++;
    if (url === "https://technews.example/feed.xml") {
      return new Response(mockRssXml, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response("Not found", { status: 404 });
  };

  const call = (route, options = {}) => handleAuthRequest(new Request(`${base}${route}`, options), { store, fetchImpl: customFetch });

  // 1. Unauthenticated request to /api/widget/token returns 401
  const unauthTokRes = await call("/api/widget/token");
  assert.equal(unauthTokRes.status, 401);

  // 2. Unauthenticated request to /api/widget/latest returns 401
  const unauthLatestRes = await call("/api/widget/latest");
  assert.equal(unauthLatestRes.status, 401);

  // 3. Register user and save feed library
  const regRes = await call("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "widget-test@example.com", password: "Password123!", name: "Widget User" }),
  });
  const cookie = regRes.headers.get("set-cookie").split(";")[0];

  // Configure feed library with:
  // - a configured feed (feedId: "feed-tech", url: "https://technews.example/feed.xml", title: "Tech News")
  // - a savedItem without author that belongs to "feed-tech"
  // - an archived item that should be omitted
  await call("/api/feeds/library", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      feeds: [{ id: "feed-tech", url: "https://technews.example/feed.xml", title: "Tech News" }],
      savedItems: [
        { id: "item-saved-1", feedId: "feed-tech", title: "Saved Post Without Author", link: "https://technews.example/post-1", publishedAt: "2026-11-08T10:00:00Z" },
        { id: "item-archived-1", feedId: "feed-tech", title: "Archived Old Post", link: "https://technews.example/post-2", publishedAt: "2026-11-08T11:00:00Z" },
      ],
      archived: { "item-archived-1": "2026-11-08T11:30:00Z" },
    }),
  });

  // 4. Generate widget token
  const tokRes = await call("/api/widget/token", { headers: { cookie } });
  assert.equal(tokRes.status, 200);
  const { token } = await tokRes.json();
  assert.ok(token);

  // 5. Query /api/widget/latest with ?token=... (no cookies)
  const tokenQueryRes = await call(`/api/widget/latest?token=${encodeURIComponent(token)}`);
  assert.equal(tokenQueryRes.status, 200);
  const data = await tokenQueryRes.json();
  assert.equal(data.ok, true);
  assert.equal(data.user, "Widget User");

  // Verify:
  // - Configured feed items were fetched ("Latest Tech Breakthrough")
  const breakthroughItem = data.items.find((i) => i.title === "Latest Tech Breakthrough");
  assert.ok(breakthroughItem);
  assert.equal(breakthroughItem.source, "Tech News");

  // - Saved item without author resolved source to feed title "Tech News" (Comment 6)
  const savedItem = data.items.find((i) => i.id === "item-saved-1");
  assert.ok(savedItem);
  assert.equal(savedItem.source, "Tech News");

  // - Archived item is omitted (Comment 2)
  const archivedItem = data.items.find((i) => i.id === "item-archived-1");
  assert.equal(archivedItem, undefined);

  // 6. Test Authorization: Bearer <token>
  const bearerRes = await call("/api/widget/latest", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(bearerRes.status, 200);
  const bearerData = await bearerRes.json();
  assert.equal(bearerData.ok, true);
  assert.equal(bearerData.count, data.count);

  // 7. Nonnumeric limit fallback (Comment 4)
  const nonnumericLimitRes = await call(`/api/widget/latest?token=${encodeURIComponent(token)}&limit=invalid_limit`);
  assert.equal(nonnumericLimitRes.status, 200);
  const nonnumericData = await nonnumericLimitRes.json();
  assert.ok(nonnumericData.items.length > 0, "Invalid limit should fallback to default rather than returning empty array");
});

test("Scriptable widget code generation produces valid, error-free JavaScript", async () => {
  const fs = await import("fs");
  const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const start = appJs.indexOf("function generateScriptableCode(");
  assert.ok(start !== -1, "generateScriptableCode exists in public/app.js");
  const end = appJs.indexOf("let activeWidgetSize =", start);
  assert.ok(end !== -1, "generateScriptableCode ending located");
  const fnCode = "(" + appJs.slice(start, end).trim() + ")";
  const generateScriptableCode = eval(fnCode);

  const testEndpoint = "https://picker.rynell.org/api/widget/latest?token=test-widget-token-123";
  const script = generateScriptableCode(testEndpoint, "test-widget-token-123", "large");

  assert.ok(script.includes(testEndpoint));
  assert.ok(script.includes("test-widget-token-123"));
  assert.ok(script.includes('PREFERRED_SIZE = "large"'));
  assert.ok(script.includes("presentLarge()"));
  assert.ok(!script.includes("replace(//"), "Must not contain broken unescaped regex literal in template string");

  // Validate JavaScript syntax parses cleanly for all widget sizes
  for (const s of ["small", "medium", "large"]) {
    const sCode = generateScriptableCode(testEndpoint, "test-widget-token-123", s);
    assert.doesNotThrow(() => {
      new Function("async () => {\n" + sCode + "\n}");
    }, `Generated Scriptable code for ${s} must be 100% syntactically valid JavaScript`);
  }
});
