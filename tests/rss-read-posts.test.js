const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function readPostApp() {
  const saved = new Map([["material-picker:feeds", JSON.stringify({
    feeds: [
      { id: "tech-feed", title: "Tech feed", url: "https://tech.example/feed", folderIds: ["tech"] },
      { id: "news-feed", title: "News feed", url: "https://news.example/feed", folderIds: ["news"] },
    ],
    folders: [{ id: "tech", name: "Tech" }, { id: "news", name: "News" }],
    items: [
      { id: "unread-tech", feedId: "tech-feed", title: "Unread tech", publishedAt: "2026-10-30T09:00:00Z" },
      { id: "read-tech", feedId: "tech-feed", title: "Read tech", publishedAt: "2026-10-29T09:00:00Z" },
      { id: "read-news", feedId: "news-feed", title: "Read news", publishedAt: "2026-10-28T09:00:00Z" },
      { id: "archived-news", feedId: "news-feed", title: "Archived news", publishedAt: "2026-10-27T09:00:00Z" },
    ],
    read: { "read-tech": true, "read-news": true, "archived-news": true },
    archived: { "archived-news": true },
  })]]);
  const context = vm.createContext({
    document: { body: { dataset: {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { clearTimeout, setTimeout, matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
    },
    crypto,
    URL,
    Intl,
    console,
    setTimeout,
    clearTimeout,
    confirm: () => true,
  });
  const source = fs.readFileSync(require.resolve("../public/rss-desk.js"), "utf8");
  vm.runInContext(`${source}\n
    globalThis.readPostTest = {
      items: itemsForSource,
      setReadView(value) { showReadPosts = Boolean(value); },
      toggleReadView: toggleReadPostsView,
      state: feedState,
      store: storeFeed,
    };
  `, context);
  return context.readPostTest;
}

test("read feed view keeps opened posts available and excludes archived posts", () => {
  const app = readPostApp();
  assert.deepEqual([...app.items("all")].map((item) => item.id), ["unread-tech", "read-tech", "read-news"]);
  assert.deepEqual([...app.items("folder:tech")].map((item) => item.id), ["unread-tech", "read-tech"]);

  app.toggleReadView();
  assert.deepEqual([...app.items("all")].map((item) => item.id), ["read-tech", "read-news"]);
  assert.deepEqual([...app.items("folder:tech")].map((item) => item.id), ["read-tech"]);
  assert.deepEqual([...app.items("folder:news")].map((item) => item.id), ["read-news"]);
});

test("feed refreshes retain older posts with user history beyond the transient cap", () => {
  const app = readPostApp();
  const latestItems = Array.from({ length: 40 }, (_, index) => ({
    id: `new-${index}`,
    title: `New ${index}`,
    link: `https://tech.example/new-${index}`,
    publishedAt: new Date(Date.UTC(2026, 9, 30, 12, index)).toISOString(),
  }));

  app.store({
    url: "https://tech.example/feed",
    title: "Tech feed",
    items: latestItems,
  });

  assert.ok(app.state.items.some((item) => item.id === "read-tech"));
  assert.ok(app.state.items.some((item) => item.id === "tech-feed:new-0"));
});
