import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAccountStore } from "../auth.mjs";
import { feedlyAuthUrl, handleFeedlyRequest, normalizeFeedlySubscriptions, parseFeedlyItems, parseFeedlySubscriptions } from "../feedly.mjs";
import { handleApiRequest } from "../worker.mjs";

test("Feedly sign-in uses Google on the same account flow", () => {
  const url = new URL(feedlyAuthUrl({
    clientId: "feedly",
    redirectUri: "http://127.0.0.1:4173/api/feedly/callback",
    state: "state-1",
  }));
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("client_id"), "feedly");
  assert.equal(url.searchParams.get("scope"), "https://cloud.feedly.com/subscriptions");
});

test("feed lists and articles keep titles, sources, and links", () => {
  const feeds = parseFeedlySubscriptions([
    { id: "feed/https://example.com/rss", title: "Clay", website: "https://example.com", categories: [{ label: "Studio" }] },
    { id: "user/1/category/global.all", title: "All" },
  ]);
  assert.deepEqual(feeds, [{ id: "feed/https://example.com/rss", title: "Clay", website: "https://example.com", category: "Studio" }]);
  const items = parseFeedlyItems({
    items: [{
      id: "entry/1",
      title: "A <b>new</b> glaze",
      alternate: [{ href: "https://example.com/glaze" }],
      origin: { title: "Clay" },
      published: 1000,
      summary: { content: "<p>Warm &amp; quiet.</p>" },
    }],
  });
  assert.equal(items[0].title, "A new glaze");
  assert.equal(items[0].excerpt, "Warm & quiet.");
  assert.equal(items[0].url, "https://example.com/glaze");
});

test("a signed-in Picker account can connect Feedly and read its feeds", async () => {
  const store = createMemoryAccountStore();
  const user = await store.createPasswordUser({ email: "tremdia@gmail.com", name: "Thomas", passwordHash: "hash" });
  const sessionId = await store.createSession(user.id);
  const start = await handleFeedlyRequest(new Request("http://127.0.0.1:4173/api/feedly/start", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store });
  assert.equal(start.status, 302);
  assert.match(start.headers.get("location"), /provider=google/);
  const stateCookie = start.headers.getSetCookie().find((item) => item.startsWith("picker_feedly_state="));
  const state = decodeURIComponent(stateCookie.split(";")[0].slice("picker_feedly_state=".length));
  const callback = await handleFeedlyRequest(
    new Request(`http://127.0.0.1:4173/api/feedly/callback?code=abc&state=${state}`, {
      headers: { cookie: `picker_session=${sessionId}; picker_feedly_state=${state}` },
    }),
    {
      store,
      fetchImpl: async (url) => {
        if (String(url).includes("/auth/token")) {
          return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600, id: "user-1" }));
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    },
  );
  assert.equal(callback.status, 302);
  assert.equal(new URL(callback.headers.get("location"), "http://127.0.0.1:4173").searchParams.get("desk"), "feeds");
  const home = await handleFeedlyRequest(new Request("http://127.0.0.1:4173/api/feedly/home", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), {
    store,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.authorization, "OAuth access");
      if (String(url).endsWith("/subscriptions")) {
        return new Response(JSON.stringify([{ id: "feed/https://example.com/rss", title: "Clay", categories: [{ label: "Studio" }] }]));
      }
      if (String(url).endsWith("/profile")) return new Response(JSON.stringify({ id: "user-1" }));
      if (String(url).includes("/streams/contents")) {
        assert.match(String(url), /user%2Fuser-1%2Fcategory%2Fglobal\.all/);
        return new Response(JSON.stringify({ items: [{ id: "e1", title: "Kiln", alternate: [{ href: "https://example.com/kiln" }], origin: { title: "Clay" }, published: 5 }] }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  const body = await home.json();
  assert.equal(body.feeds[0].title, "Clay");
  assert.equal(body.items[0].url, "https://example.com/kiln");
});

const SUBSCRIPTIONS = [
  {
    id: "feed/https://feeds.macrumors.com/MacRumors-All",
    title: "MacRumors",
    website: "https://www.macrumors.com/",
    categories: [{ id: "user/1/category/apple", label: "apple" }],
  },
  {
    id: "feed/https://www.polygon.com/rss/index.xml",
    title: "Polygon",
    website: "https://www.polygon.com/",
    categories: [{ id: "user/1/category/gaming", label: "gaming" }],
  },
  {
    id: "feed/https://feeds.macrumors.com/MacRumors-All",
    title: "MacRumors",
    categories: [{ id: "user/1/category/tech", label: "tech" }],
  },
];

test("normalizeFeedlySubscriptions keeps folders and merges a feed that appears twice", () => {
  const account = normalizeFeedlySubscriptions(SUBSCRIPTIONS);
  assert.deepEqual(account.folders.map((folder) => folder.name), ["apple", "gaming", "tech"]);
  assert.equal(account.feeds.length, 2);
  const macrumors = account.feeds.find((feed) => feed.title === "MacRumors");
  assert.equal(macrumors.url, "https://feeds.macrumors.com/MacRumors-All");
  assert.equal(macrumors.siteUrl, "https://www.macrumors.com/");
  assert.deepEqual(macrumors.folderIds, ["apple", "tech"]);
});

test("feedly import requires a token and does not fetch without one", async () => {
  let fetched = false;
  const response = await handleApiRequest(new Request("https://picker.example/api/feedly/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "short" }),
  }), {
    fetchImpl: async () => {
      fetched = true;
      return new Response("[]");
    },
  });
  assert.equal(response.status, 400);
  assert.equal(fetched, false);
});

test("feedly import copies subscriptions and a rejected token stays on Feedly", async () => {
  const seen = [];
  const ok = await handleApiRequest(new Request("https://picker.example/api/feedly/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "a".repeat(40) }),
  }), {
    fetchImpl: async (input) => {
      const href = String(input);
      seen.push(href);
      if (href.endsWith("/profile")) return new Response(JSON.stringify({ fullName: "Ada" }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(SUBSCRIPTIONS), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.label, "Ada");
  assert.equal(body.feeds.length, 2);
  assert.deepEqual(seen, [
    "https://cloud.feedly.com/v3/subscriptions",
    "https://cloud.feedly.com/v3/profile",
  ]);

  const denied = await handleApiRequest(new Request("https://picker.example/api/feedly/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "b".repeat(40) }),
  }), {
    fetchImpl: async () => new Response("no", { status: 401 }),
  });
  assert.equal(denied.status, 401);
  assert.match((await denied.json()).error, /not accepted/);
});
