import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../worker.mjs";
import { normalizeFeedlySubscriptions } from "../feedly.mjs";

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
