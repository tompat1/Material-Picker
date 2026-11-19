const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function createFeedsContext({ initialFeeds = [] } = {}) {
  const elements = new Map();
  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: "",
        hidden: false,
        classList: {
          _classes: new Set(),
          add(c) { this._classes.add(c); },
          remove(c) { this._classes.delete(c); },
          contains(c) { return this._classes.has(c); },
          toggle(c, val) { if (val) this.add(c); else this.remove(c); },
        },
      });
    }
    return elements.get(id);
  }

  // Pre-create known elements
  getElement("feedsStatus");
  getElement("feedsRepairBanner");
  getElement("feedsPanel");

  const saved = new Map([["material-picker:feeds", JSON.stringify({
    feeds: initialFeeds,
    folders: [],
    items: [],
  })]]);

  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      addEventListener() {},
      querySelector: (selector) => {
        if (selector === "#feedsStatus") return getElement("feedsStatus");
        if (selector === "#feedsRepairBanner") return getElement("feedsRepairBanner");
        if (selector === "#feedsPanel") return getElement("feedsPanel");
        return null;
      },
      querySelectorAll: () => [],
    },
    window: {
      clearTimeout,
      setTimeout,
      matchMedia: () => ({ matches: false }),
    },
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
    globalThis.testHarness = {
      paintFeedHealth,
      setFeedStatus,
      state: feedState,
      getStatusNode: () => document.querySelector("#feedsStatus"),
      getBannerNode: () => document.querySelector("#feedsRepairBanner"),
    };
  `, context);

  return context.testHarness;
}

test("broken feeds render into feedsRepairBanner and not into feedsStatus in the header", () => {
  const harness = createFeedsContext({
    initialFeeds: [
      { id: "feed-1", title: "Apple News Podcast", url: "https://example.com/pod", status: "broken" },
      { id: "feed-2", title: "The Games", url: "https://example.com/games", status: "dead" },
    ],
  });

  harness.paintFeedHealth();

  const statusNode = harness.getStatusNode();
  const bannerNode = harness.getBannerNode();

  // feedsStatus in the header sort row must remain empty and free of repair markup
  assert.equal(statusNode.innerHTML, "");
  assert.equal(statusNode.classList.contains("is-warn"), false);

  // feedsRepairBanner displays the alert message and action buttons
  assert.equal(bannerNode.hidden, false);
  assert.match(bannerNode.innerHTML, /Apple News Podcast/);
  assert.match(bannerNode.innerHTML, /The Games/);
  assert.match(bannerNode.innerHTML, /data-resolve-feed="feed-1"/);
  assert.match(bannerNode.innerHTML, /data-delete-feed="feed-2"/);
});

test("when all feeds are healthy feedsRepairBanner is hidden and empty", () => {
  const harness = createFeedsContext({
    initialFeeds: [
      { id: "feed-1", title: "Apple News Podcast", url: "https://example.com/pod" },
    ],
  });

  harness.paintFeedHealth();

  const bannerNode = harness.getBannerNode();
  assert.equal(bannerNode.hidden, true);
  assert.equal(bannerNode.innerHTML, "");
});
