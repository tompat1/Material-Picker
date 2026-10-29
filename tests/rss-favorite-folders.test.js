const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function favoriteFolderApp() {
  const folders = ["Apple", "Music", "Film & TV", "Tech", "Gaming", "Science"]
    .map((name, index) => ({ id: `folder-${index + 1}`, name }));
  const saved = new Map([["material-picker:feeds", JSON.stringify({
    feeds: [],
    folders,
    favoriteFolderIds: folders.map((folder) => folder.id),
    items: [],
  })]]);
  const favoriteTabs = { hidden: true, innerHTML: "" };
  const document = {
    body: { dataset: {} },
    addEventListener() {},
    querySelector(selector) {
      return selector === "#feedsFavoriteTabs" ? favoriteTabs : null;
    },
  };
  const context = vm.createContext({
    document,
    window: { clearTimeout, setTimeout },
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
    let lastStatus = "";
    setFeedStatus = (message) => { lastStatus = message; };
    renderFeeds = () => {};
    globalThis.favoriteFolderTest = {
      state: feedState,
      toggle: toggleFavoriteFolder,
      iconKind: folderIconKind,
      renderTabs: renderFavoriteFolderTabs,
      status: () => lastStatus,
    };
  `, context);
  return { api: context.favoriteFolderTest, favoriteTabs, folders };
}

test("favorite feed folders are capped at five and can be replaced", () => {
  const { api, folders } = favoriteFolderApp();
  assert.deepEqual([...api.state.favoriteFolderIds], folders.slice(0, 5).map((folder) => folder.id));

  api.toggle(folders[5].id);
  assert.deepEqual([...api.state.favoriteFolderIds], folders.slice(0, 5).map((folder) => folder.id));
  assert.match(api.status(), /up to 5 favorite folder filters/i);

  api.toggle(folders[0].id);
  api.toggle(folders[5].id);
  assert.deepEqual([...api.state.favoriteFolderIds], [
    ...folders.slice(1, 5).map((folder) => folder.id),
    folders[5].id,
  ]);
});

test("favorite tabs use recognizable folder icons and desktop labels", () => {
  const { api, favoriteTabs, folders } = favoriteFolderApp();
  assert.equal(api.iconKind(folders[0]), "apple");
  assert.equal(api.iconKind(folders[1]), "music");
  assert.equal(api.iconKind(folders[2]), "film");
  assert.equal(api.iconKind(folders[3]), "tech");

  api.renderTabs();
  assert.equal(favoriteTabs.hidden, false);
  assert.match(favoriteTabs.innerHTML, /feeds-favorite-tab-label">Apple</);
  assert.match(favoriteTabs.innerHTML, /data-folder-icon="music"/);
  assert.match(favoriteTabs.innerHTML, /aria-label="Show Film &amp; TV feeds"/);
});
