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
    documentElement: { dataset: {} },
    body: {
      dataset: { pickerSignedIn: "true" },
      classList: element().classList,
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
    window: {
      MaterialPickerCore: core,
      clearTimeout,
      matchMedia: () => ({ matches: true }),
      requestAnimationFrame: (cb) => cb(),
    },
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
    ...(typeof initialState.fetch === "function" ? { fetch: initialState.fetch } : {}),
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
      floatPlayBubble,
      returnFromPlayBubble,
      exitPlayBubbleFullscreen,
      setLivePlayback: (val) => { livePlayback = val; },
      loadAccount,
      signOutAccount,
      saveRecentGlobalSearch,
      getRecentGlobalSearches,
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

test("mini preview opens in fullscreen without navigating to the video post page and upper fullscreen icon is removed", () => {
  const html = fs.readFileSync(require.resolve("../public/index.html"), "utf8");
  assert.ok(!html.includes("id=\"playerSizeToggle\""), "Upper fullscreen/minimize icon (#playerSizeToggle) should be removed");

  const { harness, document } = createTestHarness();
  const shell = document.querySelector(".player-shell");
  const embed = document.querySelector("#embedPlayer");
  const deskFeeds = document.querySelector("#desk-feeds");
  const deskLibrary = document.querySelector("#desk-library");
  const bubble = document.querySelector("#playBubble");

  deskFeeds.checked = true;
  deskFeeds.id = "desk-feeds";
  deskLibrary.checked = false;
  deskLibrary.id = "desk-library";
  const origQuerySelector = document.querySelector.bind(document);
  document.querySelector = (sel) => {
    if (sel === 'input[name="desk"]:checked') return deskFeeds;
    return origQuerySelector(sel);
  };

  shell.dataset.mode = "embed";
  let fullscreenRequested = 0;
  shell.requestFullscreen = () => {
    fullscreenRequested += 1;
    return Promise.resolve();
  };
  embed.getAttribute = (attr) => (attr === "src" ? "https://www.youtube-nocookie.com/embed/abc123" : null);

  harness.setLivePlayback(true);
  assert.equal(harness.floatPlayBubble(), true);
  assert.equal(document.body.classList.contains("is-player-floating"), true);
  assert.equal(bubble.hidden, false);

  harness.returnFromPlayBubble();
  assert.equal(fullscreenRequested, 1, "Should request fullscreen on player");
  assert.equal(document.body.classList.contains("is-player-fullscreen"), true, "Should enter fullscreen state");
  assert.equal(document.body.classList.contains("is-mobile-player"), false, "Should not open mobile video post page");
  assert.equal(deskLibrary.checked, false, "Should not switch desk to library/post page");
  assert.equal(deskFeeds.checked, true, "Should remain on feeds desk");

  harness.exitPlayBubbleFullscreen();
  assert.equal(document.body.classList.contains("is-player-fullscreen"), false, "Should exit fullscreen state");
  assert.equal(document.body.classList.contains("is-player-floating"), true, "Should restore floating mini preview");
  assert.equal(bubble.hidden, false, "Mini preview should be visible again");
});

test("user changes are saved to the server on logout and restored on login without depending on localStorage", async () => {
  let serverUserState = null;
  let signedIn = true;

  const { harness, saved } = createTestHarness({
    fetch: async (url, init = {}) => {
      const path = String(url);
      if (path === "/api/auth/state" && init.method === "PUT") {
        serverUserState = {
          ...JSON.parse(init.body),
          updatedAt: "2026-11-02T20:00:00.000Z",
        };
        return { ok: true, json: async () => serverUserState };
      }
      if (path === "/api/auth/state") {
        return { ok: true, json: async () => serverUserState || {} };
      }
      if (path === "/api/auth/logout") {
        signedIn = false;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (path === "/api/auth/me") {
        return {
          ok: true,
          json: async () => ({
            configured: true,
            user: signedIn ? { id: "u1", email: "user@example.com", name: "User", youtubeConnected: true } : null,
            state: signedIn ? serverUserState : null,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  await harness.loadAccount();
  harness.getYoutubeShelf().channels = [
    { id: "UC_FAV", title: "Fav Channel" },
    { id: "UC_REM", title: "Removed Channel" },
  ];

  // Make user changes across the app
  harness.toggleYouTubeFavoriteChannel("UC_FAV");
  harness.removeYouTubeChannel("UC_REM");
  harness.setYouTubeSubFilter("favourites");
  harness.saveRecentGlobalSearch("oled review");

  // Log out: flushes to server and clears local state & localStorage
  await harness.signOutAccount();
  assert.equal(signedIn, false);
  assert.ok(serverUserState, "User state should be pushed to server before logout completes");
  assert.deepEqual(Array.from(harness.getYouTubeFavoriteChannels()), [], "In-memory favourites cleared on logout");
  assert.deepEqual(Array.from(harness.getYouTubeRemovedChannels()), [], "In-memory removed channels cleared on logout");
  assert.equal(saved.get("material-picker:v1"), undefined, "localStorage cleared on logout");

  // Clear localStorage completely and log back in
  saved.clear();
  signedIn = true;
  await harness.loadAccount();

  // Verify all user changes are restored from server without relying on localStorage
  assert.deepEqual(Array.from(harness.getYouTubeFavoriteChannels()), ["UC_FAV"]);
  assert.deepEqual(Array.from(harness.getYouTubeRemovedChannels()), ["UC_REM"]);
  assert.equal(harness.getYouTubeSubFilter(), "favourites");
  assert.deepEqual(Array.from(harness.getRecentGlobalSearches()), ["oled review"]);
});
