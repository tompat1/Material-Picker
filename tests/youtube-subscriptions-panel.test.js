const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const core = require("../public/app-core.js");

function createTestHarness(initialState = {}) {
  const saved = new Map([
    ["material-picker:v1", JSON.stringify({
      videos: [],
      collections: [],
      youtubeFavoriteChannels: initialState.youtubeFavoriteChannels || [],
      youtubeRemovedChannels: initialState.youtubeRemovedChannels || [],
      youtubeSubFilter: initialState.youtubeSubFilter || "latest",
    })],
  ]);

  const element = (tag = "div") => ({
    tagName: tag.toUpperCase(),
    value: "",
    innerHTML: "",
    hidden: false,
    checked: false,
    dataset: {},
    style: {},
    offsetWidth: 120,
    offsetHeight: 30,
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach((c) => this._classes.add(c)); },
      remove(...cls) { cls.forEach((c) => this._classes.delete(c)); },
      toggle(cls, force) {
        if (force === undefined) {
          if (this._classes.has(cls)) this._classes.delete(cls);
          else this._classes.add(cls);
        } else if (force) {
          this._classes.add(cls);
        } else {
          this._classes.delete(cls);
        }
      },
      contains(cls) { return this._classes.has(cls); },
    },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; },
  });

  const nodes = new Map();
  const document = {
    body: {
      dataset: { pickerSignedIn: "true" },
      append() {},
    },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    createElement(tag) { return element(tag); },
    addEventListener() {},
  };

  const context = vm.createContext({
    window: { MaterialPickerCore: core, clearTimeout },
    document,
    localStorage: {
      getItem: (key) => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
    crypto,
    File,
    URL,
    requestAnimationFrame: (cb) => cb(),
    innerWidth: 1000,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
  });

  const appSource = fs.readFileSync(require.resolve("../public/app.js"), "utf8").replace("\ninit();", "");
  vm.runInContext(`${appSource}\n
    globalThis.testHarness = {
      getYoutubeShelf: () => youtubeShelf,
      getState: () => state,
      renderYouTubeHome,
      renderYouTubeChannels,
      getYouTubeFavoriteChannels,
      getYouTubeRemovedChannels,
      getYouTubeSubFilter,
      setYouTubeSubFilter,
      toggleYouTubeFavoriteChannel,
      removeYouTubeChannel,
      restoreRemovedYouTubeChannels,
      getChannelLatestTime,
    };
  `, context);

  return { harness: context.testHarness, document, nodes, saved };
}

test("youtube subscriptions panel supports toggling favorites with persistent storage", () => {
  const { harness, saved } = createTestHarness();

  harness.getYoutubeShelf().channels = [
    { id: "UC111", title: "Alpha Studio", thumbnail: "https://thumb/1" },
    { id: "UC222", title: "Beta Lab", thumbnail: "https://thumb/2" },
  ];

  assert.deepEqual(harness.getYouTubeFavoriteChannels(), []);

  // Add UC111 as favourite
  harness.toggleYouTubeFavoriteChannel("UC111");
  assert.deepEqual(harness.getYouTubeFavoriteChannels(), ["UC111"]);
  const storedAfterAdd = JSON.parse(saved.get("material-picker:v1"));
  assert.deepEqual(storedAfterAdd.youtubeFavoriteChannels, ["UC111"]);

  // Toggle UC111 again to remove
  harness.toggleYouTubeFavoriteChannel("UC111");
  assert.deepEqual(harness.getYouTubeFavoriteChannels(), []);
  const storedAfterRemove = JSON.parse(saved.get("material-picker:v1"));
  assert.deepEqual(storedAfterRemove.youtubeFavoriteChannels, []);
});

