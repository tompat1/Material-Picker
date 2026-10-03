const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const core = require("../public/app-core.js");

function browserApp() {
  const saved = new Map([["material-picker:v1", JSON.stringify({
    videos: [{ id: "library-1", title: "Clay archive", url: "https://vimeo.com/471301104" }],
    collections: [],
  })]]);
  const element = () => ({
    value: "", innerHTML: "", hidden: false, checked: false, dataset: {},
    classList: { toggle() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  });
  const nodes = new Map();
  const document = {
    body: { dataset: { pickerSignedIn: "false" } },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    addEventListener() {},
  };
  const context = vm.createContext({
    window: { MaterialPickerCore: core, clearTimeout }, document,
    localStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    crypto, File, URL, performance, console, setTimeout, clearTimeout,
  });
  const appSource = fs.readFileSync(require.resolve("../public/app.js"), "utf8").replace("\ninit();", "");
  const feedSource = fs.readFileSync(require.resolve("../public/rss-desk.js"), "utf8");
  vm.runInContext(`${appSource}\n${feedSource}\n
    renderFeeds = () => {};
    paintFeedHealth = () => {};
    scheduleLibraryPush = () => {};
    pushFeedLibrary = async () => {};
    youtubeShelf.subscriptions = [{ title: "Clay tutorial", url: "https://www.youtube.com/watch?v=abcdefghijk", speaker: "Studio North" }];
    globalThis.app = {
      index: buildGlobalAppIndex,
      renderSearch: renderGlobalSearchBody,
      addFeed: storeFeed,
      removeFeed(id) { selectedFeedIds = new Set([id]); deleteSelectedFeeds(); },
      syncFeeds: syncFeedLibrary,
    };
  `, context);
  return { app: context.app, nodes, saved, context, document };
}

test("global search finds library, YouTube, and RSS entries as feeds are added and removed", () => {
  const { app, nodes, saved } = browserApp();
  const input = nodes.get("#globalSearchInput") || { value: "" };
  nodes.set("#globalSearchInput", input);
  const body = nodes.get("#globalSearchBody") || { innerHTML: "", querySelectorAll: () => [] };
  nodes.set("#globalSearchBody", body);

  let matches = app.index().filter((item) => item.text.includes("clay"));
  assert.ok(matches.some((item) => item.category === "Library Videos" && item.title === "Clay archive"));
  assert.ok(matches.some((item) => item.category === "YouTube" && item.title === "Clay tutorial"));

  const feed = app.addFeed({
    url: "https://notes.example/feed.xml", title: "Clay notes", siteUrl: "https://notes.example/",
    items: [{ id: "post-1", title: "Kiln update", link: "https://notes.example/post-1" }],
  });
  input.value = "clay";
  app.renderSearch();
  assert.match(body.innerHTML, /Library Videos/);
  assert.match(body.innerHTML, /YouTube/);
  assert.match(body.innerHTML, /RSS Feeds/);
  assert.ok(app.index().some((item) => item.id === `rss:${feed.url}`));
  assert.equal(JSON.parse(saved.get("material-picker:feeds")).feeds.length, 1);

  app.removeFeed(feed.id);
  app.renderSearch();
  assert.doesNotMatch(body.innerHTML, /RSS Feeds/);
  assert.ok(!app.index().some((item) => item.id === `rss:${feed.url}`));
  const after = JSON.parse(saved.get("material-picker:feeds"));
  assert.deepEqual(after.feeds, []);
  assert.deepEqual(after.items, []);
  assert.ok(after.removedUrls.includes(feed.url));
});

test("a removed RSS feed from another device disappears from local feeds and global search", async () => {
  const { app, context, document, saved } = browserApp();
  const feed = app.addFeed({ url: "https://notes.example/feed.xml", title: "Clay notes", items: [{ id: "post-1", title: "Kiln update" }] });
  document.body.dataset.pickerSignedIn = "true";
  context.fetch = async () => ({ ok: true, json: async () => ({ feeds: [], folders: [], removedUrls: [feed.url] }) });
  await app.syncFeeds();
  assert.ok(!app.index().some((item) => item.id === `rss:${feed.url}`));
  const after = JSON.parse(saved.get("material-picker:feeds"));
  assert.deepEqual(after.feeds, []);
  assert.deepEqual(after.items, []);
  assert.ok(after.removedUrls.includes(feed.url));
});