test("youtube subscriptions panel supports removing subscriptions and restoring them", () => {
  const { harness, saved } = createTestHarness();

  harness.getYoutubeShelf().channels = [
    { id: "UC111", title: "Alpha Studio" },
    { id: "UC222", title: "Beta Lab" },
    { id: "UC333", title: "Gamma Tech" },
  ];

  // Remove UC222
  harness.removeYouTubeChannel("UC222");
  assert.deepEqual(harness.getYouTubeRemovedChannels(), ["UC222"]);
  let stored = JSON.parse(saved.get("material-picker:v1"));
  assert.deepEqual(stored.youtubeRemovedChannels, ["UC222"]);

  // Remove UC333
  harness.removeYouTubeChannel("UC333");
  assert.deepEqual(harness.getYouTubeRemovedChannels(), ["UC222", "UC333"]);

  // Restore specific channel UC222
  harness.restoreRemovedYouTubeChannels("UC222");
  assert.deepEqual(harness.getYouTubeRemovedChannels(), ["UC333"]);

  // Restore all
  harness.restoreRemovedYouTubeChannels();
  assert.deepEqual([...harness.getYouTubeRemovedChannels()], []);
});

test("youtube subscriptions panel filters by latest, favourites, alphabetical, and current new content", () => {
  const { harness, document } = createTestHarness();

  const channels = [
    { id: "UC_ALPHA", title: "Alpha Channel" },
    { id: "UC_BETA", title: "Beta Channel" },
    { id: "UC_GAMMA", title: "Gamma Channel" },
    { id: "UC_DELTA", title: "Delta Channel" },
  ];

  harness.getYoutubeShelf().channels = channels;
  harness.getYoutubeShelf().subscriptions = [
    { channelId: "UC_BETA", publishedAt: "2026-11-01T10:00:00Z", url: "https://yt/beta-latest" },
    { channelId: "UC_DELTA", publishedAt: "2026-11-02T08:00:00Z", url: "https://yt/delta-newest" },
    { channelId: "UC_ALPHA", publishedAt: "2026-10-15T12:00:00Z", url: "https://yt/alpha-old" },
  ];

  const panel = document.querySelector("#youtubeSubsPanel");

  // 1. Filter: latest (Delta is newest 11-02, then Beta 11-01, then Alpha 10-15, then Gamma no uploads)
  harness.setYouTubeSubFilter("latest");
  assert.equal(harness.getYouTubeSubFilter(), "latest");
  let rendered = panel.innerHTML;
  const posDelta = rendered.indexOf("Delta Channel");
  const posBeta = rendered.indexOf("Beta Channel");
  const posAlpha = rendered.indexOf("Alpha Channel");
  const posGamma = rendered.indexOf("Gamma Channel");
  assert.ok(posDelta < posBeta, "Delta should be before Beta in latest");
  assert.ok(posBeta < posAlpha, "Beta should be before Alpha in latest");
  assert.ok(posAlpha < posGamma, "Alpha should be before Gamma in latest");

  // 2. Filter: favourites
  harness.toggleYouTubeFavoriteChannel("UC_GAMMA");
  harness.setYouTubeSubFilter("favourites");
  rendered = panel.innerHTML;
  assert.ok(rendered.includes("Gamma Channel"));
  assert.ok(!rendered.includes("Alpha Channel"));
  assert.ok(!rendered.includes("Beta Channel"));
  assert.ok(!rendered.includes("Delta Channel"));

  // 3. Filter: alphabetical (A-Z)
  harness.setYouTubeSubFilter("alphabetical");
  rendered = panel.innerHTML;
  const pA = rendered.indexOf("Alpha Channel");
  const pB = rendered.indexOf("Beta Channel");
  const pD = rendered.indexOf("Delta Channel");
  const pG = rendered.indexOf("Gamma Channel");
  assert.ok(pA < pB && pB < pD && pD < pG, "Alphabetical order A -> B -> D -> G");

  // 4. Filter: current new content (only channels with active videos in subscription feed: Delta, Beta, Alpha)
  harness.setYouTubeSubFilter("new");
  rendered = panel.innerHTML;
  assert.ok(rendered.includes("Delta Channel"));
  assert.ok(rendered.includes("Beta Channel"));
  assert.ok(rendered.includes("Alpha Channel"));
  assert.ok(!rendered.includes("Gamma Channel"), "Gamma has no new uploads, so excluded from new content filter");
});
