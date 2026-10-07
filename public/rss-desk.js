const FEEDS_KEY = "material-picker:feeds";
const FEED_ITEM_CAP = 40;
const FEED_REFRESH_MS = 15 * 60 * 1000;
const TOPIC_LABELS = {
  news: "News",
  tech: "Tech",
  apple: "Apple",
  ai: "AI",
  politics: "Politics",
  movies: "Movies",
  gaming: "Gaming",
  science: "Science",
  business: "Business",
  sports: "Sports",
  photography: "Photography",
};

const feedState = loadFeedState();
let selectedSource = "all";
let previousSource = null;
let selectedItemId = "";
let feedPane = 0;
let feedChoices = [];
let feedRefreshTask = null;
let lastFeedRefreshAt = 0;
let selectedFeedIds = new Set();
let selectedFolderIds = new Set();
let folderFilterMode = "show";
let riverRenderLimit = 40;
let lastRenderedSourceKey = "";
let riverObserver = null;
let folderDraft = false;
let folderDraftMoves = false;
let folderDraftName = "";
let folderDraftFocus = false;
let editingFolderId = "";
let folderRenameFocus = false;
let folderActionPointerDown = false;
let foldersSectionCollapsed = false;
let allFeedsSectionCollapsed = false;
let selectedTopic = "popular";
let catalogQuery = "";
let catalogTopics = [];
let directoryFeeds = [];
let directoryRequest = 0;
let catalogPicks = new Map();
let feedSort = "latest";
let touchStart = null;

function cleanImageUrl(value) {
  const text = String(value || "").trim();
  if (!text || text === "undefined" || text === "null" || text === "[object Object]") return "";
  if (text.endsWith("/undefined") || text.endsWith("/null") || text.includes("/undefined?") || text.includes("/null?")) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.pathname.endsWith("/undefined") || url.pathname.endsWith("/null")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function loadFeedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEEDS_KEY) || "{}");
    const items = (Array.isArray(saved.items) ? saved.items : []).map((item) => {
      if (!item) return item;
      const image = cleanImageUrl(item.image);
      return image === item.image ? item : { ...item, image };
    });
    return {
      feeds: Array.isArray(saved.feeds) ? saved.feeds : [],
      folders: Array.isArray(saved.folders) ? saved.folders : [],
      items,
      read: saved.read && typeof saved.read === "object" ? saved.read : {},
      archived: saved.archived && typeof saved.archived === "object" ? saved.archived : {},
      starred: saved.starred && typeof saved.starred === "object" ? saved.starred : {},
      removedUrls: new Set(Array.isArray(saved.removedUrls) ? saved.removedUrls : []),
    };
  } catch {
    return { feeds: [], folders: [], items: [], read: {}, archived: {}, starred: {}, removedUrls: new Set() };
  }
}

let librarySignature = "";
let librarySyncTimer = 0;

function feedLibrarySignature() {
  const feeds = feedState.feeds
    .map((feed) => `${canonicalFeedUrl(feed.url)}|${feed.title}|${(feed.folderIds || []).join(",")}`)
    .sort();
  const folders = feedState.folders.map((folder) => `${folder.id}|${folder.name}`).sort();
  return JSON.stringify([feeds, folders]);
}

function libraryPayload() {
  return {
    feeds: feedState.feeds.map((feed) => ({
      id: feed.id,
      url: feed.url,
      title: feed.title,
      siteUrl: feed.siteUrl || "",
      topics: feed.topics || [],
      folderIds: feed.folderIds || [],
      addedAt: feed.addedAt || "",
    })),
    folders: feedState.folders.map((folder) => ({ id: folder.id, name: folder.name })),
    removedUrls: Array.from(feedState.removedUrls || []),
  };
}

function scheduleLibraryPush() {
  if (!pickerIsSignedIn()) return;
  window.clearTimeout(librarySyncTimer);
  librarySyncTimer = window.setTimeout(() => {
    void pushFeedLibrary();
  }, 700);
}

async function pushFeedLibrary() {
  if (!pickerIsSignedIn()) return;
  try {
    await fetch("/api/feeds/library", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(libraryPayload()),
    });
  } catch {
    // The list stays on this device until the next save.
  }
}

async function syncFeedLibrary() {
  if (!pickerIsSignedIn()) return;
  let remote = null;
  try {
    const response = await fetch("/api/feeds/library");
    if (!response.ok) return;
    remote = await response.json();
  } catch {
    return;
  }
  const remoteFeeds = Array.isArray(remote.feeds) ? remote.feeds : [];
  const remoteRemoved = new Set((Array.isArray(remote.removedUrls) ? remote.removedUrls : []).map(canonicalFeedUrl));
  const beforeRemovedCount = feedState.removedUrls.size;
  const beforeCount = feedState.feeds.length;
  feedState.feeds = feedState.feeds.filter((feed) => !remoteRemoved.has(canonicalFeedUrl(feed.url)));
  const keptIds = new Set(feedState.feeds.map((feed) => feed.id));
  feedState.items = feedState.items.filter((item) => keptIds.has(item.feedId));
  remoteRemoved.forEach((url) => feedState.removedUrls.add(url));
  const removed = beforeCount !== feedState.feeds.length;
  if (selectedSource.startsWith("feed:") && !keptIds.has(selectedSource.slice(5))) {
    selectedSource = "all";
    selectedItemId = "";
    feedPane = 0;
  }
  const known = new Set(feedState.feeds.map((feed) => canonicalFeedUrl(feed.url)));
  const removedUrls = feedState.removedUrls || new Set();
  let added = 0;
  remoteFeeds.forEach((feed) => {
    const key = canonicalFeedUrl(feed.url);
    if (!key || known.has(key) || removedUrls.has(key)) return;
    known.add(key);
    feedState.feeds.push({
      id: feed.id || crypto.randomUUID(),
      url: feed.url,
      title: feed.title || feedHost(feed.url) || "Untitled feed",
      siteUrl: feed.siteUrl || "",
      topics: Array.isArray(feed.topics) ? feed.topics : [],
      folderIds: Array.isArray(feed.folderIds) ? feed.folderIds : [],
      addedAt: feed.addedAt || new Date().toISOString(),
    });
    added += 1;
  });
  const folderIds = new Set(feedState.folders.map((folder) => folder.id));
  (Array.isArray(remote.folders) ? remote.folders : []).forEach((folder) => {
    if (!folder?.id || !folder?.name || folderIds.has(folder.id)) return;
    folderIds.add(folder.id);
    feedState.folders.push({ id: folder.id, name: folder.name });
  });
  const localOnly = feedState.feeds.some((feed) => !remoteFeeds.some((item) => canonicalFeedUrl(item.url) === canonicalFeedUrl(feed.url)));
  librarySignature = feedLibrarySignature();
  if (added || removed || feedState.removedUrls.size !== beforeRemovedCount) {
    saveFeedState();
    renderFeeds();
    if (added) void refreshFeeds({ force: true });
  }
  if (localOnly || added) scheduleLibraryPush();
}

function saveFeedState() {
  const next = feedLibrarySignature();
  const changed = Boolean(librarySignature) && next !== librarySignature;
  librarySignature = next;
  localStorage.setItem(FEEDS_KEY, JSON.stringify({
    ...feedState,
    removedUrls: Array.from(feedState.removedUrls || []),
  }));
  if (changed) scheduleLibraryPush();
}

function escapeFeedText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function feedHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeFeedInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

const feedUrlCache = new Map();
function canonicalFeedUrl(value) {
  if (!value) return "";
  let res = feedUrlCache.get(value);
  if (res !== undefined) return res;
  try {
    const url = new URL(normalizeFeedInput(value));
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const dropPort = (url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80");
    const port = url.port && !dropPort ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
    const search = params.length ? `?${params.map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`).join("&")}` : "";
    res = `${url.protocol.toLowerCase()}//${host}${port}${path}${search}`;
  } catch {
    res = String(value || "").trim().toLowerCase();
  }
  feedUrlCache.set(value, res);
  return res;
}

function canonicalItemKey(item) {
  if (!item) return "";
  if (item._canonicalKey) return item._canonicalKey;
  const link = item?.link || item?.videoUrl || "";
  const key = link ? canonicalFeedUrl(link) : `item:${item?.feedId || ""}:${item?.title || item?.id || ""}`;
  item._canonicalKey = key;
  return key;
}

function moveFeedFlag(map, from, to) {
  if (!map || !from || from === to) return;
  if (map[from]) map[to] = true;
  delete map[from];
}

function folderSlug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder";
}

function ensureFolder(name) {
  const label = String(name || "Folder").trim().slice(0, 80) || "Folder";
  const id = folderSlug(label);
  let folder = feedState.folders.find((item) => item.id === id);
  if (!folder) {
    folder = { id, name: label, collapsed: feedState.folders.length >= 3 };
    feedState.folders.push(folder);
  }
  return folder;
}

function folderIsOpen(folder) {
  return folder?.collapsed === false;
}

function setFolderOpen(folder, open) {
  if (!folder) return;
  folder.collapsed = !open;
}

function normalizeFolderCollapse() {
  feedState.folders.forEach((folder, index) => {
    if (typeof folder.collapsed !== "boolean") folder.collapsed = index >= 3;
  });
}

function toggleFolderSelection(id) {
  const folder = feedState.folders.find((item) => item.id === id);
  if (!folder) return;
  if (selectedFolderIds.has(id)) selectedFolderIds.delete(id);
  else selectedFolderIds.add(id);
  selectedSource = selectedFolderIds.size ? "folders" : "all";
  previousSource = null;
  selectedItemId = "";
  feedPane = 0;
  renderFeeds();
}

function selectedFolderNames() {
  return feedState.folders
    .filter((folder) => selectedFolderIds.has(folder.id))
    .map((folder) => folder.name);
}

function clearFolderSelection() {
  selectedFolderIds.clear();
  folderFilterMode = "show";
  selectedSource = "all";
  previousSource = null;
  selectedItemId = "";
  feedPane = 0;
  renderFeeds();
}

function renameFolder(id, value) {
  const folder = feedState.folders.find((item) => item.id === id);
  if (!folder) return false;
  const nextName = String(value || "").trim().slice(0, 80);
  const duplicate = feedState.folders.some(
    (item) => item.id !== id && item.name.toLowerCase() === nextName.toLowerCase()
  );
  if (!nextName || duplicate) {
    setFeedStatus(!nextName ? "Folder names cannot be empty." : `A folder named “${nextName}” already exists.`);
    folderRenameFocus = true;
    renderSources();
    return false;
  }
  editingFolderId = "";
  if (nextName === folder.name) {
    renderSources();
    return true;
  }
  folder.name = nextName;
  saveFeedState();
  setFeedStatus(`Renamed the folder to “${nextName}”.`);
  renderFeeds();
  return true;
}

function feedTime(item) {
  if (!item) return 0;
  if (typeof item._parsedTime === "number") return item._parsedTime;
  const value = Date.parse(item?.publishedAt || "");
  const time = Number.isFinite(value) ? value : 0;
  item._parsedTime = time;
  return time;
}

function formatClock(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time);
}

function dayKey(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "undated";
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "Earlier";
  const date = new Date(time);
  const today = new Date();
  const start = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const diff = start(today) - start(date);
  if (diff === 0) return "Today";
  if (diff === 86400000) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
}

function isPhoneFeeds() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function feedRecord(feedId) {
  return feedState.feeds.find((entry) => entry.id === feedId);
}

function itemById(id) {
  return feedState.items.find((item) => item.id === id);
}

function isUnread(item) {
  return item && !feedState.read[item.id] && !feedState.archived[item.id];
}

function unreadItems() {
  return feedState.items.filter(isUnread);
}

function uniqueStories(items) {
  const seen = new Set();
  const unique = [];
  for (const item of [...items].sort((a, b) => feedTime(b) - feedTime(a))) {
    const key = canonicalItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function itemsForSource(source = selectedSource) {
  if (source === "archive") return uniqueStories(feedState.items.filter((item) => feedState.archived[item.id]));
  if (source === "all") return uniqueStories(unreadItems());
  if (source === "folders") {
    const feedIds = new Set(
      feedState.feeds
        .filter((feed) => (feed.folderIds || []).some((id) => selectedFolderIds.has(id)))
        .map((feed) => feed.id)
    );
    if (folderFilterMode === "hide") {
      return uniqueStories(unreadItems().filter((item) => !feedIds.has(item.feedId)));
    }
    return uniqueStories(unreadItems().filter((item) => feedIds.has(item.feedId)));
  }
  if (source.startsWith("folder:")) {
    const folderId = source.slice(7);
    const feedIds = new Set(feedState.feeds.filter((feed) => (feed.folderIds || []).includes(folderId)).map((feed) => feed.id));
    return uniqueStories(unreadItems().filter((item) => feedIds.has(item.feedId)));
  }
  if (source.startsWith("feed:")) {
    const feedId = source.slice(5);
    return uniqueStories(unreadItems().filter((item) => item.feedId === feedId));
  }
  return uniqueStories(unreadItems());
}

function dedupeFeedLibrary() {
  let changed = false;
  const groups = new Map();
  feedState.feeds.forEach((feed) => {
    const key = canonicalFeedUrl(feed.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feed);
  });
  const idMap = new Map();
  const kept = [];
  groups.forEach((group) => {
    const ranked = [...group].sort((a, b) => {
      const aCount = feedState.items.filter((item) => item.feedId === a.id).length;
      const bCount = feedState.items.filter((item) => item.feedId === b.id).length;
      if (bCount !== aCount) return bCount - aCount;
      return String(a.addedAt || "").localeCompare(String(b.addedAt || ""));
    });
    const primary = ranked[0];
    primary.folderIds = [...new Set(ranked.flatMap((feed) => feed.folderIds || []))];
    primary.topics = [...new Set(ranked.flatMap((feed) => feed.topics || []))];
    if (!primary.siteUrl) primary.siteUrl = ranked.find((feed) => feed.siteUrl)?.siteUrl || "";
    if (!primary.title) primary.title = ranked.find((feed) => feed.title)?.title || "Untitled feed";
    kept.push(primary);
    ranked.slice(1).forEach((feed) => idMap.set(feed.id, primary.id));
    if (ranked.length > 1) changed = true;
  });
  feedState.feeds = kept;
  if (idMap.size) {
    feedState.items.forEach((item) => {
      const nextId = idMap.get(item.feedId);
      if (!nextId) return;
      const oldId = item.id;
      const suffix = oldId.startsWith(`${item.feedId}:`) ? oldId.slice(item.feedId.length + 1) : oldId;
      item.feedId = nextId;
      item.id = `${nextId}:${suffix}`;
      moveFeedFlag(feedState.read, oldId, item.id);
      moveFeedFlag(feedState.archived, oldId, item.id);
      moveFeedFlag(feedState.starred, oldId, item.id);
    });
    if (selectedSource.startsWith("feed:") && idMap.has(selectedSource.slice(5))) {
      selectedSource = `feed:${idMap.get(selectedSource.slice(5))}`;
    }
    selectedFeedIds = new Set([...selectedFeedIds].map((id) => idMap.get(id) || id));
    changed = true;
  }
  const seen = new Map();
  const items = [];
  [...feedState.items].sort((a, b) => feedTime(b) - feedTime(a)).forEach((item) => {
    const key = canonicalItemKey(item);
    const existing = seen.get(key);
    if (existing) {
      moveFeedFlag(feedState.read, item.id, existing.id);
      moveFeedFlag(feedState.archived, item.id, existing.id);
      moveFeedFlag(feedState.starred, item.id, existing.id);
      delete feedState.read[item.id];
      delete feedState.archived[item.id];
      delete feedState.starred[item.id];
      changed = true;
      return;
    }
    seen.set(key, item);
    items.push(item);
  });
  if (items.length !== feedState.items.length) changed = true;
  feedState.items = items;
  if (changed) saveFeedState();
  return changed;
}

function sourceTitle(source = selectedSource) {
  if (source === "archive") return "Archive";
  if (source === "all") return "All";
  if (source === "folders") {
    const names = selectedFolderNames();
    if (folderFilterMode === "hide") {
      if (names.length === 1) return `Hiding ${names[0]}`;
      if (names.length === 2) return `Hiding ${names.join(" + ")}`;
      return `Hiding ${names.length} folders`;
    }
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(" + ");
    return `${names.length} selected folders`;
  }
  if (source.startsWith("folder:")) return feedState.folders.find((folder) => folder.id === source.slice(7))?.name || "Folder";
  if (source.startsWith("feed:")) return feedRecord(source.slice(5))?.title || "Feed";
  return "All";
}

function countLabel(count) {
  return new Intl.NumberFormat(undefined).format(count);
}

function folderFilterBanner() {
  const names = selectedFolderNames();
  if (selectedSource !== "folders" || !names.length) return "";
  const label = names.length <= 3
    ? names.join(" · ")
    : `${names.slice(0, 2).join(" · ")} + ${names.length - 2} more`;
  const isHide = folderFilterMode === "hide";
  const icon = isHide
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2-2h3.2c1.1 0 2 .9 2 2v1"/><path d="M4.8 18.5h12.9a2 2 0 0 0 1.9-1.5l1.2-5.2a1.5 1.5 0 0 0-1.5-1.8H5.2a1.8 1.8 0 0 0-1.8 2.2l1.4 6.3Z"/></svg>`;
  const text = isHide
    ? `Hiding <strong>${escapeFeedText(label)}</strong>`
    : `Showing <strong>${escapeFeedText(label)}</strong>`;
  return `<aside class="feeds-folder-filter-banner" aria-label="Filtered folder view">
    <span>
      ${icon}
      <span>${text}</span>
    </span>
    <span class="feeds-folder-filter-actions">
      <button type="button" data-edit-folder-filter>Edit</button>
      <button type="button" data-clear-folder-filter>Show all</button>
    </span>
  </aside>`;
}

const FEED_PATH_GUESSES = [
  "/index.rss",
  "/feed/",
  "/feed",
  "/rss.xml",
  "/rss",
  "/atom.xml",
  "/feeds/all",
  "/feeds/posts/default",
];

function hostBrand(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 3 && ["co", "com", "org", "net", "gov", "ac"].includes(parts[parts.length - 2])) {
      return parts[parts.length - 3] || "";
    }
    return parts[parts.length - 2] || parts[0] || "";
  } catch {
    return "";
  }
}

function feedLooksRelated(candidate, original) {
  const feedBrand = hostBrand(original.url);
  const siteBrand = hostBrand(original.siteUrl);
  const candidateBrand = hostBrand(candidate.url) || hostBrand(candidate.siteUrl);
  if (!candidateBrand) return false;
  if (feedBrand && candidateBrand === feedBrand) return true;
  if (siteBrand && candidateBrand === siteBrand && (!feedBrand || siteBrand === feedBrand)) return true;
  return false;
}

function feedIsCurrent(feed) {
  const times = (feed.items || []).map((item) => Date.parse(item.publishedAt || "")).filter(Number.isFinite);
  if (!times.length) return (feed.items || []).length > 0;
  return Date.now() - Math.max(...times) < 730 * 24 * 60 * 60 * 1000;
}

function feedResolveCandidates(feed) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = canonicalFeedUrl(url);
    if (!key || seen.has(key) || key === canonicalFeedUrl(feed.url)) return;
    seen.add(key);
    out.push(url);
  };
  try {
    const current = new URL(feed.url);
    if (current.protocol === "http:") {
      current.protocol = "https:";
      add(current.href);
    }
  } catch {
    // Keep going with site and path guesses.
  }
  add(feed.siteUrl);
  [feed.siteUrl, feed.url].forEach((base) => {
    try {
      const origin = new URL(base);
      FEED_PATH_GUESSES.forEach((path) => add(`${origin.origin}${path}`));
      if (origin.hostname.startsWith("www.")) {
        const bare = new URL(origin.href);
        bare.hostname = origin.hostname.slice(4);
        FEED_PATH_GUESSES.forEach((path) => add(`${bare.origin}${path}`));
      }
    } catch {
      // Skip bad origins.
    }
  });
  return out;
}

function brokenFeeds() {
  return feedState.feeds.filter((feed) => feed.status === "broken");
}

function deadFeeds() {
  return feedState.feeds.filter((feed) => feed.status === "dead");
}

function setFeedHealth(feed, status) {
  if (!feed) return;
  if (!status || status === "ok") delete feed.status;
  else feed.status = status;
}

let feedStatusTimer = 0;

function paintFeedHealth(message = "") {
  const node = document.querySelector("#feedsStatus");
  if (!node) return;
  const broken = brokenFeeds();
  const dead = deadFeeds();
  if (!broken.length && !dead.length) {
    node.classList.remove("is-warn");
    if (message) {
      const throbberHtml = `<span class="amber-throbber amber-throbber--xs" aria-hidden="true"></span>`;
      node.innerHTML = `<p class="feeds-status-line">${throbberHtml}<span>${escapeFeedText(message)}</span></p>`;
      window.clearTimeout(feedStatusTimer);
      feedStatusTimer = window.setTimeout(() => {
        node.innerHTML = "";
      }, 3000);
    } else {
      node.innerHTML = "";
    }
    return;
  }
  node.classList.add("is-warn");
  const lead = message
    || (broken.length
      ? "Some feeds need a new address. Resolve the ones that are still alive, or remove the rest."
      : "These feeds look dead. Remove them from your list.");
  const rows = [
    ...broken.map((feed) => `<li>
      <span>${escapeFeedText(feed.title)}</span>
      <button type="button" data-resolve-feed="${escapeFeedText(feed.id)}">Resolve</button>
      <button type="button" data-delete-feed="${escapeFeedText(feed.id)}">Remove</button>
    </li>`),
    ...dead.map((feed) => `<li class="is-dead">
      <span>Could not resolve ${escapeFeedText(feed.title)} — remove this subscription</span>
      <button type="button" data-delete-feed="${escapeFeedText(feed.id)}">Remove</button>
    </li>`),
  ];
  if (broken.length > 1) {
    rows.push(`<li class="feeds-repair-all"><button type="button" data-resolve-all>Resolve all</button></li>`);
  }
  node.innerHTML = `<p>${escapeFeedText(lead)}</p><ul class="feeds-repair">${rows.join("")}</ul>`;
}

function setFeedStatus(message) {
  const node = document.querySelector("#feedsStatus");
  if (!node) return;
  window.clearTimeout(feedStatusTimer);
  const isUpdating = /^Refreshing|^Looking for|^Adding|^Reading|^Loading/i.test(message || "");
  const broken = brokenFeeds();
  const dead = deadFeeds();

  if (message && (isUpdating || (!broken.length && !dead.length))) {
    node.classList.remove("is-warn");
    const throbberHtml = `<span class="amber-throbber amber-throbber--xs" aria-hidden="true"></span>`;
    node.innerHTML = `<p class="feeds-status-line">${throbberHtml}<span>${escapeFeedText(message)}</span></p>`;
    window.paintPickerLoader?.();
    if (!isUpdating && message) {
      feedStatusTimer = window.setTimeout(() => {
        if (brokenFeeds().length || deadFeeds().length) {
          paintFeedHealth();
        } else {
          node.innerHTML = "";
        }
        window.paintPickerLoader?.();
      }, 3000);
    }
    return;
  }
  paintFeedHealth(message || "");
  window.paintPickerLoader?.();
}

async function requestFeed(url) {
  const response = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false || data.error) throw new Error(data.error || "The feed could not be loaded.");
  return data;
}

async function tryLoadFeed(url) {
  const result = await requestFeed(url);
  if (result.kind === "feed" && result.feed) return result.feed;
  if (result.kind === "choices") {
    for (const choice of (result.feeds || []).slice(0, 4)) {
      try {
        const next = await requestFeed(choice.url);
        if (next.kind === "feed" && next.feed) return next.feed;
      } catch {
        // Try the next discovered feed.
      }
    }
  }
  return null;
}

async function resolveFeed(feedId) {
  const feed = feedRecord(feedId);
  if (!feed) return false;
  setFeedStatus(`Looking for a working address for ${feed.title}…`);
  for (const url of feedResolveCandidates(feed)) {
    try {
      const found = await tryLoadFeed(url);
      if (!found || !feedLooksRelated(found, feed) || !feedIsCurrent(found)) continue;
      storeFeed(found, { feedId: feed.id, title: feed.title });
      setFeedHealth(feed, "ok");
      saveFeedState();
      setFeedStatus(`Updated ${feed.title} to a working address.`);
      renderFeeds();
      return true;
    } catch {
      // Keep probing candidates.
    }
  }
  setFeedHealth(feed, "dead");
  saveFeedState();
  setFeedStatus(`Could not resolve ${feed.title}. It looks dead — remove it from your list.`);
  renderFeeds();
  return false;
}

async function resolveBrokenFeeds() {
  const queue = brokenFeeds();
  for (const feed of queue) {
    await resolveFeed(feed.id);
  }
}

function assignFolderNames(record, names) {
  record.folderIds = Array.isArray(record.folderIds) ? record.folderIds : [];
  names.filter(Boolean).forEach((name) => {
    const folder = ensureFolder(name);
    if (!record.folderIds.includes(folder.id)) record.folderIds.push(folder.id);
  });
}

function storeFeed(feed, options = {}) {
  const key = canonicalFeedUrl(feed.url);
  if (key && feedState.removedUrls) {
    feedState.removedUrls.delete(key);
  }
  let record = options.feedId ? feedState.feeds.find((item) => item.id === options.feedId) : null;
  if (!record) record = feedState.feeds.find((item) => canonicalFeedUrl(item.url) === key);
  if (record && feed.url) record.url = feed.url;
  const topicNames = (Array.isArray(options.topics) ? options.topics : []).map((topic) => TOPIC_LABELS[topic] || topic);
  if (!record) {
    record = {
      id: crypto.randomUUID(),
      url: feed.url,
      title: options.title || feed.title || feedHost(feed.url) || "Untitled feed",
      siteUrl: feed.siteUrl || "",
      topics: Array.isArray(options.topics) ? options.topics : [],
      folderIds: [],
      addedAt: new Date().toISOString(),
    };
    assignFolderNames(record, [...topicNames, ...(options.folderNames || [])]);
    (options.folderIds || []).forEach((id) => {
      if (!record.folderIds.includes(id)) record.folderIds.push(id);
    });
    feedState.feeds.unshift(record);
  } else {
    if (options.title) record.title = options.title;
    else if (!record.title) record.title = feed.title || "Untitled feed";
    record.siteUrl = feed.siteUrl || record.siteUrl;
    if (!Array.isArray(record.folderIds)) record.folderIds = [];
    assignFolderNames(record, [...topicNames, ...(options.folderNames || [])]);
    (options.folderIds || []).forEach((id) => {
      if (!record.folderIds.includes(id)) record.folderIds.push(id);
    });
  }
  const seenIncoming = new Set();
  const incoming = (feed.items || []).slice(0, FEED_ITEM_CAP).map((item) => ({
    id: `${record.id}:${item.id || item.link || item.title}`,
    feedId: record.id,
    title: item.title || "Untitled",
    link: item.link || "",
    summary: item.summary || "",
    publishedAt: item.publishedAt || "",
    author: item.author || "",
    image: cleanImageUrl(item.image),
    videoUrl: item.videoUrl || "",
  })).filter((item) => {
    const itemKey = canonicalItemKey(item);
    if (seenIncoming.has(itemKey)) return false;
    seenIncoming.add(itemKey);
    return true;
  });
  const kept = new Map(incoming.map((item) => [item.id, item]));
  feedState.items
    .filter((item) => item.feedId === record.id && !kept.has(item.id))
    .slice(0, FEED_ITEM_CAP)
    .forEach((item) => kept.set(item.id, item));
  const merged = [...kept.values()].sort((a, b) => feedTime(b) - feedTime(a)).slice(0, FEED_ITEM_CAP);
  feedState.items = feedState.items.filter((item) => item.feedId !== record.id).concat(merged);
  if ((feed.items || []).length) setFeedHealth(record, "ok");
  saveFeedState();
  return record;
}

function applyPane() {
  const track = document.querySelector("#feedsTrack");
  if (track) {
    track.dataset.pane = String(feedPane);
    track.classList.toggle("is-reading", Boolean(selectedItemId));
  }
  const back = document.querySelector("#feedsBack");
  if (back) back.hidden = (!isPhoneFeeds() || feedPane === 0) && !previousSource;
  const title = document.querySelector("#feedsTitle");
  const subtitle = document.querySelector("#feedsSubtitle");
  const kicker = document.querySelector("#feedsKicker");
  const article = itemById(selectedItemId);
  const onArticle = isPhoneFeeds() && feedPane === 1;

  if (kicker) {
    if (onArticle) {
      kicker.textContent = "Article";
    } else if (previousSource) {
      kicker.innerHTML = `<button class="feeds-back-kicker" type="button" data-action="back-source">← Back to ${escapeFeedText(sourceTitle(previousSource))}</button>`;
    } else {
      kicker.textContent = "Feeds";
    }
  }

  if (title) {
    if (onArticle && article) {
      const feed = feedRecord(article.feedId);
      const feedTitleText = feed?.title || "Article";
      if (feed) {
        title.innerHTML = `<button class="feeds-title-link" type="button" data-open-feed="${escapeFeedText(feed.id)}" title="View ${escapeFeedText(feedTitleText)} feed">${escapeFeedText(feedTitleText)} <span class="feeds-title-arrow">→</span></button>`;
      } else {
        title.textContent = feedTitleText;
      }
    } else {
      title.textContent = sourceTitle();
    }
  }

  if (subtitle) {
    if (onArticle) {
      subtitle.textContent = article?.author || "";
    } else {
      const count = itemsForSource().length;
      subtitle.textContent = selectedSource === "archive" ? `${countLabel(count)} archived` : `${countLabel(count)} unread`;
    }
  }
}

function getUnreadCountsMap() {
  const counts = new Map();
  const unread = uniqueStories(unreadItems());
  for (let i = 0; i < unread.length; i++) {
    const feedId = unread[i].feedId;
    counts.set(feedId, (counts.get(feedId) || 0) + 1);
  }
  return counts;
}

function feedSourceRow(feed, options = {}) {
  const unread = options.unreadCount !== undefined ? options.unreadCount : itemsForSource(`feed:${feed.id}`).length;
  const checked = selectedFeedIds.has(feed.id);
  const folders = (feed.folderIds || []).map((id) => feedState.folders.find((folder) => folder.id === id)?.name).filter(Boolean);
  const folderNote = options.showFolder && folders.length ? `<small>${escapeFeedText(folders.join(", "))}</small>` : "";
  const id = escapeFeedText(feed.id);
  const title = escapeFeedText(feed.title);
  const selectionLabel = checked
    ? `Deselect ${title}`
    : `Select ${title}`;
  const selectionMark = checked ? `<path d="m7.3 12.2 3.1 3.1 6.4-7"/>` : "";
  const health = feed.status === "dead"
    ? `<span class="feeds-feed-badge is-dead">Dead</span>`
    : feed.status === "broken"
      ? `<button class="feeds-feed-resolve" type="button" data-resolve-feed="${id}">Resolve</button>`
      : "";
  const remove = options.showDelete
    ? `<button class="feeds-folder-action feeds-folder-remove" type="button" data-delete-feed="${id}" aria-label="Delete ${title} feed" title="Delete feed">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V4.8h6V7"/><path d="m7.2 7 .7 12h8.2l.7-12"/><path d="M10 10.5v5M14 10.5v5"/></svg>
      </button>`
    : "";
  return `<li class="feeds-folder feeds-feed-row${feed.status ? ` is-${escapeFeedText(feed.status)}` : ""}">
    <span class="feeds-folder-toggle-space" aria-hidden="true"></span>
    <button class="feeds-folder-select" type="button" data-select-feed="${id}" data-selection-state="${checked ? "all" : "none"}" aria-pressed="${checked ? "false" : "false"}" aria-label="${escapeFeedText(selectionLabel)}" title="${escapeFeedText(selectionLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/>${selectionMark}</svg>
    </button>
    <div class="feeds-folder-name">
      <button class="feeds-folder-name-button" type="button" data-source="feed:${id}" aria-pressed="${selectedSource === `feed:${feed.id}` ? "true" : "false"}">
        <span>${title}${folderNote}</span><em>${unread ? countLabel(unread) : ""}</em>
      </button>
    </div>
    <div class="feeds-feed-health">${health}</div>
    ${remove}
  </li>`;
}

function newFolderForm() {
  return `<form class="feeds-new-folder" data-new-folder-form>
    <input id="newFolderInput" type="text" maxlength="80" placeholder="Folder name" value="${escapeFeedText(folderDraftName)}" required />
    <button class="primary-button" type="submit">${folderDraftMoves ? "Move" : "Add"}</button>
  </form>`;
}

function renderSources() {
  const root = document.querySelector("#feedsSources");
  if (!root) return;
  const unreadCounts = getUnreadCountsMap();
  let allCount = 0;
  unreadCounts.forEach((c) => { allCount += c; });
  const folders = feedState.folders.map((folder) => {
    const folderFeeds = feedState.feeds.filter((feed) => (feed.folderIds || []).includes(folder.id));
    let count = 0;
    folderFeeds.forEach((feed) => { count += (unreadCounts.get(feed.id) || 0); });
    const open = folderIsOpen(folder);
    const selected = selectedFolderIds.has(folder.id);
    const hasFeeds = folderFeeds.length > 0;
    const id = escapeFeedText(folder.id);
    const name = escapeFeedText(folder.name);
    const editing = editingFolderId === folder.id;
    const selectionLabel = selected
      ? `Remove ${folder.name} from the main feed view`
      : `Include ${folder.name} in the main feed view`;
    const selectionMark = selected ? `<path d="m7.3 12.2 3.1 3.1 6.4-7"/>` : "";
    const folderName = editing
      ? `<form class="feeds-folder-rename" data-rename-folder-form="${id}">
          <input type="text" maxlength="80" value="${name}" aria-label="Rename ${name}" autocomplete="off" />
        </form>`
      : `<button class="feeds-folder-name-button" type="button" data-rename-folder="${id}" aria-label="Rename ${name}" title="Select to rename">
          <span>${name}</span><em>${count ? countLabel(count) : ""}</em>
        </button>`;
    const nested = folderFeeds
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .map((feed) => {
        const unread = unreadCounts.get(feed.id) || 0;
        const feedId = escapeFeedText(feed.id);
        return `<li><button type="button" data-source="feed:${feedId}" aria-pressed="${selectedSource === `feed:${feed.id}` ? "true" : "false"}"><span>${escapeFeedText(feed.title)}</span><em>${unread ? countLabel(unread) : ""}</em></button></li>`;
      })
      .join("") || `<li class="feeds-feed-empty">No feeds in this folder.</li>`;
    return `<li class="feeds-folder${open ? "" : " is-collapsed"}${selected ? " is-filtered" : ""}">
      <button class="feeds-folder-toggle" type="button" data-folder-toggle="${id}" aria-expanded="${open ? "true" : "false"}" aria-label="${open ? "Collapse" : "Open"} ${name}">
        <svg class="feeds-folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="feeds-folder-select" type="button" data-select-folder="${id}" data-selection-state="${selected ? "all" : "none"}" aria-pressed="${selected ? "true" : "false"}" aria-label="${escapeFeedText(selectionLabel)}" title="${escapeFeedText(selectionLabel)}" ${hasFeeds ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/>${selectionMark}</svg>
      </button>
      <div class="feeds-folder-name">${folderName}</div>
      <button class="feeds-folder-action feeds-folder-show" type="button" data-show-folder="${id}" aria-label="Show ${name} and its feeds" title="Show folder and feeds">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2-2h3.2c1.1 0 2 .9 2 2v1"/><path d="M4.8 18.5h12.9a2 2 0 0 0 1.9-1.5l1.2-5.2a1.5 1.5 0 0 0-1.5-1.8H5.2a1.8 1.8 0 0 0-1.8 2.2l1.4 6.3Z"/></svg>
      </button>
      <button class="feeds-folder-action feeds-folder-remove" type="button" data-remove-folder="${id}" aria-label="Remove ${name} folder" title="Remove folder">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V4.8h6V7"/><path d="m7.2 7 .7 12h8.2l.7-12"/><path d="M10 10.5v5M14 10.5v5"/></svg>
      </button>
      ${open ? `<ul>${nested}</ul>` : ""}
    </li>`;
  }).join("");
  const allFeeds = [...feedState.feeds].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const folderOptions = feedState.folders.map((folder) => `<option value="${escapeFeedText(folder.name)}">${escapeFeedText(folder.name)}</option>`).join("");
  const folderNames = selectedFolderNames();
  const isFoldersActive = selectedSource === "folders";
  const isShowActive = isFoldersActive && folderFilterMode === "show";
  const isHideActive = isFoldersActive && folderFilterMode === "hide";
  const folderViewTools = folderNames.length
    ? `<div class="feeds-folder-view" aria-live="polite">
        <p><strong>${folderNames.length === 1 ? "1 folder" : `${folderNames.length} folders`}</strong> selected for the main feed</p>
        <div>
          <button class="${isShowActive ? "primary-button" : "secondary-button"}" type="button" data-show-selected-folders>Show</button>
          <button class="${isHideActive ? "primary-button" : "secondary-button"}" type="button" data-hide-selected-folders>Hide</button>
          <button class="ghost-button" type="button" data-clear-folder-filter>Clear</button>
        </div>
      </div>`
    : "";
  const selectionTools = selectedFeedIds.size
    ? `<div class="feeds-selection" aria-live="polite">
        <p>${selectedFeedIds.size === 1 ? "1 feed selected" : `${selectedFeedIds.size} feeds selected`}</p>
        <div class="feeds-selection-actions">
          <select data-move-feeds aria-label="Move selected feeds to a folder">
            <option value="">Move to folder</option>
            ${folderOptions}
            <option value="__new">New folder…</option>
          </select>
          <button class="ghost-button" type="button" data-delete-feeds>Delete</button>
        </div>
        ${folderDraft && folderDraftMoves ? newFolderForm() : ""}
      </div>`
    : "";
  root.innerHTML = `<ul class="feeds-source-list">
    <li><button type="button" data-source="all" aria-pressed="${selectedSource === "all" ? "true" : "false"}"><span>All items</span><em>${countLabel(allCount)}</em></button></li>
    <li><button type="button" data-source="archive" aria-pressed="${selectedSource === "archive" ? "true" : "false"}"><span>Archive</span><em></em></button></li>
  </ul>
  <div class="feeds-folder-heading">
    <button type="button" class="feeds-section-toggle${foldersSectionCollapsed ? " is-collapsed" : ""}" data-toggle-section="folders" aria-expanded="${!foldersSectionCollapsed}">
      <svg class="feeds-folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Folders</span>
      <em class="feeds-section-count">(${feedState.folders.length})</em>
    </button>
    <button type="button" data-start-folder>New folder</button>
  </div>
  ${foldersSectionCollapsed ? "" : `
    ${folderDraft && !folderDraftMoves ? newFolderForm() : ""}
    ${folderViewTools}
    ${selectionTools}
    <ul class="feeds-source-list">${folders}</ul>
  `}
  <div class="feeds-folder-heading">
    <button type="button" class="feeds-section-toggle${allFeedsSectionCollapsed ? " is-collapsed" : ""}" data-toggle-section="allFeeds" aria-expanded="${!allFeedsSectionCollapsed}">
      <svg class="feeds-folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>All feeds</span>
      <em class="feeds-section-count">(${feedState.feeds.length})</em>
    </button>
  </div>
  ${allFeedsSectionCollapsed ? "" : `
    <ul class="feeds-source-list">${allFeeds.map((feed) => feedSourceRow(feed, { showDelete: true, showFolder: true, unreadCount: unreadCounts.get(feed.id) || 0 })).join("") || `<li class="feeds-feed-empty">Feeds you follow show up here.</li>`}</ul>
  `}`;
  if (folderDraftFocus) {
    folderDraftFocus = false;
    document.querySelector("#newFolderInput")?.focus();
  }
  if (folderRenameFocus) {
    folderRenameFocus = false;
    const input = root.querySelector("[data-rename-folder-form] input");
    input?.focus();
    input?.select();
  }
}

function renderFolderPicker() {
  const names = feedState.folders.map((folder) => folder.name);
  [
    ["#followFeedFolder", "#followFeedFolderName"],
    ["#discoverFolder", "#discoverFolderName"],
  ].forEach(([selectId, nameId]) => {
    const select = document.querySelector(selectId);
    if (!select) return;
    const current = select.value;
    select.innerHTML = [`<option value="">No folder</option>`, ...names.map((name) => `<option value="${escapeFeedText(name)}">${escapeFeedText(name)}</option>`), `<option value="__new">New folder…</option>`].join("");
    select.value = ["", "__new", ...names].includes(current) ? current : "";
    const nameInput = document.querySelector(nameId);
    if (nameInput) nameInput.hidden = select.value !== "__new";
  });
}

function chosenFolderNames() {
  const select = document.querySelector("#followFeedFolder");
  if (!select || !select.value) return [];
  if (select.value === "__new") {
    const name = document.querySelector("#followFeedFolderName")?.value.trim();
    return name ? [name] : [];
  }
  return [select.value];
}

function revealFolders(record) {
  (record?.folderIds || []).forEach((id) => {
    const folder = feedState.folders.find((item) => item.id === id);
    if (folder) setFolderOpen(folder, true);
  });
}

function moveSelectedFeeds(name) {
  const folder = ensureFolder(name);
  setFolderOpen(folder, true);
  feedState.feeds.forEach((feed) => {
    if (!selectedFeedIds.has(feed.id)) return;
    feed.folderIds = Array.isArray(feed.folderIds) ? feed.folderIds : [];
    if (!feed.folderIds.includes(folder.id)) feed.folderIds.push(folder.id);
  });
  selectedFeedIds = new Set();
  folderDraft = false;
  folderDraftMoves = false;
  folderDraftName = "";
  saveFeedState();
  renderFeeds();
}

function deleteSelectedFeeds() {
  if (!selectedFeedIds.size) return;
  const itemIds = feedState.items.filter((item) => selectedFeedIds.has(item.feedId)).map((item) => item.id);
  if (!feedState.removedUrls) feedState.removedUrls = new Set();
  feedState.feeds.forEach((feed) => {
    if (selectedFeedIds.has(feed.id)) {
      if (feed.url) feedState.removedUrls.add(canonicalFeedUrl(feed.url));
      if (feed.siteUrl) feedState.removedUrls.add(canonicalFeedUrl(feed.siteUrl));
    }
  });
  feedState.feeds = feedState.feeds.filter((feed) => !selectedFeedIds.has(feed.id));
  feedState.items = feedState.items.filter((item) => !selectedFeedIds.has(item.feedId));
  itemIds.forEach((id) => {
    delete feedState.read[id];
    delete feedState.archived[id];
    delete feedState.starred[id];
  });
  if (selectedSource.startsWith("feed:") && selectedFeedIds.has(selectedSource.slice(5))) {
    selectedSource = "all";
    selectedItemId = "";
    feedPane = 0;
  }
  selectedFeedIds = new Set();
  saveFeedState();
  void pushFeedLibrary();
  paintFeedHealth("");
  renderFeeds();
}

function removeFolder(id) {
  const folder = feedState.folders.find((item) => item.id === id);
  if (!folder) return;
  const feedCount = feedState.feeds.filter((feed) => (feed.folderIds || []).includes(id)).length;
  const feedLabel = feedCount === 1 ? "1 feed" : `${feedCount} feeds`;
  if (!confirm(`Remove the “${folder.name}” folder? ${feedLabel} will stay available under All feeds.`)) return;
  feedState.folders = feedState.folders.filter((folder) => folder.id !== id);
  feedState.feeds.forEach((feed) => {
    feed.folderIds = (feed.folderIds || []).filter((folderId) => folderId !== id);
  });
  selectedFolderIds.delete(id);
  if (selectedSource === "folders" && !selectedFolderIds.size) selectedSource = "all";
  if (selectedSource === `folder:${id}`) selectedSource = "all";
  if (editingFolderId === id) editingFolderId = "";
  saveFeedState();
  setFeedStatus(`Removed the “${folder.name}” folder. Its feeds are still available.`);
  renderFeeds();
}

function pickerAccountKnown() {
  const value = document.body.dataset.pickerSignedIn;
  return value === "true" || value === "false";
}

function pickerIsSignedIn() {
  return document.body.dataset.pickerSignedIn === "true";
}

function whenAccountKnown(action) {
  if (pickerAccountKnown()) {
    action();
    return;
  }
  document.addEventListener("picker-account", () => action(), { once: true });
}

function feedsSignInNote() {
  if (!pickerAccountKnown() || pickerIsSignedIn()) return "";
  return `<p class="feeds-signin-note">Sign in or create an account to add feeds. <button type="button" data-feeds-signin>Sign in or create an account</button></p>`;
}

function feedsDiscoverInvite() {
  if (!pickerIsSignedIn()) return "";
  if (feedState.dismissedDiscoverInvite) return "";
  const fewFeeds = feedState.feeds.length < 12;
  const allWithUnread = selectedSource === "all" && unreadItems().length > 0;
  if (!fewFeeds && !allWithUnread) return "";
  return `<aside class="feeds-discover-invite">
    <button class="feeds-discover-dismiss" type="button" data-dismiss-discover-invite aria-label="Close" title="Close"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="5" x2="5" y2="19"></line><line x1="5" y1="5" x2="19" y2="19"></line></svg></button>
    <div>
      <strong>Want more interesting feeds?</strong>
      <p>Browse popular topics and add them to a folder in one go.</p>
    </div>
    <button class="ghost-button" type="button" data-feeds-discover>Browse feeds</button>
  </aside>`;
}

function feedsWelcome() {
  const marks = `<img class="feeds-welcome-mark feeds-welcome-mark--dark" src="/brand/logos/picker-mark-dark.svg" alt="Picker" />
          <img class="feeds-welcome-mark feeds-welcome-mark--light" src="/brand/logos/picker-mark-light.svg" alt="" />`;
  if (!pickerAccountKnown()) {
    return `<div class="feeds-welcome">${marks}</div>`;
  }
  if (!pickerIsSignedIn()) {
    return `<div class="feeds-welcome">
          ${marks}
          <p>Sign in or create an account to see your feeds and start following sites.</p>
          <button class="primary-button" type="button" data-feeds-signin>Sign in or create an account</button>
        </div>`;
  }
  return `<div class="feeds-welcome">
          ${marks}
          <p>Want to follow interesting sites? Browse popular feeds by topic, or import the Feedly list you downloaded.</p>
          <button class="primary-button" type="button" data-feeds-discover>Browse popular feeds</button>
        </div>`;
}

function bindRiverLoadMore(totalItems) {
  if (riverObserver) {
    riverObserver.disconnect();
    riverObserver = null;
  }
  const sentinel = document.querySelector("#riverLoadMore");
  if (!sentinel) return;

  const loadNextBatch = () => {
    if (riverRenderLimit < totalItems) {
      riverRenderLimit += 40;
      renderList();
    }
  };

  if ("IntersectionObserver" in window) {
    const root = document.querySelector("#feedRiver")?.closest(".feeds-pane") || null;
    riverObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadNextBatch();
      }
    }, { root, rootMargin: "400px" });
    riverObserver.observe(sentinel);
  }

  sentinel.querySelector("[data-load-more-river-btn]")?.addEventListener("click", (event) => {
    event.preventDefault();
    loadNextBatch();
  });
}

function renderList() {
  const river = document.querySelector("#feedRiver");
  if (!river) return;
  const sortButtons = document.querySelectorAll("#feedsSort [data-feed-sort]");
  sortButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.feedSort === feedSort ? "true" : "false");
  });

  const currentKey = `${selectedSource}|${Array.from(selectedFolderIds).sort().join(",")}|${folderFilterMode}|${feedSort}`;
  if (currentKey !== lastRenderedSourceKey) {
    lastRenderedSourceKey = currentKey;
    riverRenderLimit = 40;
  }

  const unreadWeights = new Map();
  unreadItems().forEach((item) => {
    unreadWeights.set(item.feedId, (unreadWeights.get(item.feedId) || 0) + 1);
  });
  const items = itemsForSource().sort((a, b) => {
    if (feedSort === "active") {
      const weight = (unreadWeights.get(b.feedId) || 0) - (unreadWeights.get(a.feedId) || 0);
      if (weight) return weight;
    }
    return feedTime(b) - feedTime(a);
  });
  const filterBanner = folderFilterBanner();
  if (!items.length) {
    if (riverObserver) {
      riverObserver.disconnect();
      riverObserver = null;
    }
    river.innerHTML = feedState.feeds.length
      ? `${filterBanner}${feedsDiscoverInvite()}<p class="feeds-river-empty">Nothing unread in this view.</p>${feedsSignInNote()}`
      : feedsWelcome();
    return;
  }
  const visibleItems = items.slice(0, riverRenderLimit);
  const hasMore = items.length > riverRenderLimit;
  const signedOutNote = feedsSignInNote();
  let lastDay = "";
  const rowsHtml = visibleItems.map((item) => {
    const feed = feedRecord(item.feedId);
    const day = dayKey(item.publishedAt);
    const heading = feedSort === "latest" && day !== lastDay
      ? `<h3 class="feeds-day">${escapeFeedText(dayLabel(item.publishedAt))}</h3>`
      : "";
    if (feedSort === "latest") lastDay = day;
    const when = formatClock(item.publishedAt);
    const itemImage = cleanImageUrl(item.image);
    return `${heading}<button class="feed-row${selectedItemId === item.id ? " is-selected" : ""}" type="button" data-open-story="${escapeFeedText(item.id)}">
      <span class="feed-row-copy">
        <span class="feed-row-source"><span>${escapeFeedText(feed?.title || "Feed")}</span>${when ? `<time>${escapeFeedText(when)}</time>` : ""}</span>
        <strong>${feedState.starred[item.id] ? "★ " : ""}${escapeFeedText(item.title)}</strong>
        ${item.summary ? `<span>${escapeFeedText(item.summary)}</span>` : ""}
      </span>
      ${itemImage ? `<span class="feed-row-thumb-wrap"><span class="thumb-spinner" aria-hidden="true"></span><img src="${escapeFeedText(itemImage)}" alt="" loading="lazy" onload="this.classList.add('is-loaded');this.previousElementSibling?.remove()" onerror="this.closest('.feed-row-thumb-wrap')?.remove()" /></span>` : `<span class="feed-row-thumb" aria-hidden="true"></span>`}
    </button>`;
  }).join("");

  const moreHtml = hasMore
    ? `<div class="feeds-river-more" id="riverLoadMore">
        <span class="thumb-spinner" aria-hidden="true"></span>
        <span>Showing <strong>${visibleItems.length}</strong> of <strong>${countLabel(items.length)}</strong> stories</span>
        <button class="ghost-button" type="button" data-load-more-river-btn>Load more</button>
      </div>`
    : "";

  river.innerHTML = filterBanner + feedsDiscoverInvite() + signedOutNote + rowsHtml + moreHtml;
  bindRiverLoadMore(items.length);
}

function renderReader() {
  const reader = document.querySelector("#feedReader");
  if (!reader) return;
  const item = itemById(selectedItemId);
  if (!item) {
    reader.innerHTML = `<p class="feeds-river-empty">Select a story to read it.</p>`;
    return;
  }
  const feed = feedRecord(item.feedId);
  const when = item.publishedAt ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.publishedAt)) : "";
  const targetUrl = item.link || item.videoUrl || "";
  const sourceHtml = feed
    ? `<button class="feed-article-source-btn" type="button" data-open-feed="${escapeFeedText(feed.id)}" title="View ${escapeFeedText(feed.title)} feed">${escapeFeedText(feed.title)} →</button>`
    : (feed?.title ? `<p class="feed-article-source">${escapeFeedText(feed.title)}</p>` : "");

  const readerImage = cleanImageUrl(item.image);
  reader.innerHTML = `<article class="feed-article" data-article-link="${escapeFeedText(targetUrl)}">
    ${when ? `<p class="feed-article-date">${escapeFeedText(when)}</p>` : ""}
    <h3>${escapeFeedText(item.title)}</h3>
    ${item.author ? `<p class="feed-article-by">${escapeFeedText(item.author)}</p>` : ""}
    ${sourceHtml}
    ${readerImage ? `<div class="feed-article-thumb-wrap"><span class="thumb-spinner" aria-hidden="true"></span><img src="${escapeFeedText(readerImage)}" alt="" loading="lazy" onload="this.classList.add('is-loaded');this.previousElementSibling?.remove()" onerror="this.closest('.feed-article-thumb-wrap')?.remove()" /></div>` : ""}
    ${targetUrl ? `<a class="feed-article-link" href="${escapeFeedText(targetUrl)}" target="_blank" rel="noreferrer">${escapeFeedText(feedHost(targetUrl) || "Open")} →</a>` : ""}
    ${item.summary ? `<p class="feed-article-body">${escapeFeedText(item.summary)}</p>` : ""}
    <div class="feed-article-actions">
      <button class="ghost-button" type="button" data-star-item="${escapeFeedText(item.id)}">${feedState.starred[item.id] ? "Starred" : "Star"}</button>
      <button class="ghost-button" type="button" data-archive-item="${escapeFeedText(item.id)}">${feedState.archived[item.id] ? "Archived" : "Archive"}</button>
      ${item.videoUrl ? `<button class="ghost-button" type="button" data-save-video="${escapeFeedText(item.id)}">Save</button>` : ""}
    </div>
  </article>`;
}

function topicLabel(id) {
  if (id === "popular") return "Popular";
  return catalogTopics.find((topic) => topic.id === id)?.label || TOPIC_LABELS[id] || id;
}

function discoverFolderNames() {
  const select = document.querySelector("#discoverFolder");
  if (!select || !select.value) return [];
  if (select.value === "__new") {
    const name = document.querySelector("#discoverFolderName")?.value.trim();
    return name ? [name] : [];
  }
  return [select.value];
}

function paintDiscoverSteps() {
  const steps = document.querySelector("#feedsDiscoverSteps");
  if (!steps) return;
  const hasTopic = Boolean(selectedTopic || catalogQuery.trim());
  const hasPicks = catalogPicks.size > 0;
  let current = "topic";
  if (hasTopic && hasPicks) current = "folder";
  else if (hasTopic) current = "feeds";
  steps.querySelectorAll("[data-discover-step]").forEach((item) => {
    const step = item.dataset.discoverStep;
    const done = (step === "topic" && hasTopic)
      || (step === "feeds" && hasPicks);
    item.classList.toggle("is-done", done && step !== current);
    item.classList.toggle("is-current", step === current);
    if (step === current) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}

function paintDiscoverBar() {
  const bar = document.querySelector("#feedsDiscoverBar");
  const count = document.querySelector("#feedsDiscoverCount");
  const add = document.querySelector("#discoverAdd");
  const clear = document.querySelector("#discoverClear");
  const tools = document.querySelector("#feedsDirectoryTools");
  const pack = document.querySelector("#discoverTopicPack");
  if (bar && count && add) {
    const { size } = catalogPicks;
    bar.hidden = size === 0;
    bar.classList.toggle("is-sticky", size > 0);
    if (clear) clear.hidden = size === 0;
    const folderNames = discoverFolderNames();
    const folderLabel = folderNames.length ? ` to "${folderNames[0]}"` : "";
    count.textContent = size === 1 ? `1 feed selected — tap "Add 1 feed" to finish` : `${size} feeds selected — tap "Add ${size} feeds" to finish`;
    add.disabled = size === 0;
    add.textContent = size === 1 ? `Add 1 feed${folderLabel}` : `Add ${size} feeds${folderLabel}`;
  }
  if (tools && pack) {
    const available = directoryFeeds.filter((feed) => !feedState.feeds.some((item) => canonicalFeedUrl(item.url) === canonicalFeedUrl(feed.url)));
    const showPack = Boolean(selectedTopic) && available.length > 0;
    tools.hidden = !showPack;
    const label = topicLabel(selectedTopic);
    pack.textContent = selectedTopic === "popular"
      ? `Select popular pack (${available.length})`
      : `Select ${label} pack (${available.length})`;
  }
  paintDiscoverSteps();
}

function selectTopicPack() {
  const available = directoryFeeds.filter((feed) => !feedState.feeds.some((item) => canonicalFeedUrl(item.url) === canonicalFeedUrl(feed.url)));
  if (!available.length) {
    setFeedStatus("You already follow the feeds in this topic.");
    return;
  }
  catalogPicks.clear();
  available.forEach((feed) => {
    catalogPicks.set(canonicalFeedUrl(feed.url), {
      url: feed.url,
      title: feed.title || "",
      topics: Array.isArray(feed.topics) ? feed.topics : [],
    });
  });
  const select = document.querySelector("#discoverFolder");
  const nameInput = document.querySelector("#discoverFolderName");
  const folderName = selectedTopic === "popular" ? "Popular" : topicLabel(selectedTopic);
  if (select) {
    const existing = feedState.folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase());
    if (existing) {
      select.value = existing.name;
      if (nameInput) nameInput.hidden = true;
    } else {
      select.value = "__new";
      if (nameInput) {
        nameInput.hidden = false;
        nameInput.value = folderName;
      }
    }
  }
  renderDirectory();
  setFeedStatus(`Selected ${available.length} ${folderName.toLowerCase()} feeds. Confirm the folder, then add them.`);
  document.querySelector("#feedsDiscoverBar")?.scrollIntoView({ block: "nearest" });
}

function renderDirectory() {
  const box = document.querySelector("#feedDirectory");
  const topics = document.querySelector("#feedTopics");
  if (topics) {
    topics.querySelectorAll("[data-feed-topic]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.feedTopic === selectedTopic ? "true" : "false");
    });
  }
  if (!box) return;
  const active = Boolean(selectedTopic || catalogQuery.trim());
  if (!active) {
    box.innerHTML = `<p class="feeds-directory-empty">Choose a topic to see popular feeds.</p>`;
    paintDiscoverBar();
    return;
  }
  if (!directoryFeeds.length) {
    box.innerHTML = `<p class="feeds-directory-empty">No feeds match that search.</p>`;
    paintDiscoverBar();
    return;
  }
  box.innerHTML = directoryFeeds.map((feed, index) => {
    const key = canonicalFeedUrl(feed.url);
    const following = feedState.feeds.some((item) => canonicalFeedUrl(item.url) === key);
    const picked = catalogPicks.has(key);
    const inputId = `catalog-pick-${index}`;
    return `<article class="feed-directory-card${picked ? " is-picked" : ""}${following ? " is-following" : ""}">
      <div class="feed-directory-pick">
        <input type="checkbox" id="${inputId}" data-catalog-pick="${escapeFeedText(feed.url)}" data-catalog-title="${escapeFeedText(feed.title)}" data-catalog-topics="${escapeFeedText((feed.topics || []).join(","))}" ${picked ? "checked" : ""} ${following ? "disabled" : ""} />
        <label class="feed-directory-copy" for="${inputId}">
          <p class="feed-directory-tag">${escapeFeedText((feed.topics || []).map(topicLabel).join(" · "))}</p>
          <h3 class="feed-directory-title">${escapeFeedText(feed.title)}</h3>
          <p class="feed-directory-blurb">${escapeFeedText(feed.blurb)}</p>
        </label>
      </div>
      <button class="ghost-button" type="button" data-catalog-url="${escapeFeedText(feed.url)}" data-catalog-title="${escapeFeedText(feed.title)}" data-catalog-topics="${escapeFeedText((feed.topics || []).join(","))}" ${following ? "disabled" : ""}>${following ? "Following" : "Follow"}</button>
    </article>`;
  }).join("");
  paintDiscoverBar();
}

function renderFeedChoices() {
  const box = document.querySelector("#feedChoices");
  if (!box) return;
  if (!feedChoices.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<p>This page publishes more than one feed. Choose one to follow.</p><div class="feed-choices">${feedChoices
    .map((feed, index) => `<button type="button" data-feed-choice="${index}">${escapeFeedText(feed.title || feedHost(feed.url) || feed.url)}</button>`)
    .join("")}</div>`;
}

function renderFeeds() {
  document.querySelector("#feedsPanel")?.classList.toggle("is-empty", feedState.feeds.length === 0);
  renderSources();
  renderList();
  renderReader();
  renderDirectory();
  renderFeedChoices();
  renderFolderPicker();
  applyPane();
  if (brokenFeeds().length || deadFeeds().length) paintFeedHealth();
}

async function loadDirectory() {
  const requestId = ++directoryRequest;
  const params = new URLSearchParams();
  if (selectedTopic) params.set("topic", selectedTopic);
  if (catalogQuery.trim()) params.set("q", catalogQuery.trim());
  if (!selectedTopic && !catalogQuery.trim()) {
    directoryFeeds = [];
    renderDirectory();
    return;
  }
  try {
    const response = await fetch(`/api/rss/catalog?${params}`);
    const data = await response.json().catch(() => ({}));
    if (requestId !== directoryRequest) return;
    if (!response.ok) throw new Error(data.error || "The feed list could not be loaded.");
    catalogTopics = Array.isArray(data.topics) ? data.topics : catalogTopics;
    directoryFeeds = Array.isArray(data.feeds) ? data.feeds : [];
  } catch (error) {
    if (requestId !== directoryRequest) return;
    directoryFeeds = [];
    setFeedStatus(error.message || "The feed list could not be loaded.");
  }
  renderDirectory();
}

function setFeedsDialogMode(mode) {
  const dialog = document.querySelector("#feedsAddDialog");
  const title = document.querySelector("#feedsDialogTitle");
  const setup = document.querySelector("#feedsSetupBlock");
  const resolved = mode === "setup" ? "setup" : "discover";
  if (dialog) dialog.dataset.mode = resolved;
  if (title) title.textContent = resolved === "setup" ? "Setup feeds" : "Find interesting feeds";
  if (setup) setup.open = resolved === "setup";
  paintDiscoverSteps();
}

function openFeedsDiscover() {
  whenAccountKnown(() => {
    if (!pickerIsSignedIn()) {
      document.querySelector("#accountDialog")?.showModal();
      return;
    }
    if (!selectedTopic && !catalogQuery.trim()) selectedTopic = "popular";
    const query = document.querySelector("#feedTopicQuery");
    if (query && !catalogQuery) query.value = "";
    setFeedsDialogMode("discover");
    document.querySelector("#feedsAddDialog")?.showModal();
    document.querySelector("#feedsDiscover")?.scrollIntoView({ block: "nearest" });
    void loadDirectory();
  });
}

function openFeedsSetup() {
  whenAccountKnown(() => {
    if (!pickerIsSignedIn()) {
      document.querySelector("#accountDialog")?.showModal();
      return;
    }
    setFeedsDialogMode("setup");
    document.querySelector("#feedsAddDialog")?.showModal();
    document.querySelector("#feedsSetupBlock")?.scrollIntoView({ block: "nearest" });
  });
}

async function followUrl(value, options = {}) {
  const url = normalizeFeedInput(value);
  if (!url) return null;
  if (!options.quiet) setFeedStatus("Looking for a feed…");
  try {
    const result = await requestFeed(url);
    if (result.kind === "choices") {
      feedChoices = result.feeds || [];
      setFeedStatus("Choose which feed to follow.");
      renderFeeds();
      return null;
    }
    feedChoices = [];
    const folderNames = [...(options.folderNames || [])];
    if (!options.skipFormFolder) folderNames.push(...chosenFolderNames());
    const record = storeFeed(result.feed, { ...options, folderNames });
    revealFolders(record);
    saveFeedState();
    if (!options.quiet) {
      selectedSource = `feed:${record.id}`;
      selectedItemId = "";
      const input = document.querySelector("#followFeedInput");
      if (input) input.value = "";
      setFeedStatus(`Following ${record.title}.`);
      feedPane = 0;
      renderFeeds();
      if (!options.keepOpen) document.querySelector("#feedsAddDialog")?.close();
    }
    return record;
  } catch (error) {
    if (!options.quiet) {
      setFeedStatus(error.message || "The feed could not be loaded.");
      renderFeeds();
    }
    throw error;
  }
}

async function followCatalogPicks() {
  const picks = [...catalogPicks.values()];
  if (!picks.length) return;
  const folderNames = discoverFolderNames();
  if (document.querySelector("#discoverFolder")?.value === "__new" && !folderNames.length) {
    setFeedStatus("Name the new folder before adding these feeds.");
    document.querySelector("#discoverFolderName")?.focus();
    return;
  }
  setFeedStatus(picks.length === 1 ? "Adding 1 feed…" : `Adding ${picks.length} feeds…`);
  let added = 0;
  const failures = [];
  for (const pick of picks) {
    try {
      await followUrl(pick.url, {
        title: pick.title,
        topics: pick.topics,
        folderNames,
        quiet: true,
        keepOpen: true,
        skipFormFolder: true,
      });
      catalogPicks.delete(canonicalFeedUrl(pick.url));
      added += 1;
    } catch (error) {
      failures.push(pick.title || error.message || "A feed");
    }
  }
  feedPane = 0;
  if (folderNames.length) {
    const folder = ensureFolder(folderNames[0]);
    setFolderOpen(folder, true);
    selectedSource = `folder:${folder.id}`;
  } else if (added === 1) {
    selectedSource = "all";
  }
  renderFeeds();
  paintDiscoverBar();
  if (failures.length && !added) {
    setFeedStatus(`Could not add: ${failures.slice(0, 3).join(", ")}`);
    return;
  }
  if (failures.length) {
    setFeedStatus(`Added ${added}. Could not add: ${failures.slice(0, 2).join(", ")}`);
  } else {
    const folderNote = folderNames.length ? ` into ${folderNames[0]}` : "";
    setFeedStatus(added === 1 ? `Added 1 feed${folderNote}.` : `Added ${added} feeds${folderNote}.`);
    document.querySelector("#feedsAddDialog")?.close();
  }
  void refreshFeeds({ force: true });
}

function paintIncomingFeeds() {
  document.querySelector("#feedsPanel")?.classList.toggle("is-empty", feedState.feeds.length === 0);
  renderSources();
  renderList();
  applyPane();
}

function refreshFeeds(options = {}) {
  if (feedRefreshTask) return feedRefreshTask;
  if (!feedState.feeds.length) return;
  if (!options.force && lastFeedRefreshAt && Date.now() - lastFeedRefreshAt < FEED_REFRESH_MS) return;
  const button = document.querySelector("#refreshFeeds");
  if (button) button.disabled = true;
  lastFeedRefreshAt = Date.now();
  feedRefreshTask = pullFeeds(options).finally(() => {
    feedRefreshTask = null;
    if (button) button.disabled = false;
  });
  return feedRefreshTask;
}

async function recoverFeed(feed) {
  const site = String(feed.siteUrl || "");
  if (!site || canonicalFeedUrl(site) === canonicalFeedUrl(feed.url)) return false;
  try {
    const found = await tryLoadFeed(site);
    if (!found || !feedLooksRelated(found, feed) || !feedIsCurrent(found)) return false;
    storeFeed(found, { feedId: feed.id, title: feed.title });
    return true;
  } catch {
    return false;
  }
}

async function pullFeeds(options = {}) {
  const force = Boolean(options.force);
  const queue = feedState.feeds.filter((feed) => force || feed.status !== "dead");
  if (!queue.length) return;
  const total = queue.length;
  let done = 0;
  const failures = [];
  setFeedStatus(total === 1 ? "Refreshing 1 feed…" : `Refreshing ${total} feeds…`);
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      try {
        const result = await requestFeed(feed.url);
        if (result.kind === "feed") {
          storeFeed(result.feed, { feedId: feed.id });
          setFeedHealth(feed, "ok");
        }
      } catch (error) {
        const recovered = await recoverFeed(feed);
        if (!recovered) {
          setFeedHealth(feed, feed.status === "dead" ? "dead" : "broken");
          failures.push(feed.title || error.message || "A feed");
        } else {
          setFeedHealth(feed, "ok");
        }
      }
      done += 1;
      if (done < total) setFeedStatus(`Refreshing feeds… ${done} of ${total}`);
    }
  });
  await Promise.all(workers);
  dedupeFeedLibrary();
  saveFeedState();
  if (failures.length) {
    setFeedStatus(`Some feeds could not refresh: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}`);
  } else if (deadFeeds().length) {
    setFeedStatus("Feeds are up to date. Remove the dead subscriptions below.");
  } else {
    setFeedStatus("Feeds are up to date.");
  }
  if (selectedItemId) paintIncomingFeeds();
  else renderFeeds();
}

function watchFeedRefresh() {
  const tick = () => {
    if (document.hidden) return;
    void refreshFeeds();
  };
  setInterval(tick, FEED_REFRESH_MS);
  document.addEventListener("visibilitychange", tick);
  tick();
}

async function importOpmlFile(file) {
  const text = await file.text();
  if (!text.trim()) throw new Error("That OPML file is empty.");
  if (text.length > 2_000_000) throw new Error("That OPML file is too large.");
  setFeedStatus("Reading the OPML file…");
  const response = await fetch("/api/rss/opml", {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8" },
    body: text,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "That OPML file could not be read.");
  const imported = [];
  (data.feeds || []).forEach((feed) => {
    const record = storeFeed({ url: feed.url, title: feed.title, siteUrl: feed.siteUrl }, {
      title: feed.title,
      folderNames: feed.folderNames || [],
    });
    imported.push(record);
  });
  selectedSource = "all";
  selectedItemId = "";
  feedPane = 0;
  saveFeedState();
  const countLabel = imported.length === 1 ? "1 feed" : `${imported.length} feeds`;
  setFeedStatus(`Added ${countLabel}. Loading stories…`);
  renderFeeds();
  document.querySelector("#feedsAddDialog")?.close();
  const queue = [...imported];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      try {
        const result = await requestFeed(feed.url);
        if (result.kind === "feed") storeFeed(result.feed, { title: feed.title, folderNames: [] });
        paintIncomingFeeds();
      } catch {
        /* Keep the subscription even if this refresh fails. */
      }
    }
  });
  await Promise.all(workers);
  dedupeFeedLibrary();
  setFeedStatus(imported.length === 1 ? "1 feed is in your folders." : `${imported.length} feeds are in your folders.`);
  renderFeeds();
}

function openStory(id) {
  const item = itemById(id);
  if (!item) return;
  selectedItemId = id;
  if (!feedState.archived[id]) feedState.read[id] = true;
  saveFeedState();
  feedPane = 1;
  renderFeeds();
}

function showPane(index) {
  feedPane = Math.max(0, Math.min(1, index));
  applyPane();
}

function saveFeedVideo(item) {
  if (!item?.videoUrl) return;
  document.dispatchEvent(new CustomEvent("picker:add-video", {
    detail: {
      title: item.title,
      url: item.videoUrl,
      sourceUrl: item.link || item.videoUrl,
      thumbnail: item.image,
      notes: item.summary,
      speaker: item.author,
    },
  }));
}

function bindSwipe() {
  const swipe = document.querySelector("#feedsSwipe");
  if (!swipe || swipe.dataset.swipe === "true") return;
  swipe.dataset.swipe = "true";
  let suppressTimer = 0;
  const suppressNextClick = () => {
    swipe.dataset.suppressClick = "true";
    window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      delete swipe.dataset.suppressClick;
    }, 400);
  };
  swipe.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("input, textarea, button, a")) return;
    const article = event.target.closest(".feed-article");
    touchStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      captured: false,
      article,
    };
  });
  swipe.addEventListener("pointermove", (event) => {
    if (!touchStart || event.pointerId !== touchStart.id) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    if (!touchStart.captured) {
      try {
        swipe.setPointerCapture(event.pointerId);
      } catch {
        // Fallback for browsers without pointer capture support
      }
      touchStart.captured = true;
    }
    if (touchStart.article) {
      touchStart.article.style.transition = "none";
      touchStart.article.style.transform = `translateX(${dx * 0.55}px)`;
    }
  });
  swipe.addEventListener("pointerup", (event) => {
    if (!touchStart || event.pointerId !== touchStart.id) return;
    const { x, y, article } = touchStart;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    touchStart = null;

    if (article) {
      article.style.transition = "transform 220ms var(--ease)";
    }

    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) {
      if (article) article.style.transform = "";
      return;
    }

    suppressNextClick();

    if (article || feedPane === 1) {
      if (dx < 0) {
        // Swiped LEFT on post -> Open original post
        const item = itemById(selectedItemId);
        const originalUrl = item?.link || item?.videoUrl || article?.dataset.articleLink;
        if (article) article.style.transform = "translateX(-100%)";
        setTimeout(() => {
          if (article) article.style.transform = "";
        }, 300);
        if (originalUrl) {
          window.location.href = originalUrl;
          return;
        }
      } else if (dx > 0) {
        // Swiped RIGHT on post -> Back to list view
        if (article) article.style.transform = "translateX(100%)";
        setTimeout(() => {
          showPane(0);
          if (article) article.style.transform = "";
        }, 200);
        return;
      }
    }

    const next = feedPane + (dx < 0 ? 1 : -1);
    if (next > 0 && !selectedItemId) return;
    showPane(next);
  });
  swipe.addEventListener("click", (event) => {
    if (swipe.dataset.suppressClick !== "true") return;
    delete swipe.dataset.suppressClick;
    window.clearTimeout(suppressTimer);
    event.preventDefault();
    event.stopPropagation();
  }, true);
  swipe.addEventListener("pointercancel", () => {
    if (touchStart?.article) touchStart.article.style.transform = "";
    touchStart = null;
  });
}

function bindFeedsDesk() {
  const panel = document.querySelector("#feedsPanel");
  if (!panel || panel.dataset.bound === "true") return;
  panel.dataset.bound = "true";
  dedupeFeedLibrary();
  normalizeFolderCollapse();
  feedState.feeds.forEach((feed) => {
    if (!Array.isArray(feed.folderIds)) feed.folderIds = [];
    (feed.topics || []).forEach((topic) => {
      const folder = ensureFolder(TOPIC_LABELS[topic] || topic);
      if (!feed.folderIds.includes(folder.id)) feed.folderIds.push(folder.id);
    });
  });
  bindSwipe();
  document.querySelector("#feedsDiscoverCta")?.addEventListener("click", () => openFeedsDiscover());
  document.querySelector("#feedsAdd")?.addEventListener("click", () => openFeedsSetup());
  document.querySelector("#feedsDiscoverMore")?.addEventListener("click", () => {
    setFeedsDialogMode("setup");
    document.querySelector("#feedsSetupBlock")?.scrollIntoView({ block: "nearest" });
  });
  const addDialog = document.querySelector("#feedsAddDialog");
  addDialog?.addEventListener("click", (event) => {
    if (!window.matchMedia("(min-width: 761px)").matches) return;
    const box = addDialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) addDialog.close();
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-feeds-discover]")) {
      openFeedsDiscover();
      return;
    }
    if (event.target.closest("[data-feeds-setup]")) {
      openFeedsSetup();
      return;
    }
    if (!event.target.closest("[data-feeds-signin]")) return;
    document.querySelector("#accountDialog")?.showModal();
  });
  document.querySelector("#discoverAdd")?.addEventListener("click", () => {
    const task = followCatalogPicks();
    window.pickerWaitUntil?.("feeds-discover", "Adding feeds", task);
    void task;
  });
  document.querySelector("#discoverClear")?.addEventListener("click", () => {
    catalogPicks.clear();
    renderDirectory();
    setFeedStatus("Selection cleared.");
  });
  document.querySelector("#discoverTopicPack")?.addEventListener("click", () => selectTopicPack());
  document.querySelector("#feedsSort")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-feed-sort]");
    if (!button) return;
    feedSort = button.dataset.feedSort === "active" ? "active" : "latest";
    renderList();
  });
  document.addEventListener("picker-account", () => {
    renderFeeds();
    void syncFeedLibrary();
  });
  whenAccountKnown(() => {
    void syncFeedLibrary();
  });
  document.addEventListener("picker-follow-feed", (event) => {
    const detail = event.detail || {};
    if (!detail.url) return;
    whenAccountKnown(() => {
      if (!pickerIsSignedIn()) {
        document.querySelector("#accountDialog")?.showModal();
        return;
      }
      const desk = document.querySelector("#desk-feeds");
      if (desk && !desk.checked) {
        desk.checked = true;
        desk.dispatchEvent(new Event("change", { bubbles: true }));
      }
      void followUrl(detail.url, { title: detail.title || "", topics: detail.topics || [] });
    });
  });
  document.querySelector("#feedsBack")?.addEventListener("click", () => {
    if (isPhoneFeeds() && feedPane === 1) {
      showPane(0);
    } else if (previousSource) {
      selectedSource = previousSource;
      previousSource = null;
      selectedItemId = "";
      feedPane = 0;
      renderFeeds();
    }
  });
  document.querySelector("#followFeedForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void followUrl(document.querySelector("#followFeedInput")?.value);
  });
  document.querySelector("#feedTopicSearch")?.addEventListener("submit", (event) => event.preventDefault());
  document.querySelector("#feedTopicQuery")?.addEventListener("input", (event) => {
    catalogQuery = event.target.value || "";
    if (catalogQuery.trim() && selectedTopic === "popular") {
      selectedTopic = "";
    } else if (!catalogQuery.trim() && !selectedTopic) {
      selectedTopic = "popular";
    }
    void loadDirectory();
  });
  document.querySelector("#opmlFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void importOpmlFile(file).catch((error) => setFeedStatus(error.message || "That OPML file could not be read."));
  });
  document.querySelector("#refreshFeeds")?.addEventListener("click", () => {
    void refreshFeeds({ force: true });
  });
  panel.addEventListener("change", (event) => {
    const picked = event.target.closest("[data-select-feed]");
    if (picked) {
      if (picked.checked) selectedFeedIds.add(picked.dataset.selectFeed);
      else selectedFeedIds.delete(picked.dataset.selectFeed);
      renderSources();
      return;
    }
    const move = event.target.closest("[data-move-feeds]");
    if (move) {
      if (move.value === "__new") {
        folderDraft = true;
        folderDraftMoves = true;
        folderDraftFocus = true;
        renderSources();
      } else if (move.value) {
        moveSelectedFeeds(move.value);
      }
      return;
    }
    if (event.target.id === "followFeedFolder" || event.target.id === "discoverFolder") {
      const nameInput = document.querySelector(event.target.id === "discoverFolder" ? "#discoverFolderName" : "#followFeedFolderName");
      if (nameInput) {
        nameInput.hidden = event.target.value !== "__new";
        if (!nameInput.hidden) nameInput.focus();
      }
      if (event.target.id === "discoverFolder") {
        paintDiscoverBar();
        paintDiscoverSteps();
      }
    }
    const catalogPick = event.target.closest("[data-catalog-pick]");
    if (catalogPick) {
      const key = canonicalFeedUrl(catalogPick.dataset.catalogPick);
      if (catalogPick.checked) {
        catalogPicks.set(key, {
          url: catalogPick.dataset.catalogPick,
          title: catalogPick.dataset.catalogTitle || "",
          topics: (catalogPick.dataset.catalogTopics || "").split(",").filter(Boolean),
        });
      } else {
        catalogPicks.delete(key);
      }
      renderDirectory();
    }
  });
  panel.addEventListener("input", (event) => {
    if (event.target.id === "newFolderInput") folderDraftName = event.target.value;
    if (event.target.id === "discoverFolderName") {
      paintDiscoverBar();
      paintDiscoverSteps();
    }
  });
  panel.addEventListener("pointerdown", (event) => {
    folderActionPointerDown = Boolean(event.target.closest(
      "[data-folder-toggle], [data-select-folder], [data-rename-folder], [data-show-folder], [data-remove-folder]"
    ));
    window.setTimeout(() => {
      folderActionPointerDown = false;
    }, 0);
  });
  panel.addEventListener("keydown", (event) => {
    const renameInput = event.target.closest("[data-rename-folder-form] input");
    if (!renameInput || event.key !== "Escape") return;
    event.preventDefault();
    editingFolderId = "";
    renderSources();
  });
  panel.addEventListener("focusout", (event) => {
    const renameForm = event.target.closest("[data-rename-folder-form]");
    if (!renameForm || renameForm.contains(event.relatedTarget)) return;
    if (editingFolderId !== renameForm.dataset.renameFolderForm) return;
    const id = renameForm.dataset.renameFolderForm;
    const value = event.target.value;
    const restoreFocus = !folderActionPointerDown && event.relatedTarget
      ? ["data-folder-toggle", "data-select-folder", "data-rename-folder", "data-show-folder", "data-remove-folder"]
          .map((attribute) => ({ attribute, value: event.relatedTarget.getAttribute?.(attribute) }))
          .find((entry) => entry.value)
      : null;
    window.setTimeout(() => {
      if (editingFolderId !== id) return;
      const saved = renameFolder(id, value);
      if (!saved || !restoreFocus) return;
      [...panel.querySelectorAll(`[${restoreFocus.attribute}]`)]
        .find((element) => element.getAttribute(restoreFocus.attribute) === restoreFocus.value)
        ?.focus();
    }, 0);
  });
  panel.addEventListener("submit", (event) => {
    const renameForm = event.target.closest("[data-rename-folder-form]");
    if (renameForm) {
      event.preventDefault();
      renameFolder(renameForm.dataset.renameFolderForm, renameForm.querySelector("input")?.value);
      return;
    }
    const form = event.target.closest("[data-new-folder-form]");
    if (!form) return;
    event.preventDefault();
    const name = form.querySelector("input")?.value.trim();
    if (!name) return;
    if (folderDraftMoves) {
      moveSelectedFeeds(name);
      return;
    }
    const folder = ensureFolder(name);
    setFolderOpen(folder, true);
    folderDraft = false;
    folderDraftName = "";
    saveFeedState();
    renderFeeds();
  });
  panel.addEventListener("click", (event) => {
    const openFeed = event.target.closest("[data-open-feed]");
    if (openFeed) {
      const feedId = openFeed.dataset.openFeed;
      if (feedId) {
        if (selectedSource !== `feed:${feedId}`) {
          previousSource = selectedSource;
        }
        selectedSource = `feed:${feedId}`;
        selectedItemId = "";
        feedPane = 0;
        renderFeeds();
      }
      return;
    }
    const backSource = event.target.closest("[data-action='back-source']");
    if (backSource) {
      if (previousSource) {
        selectedSource = previousSource;
        previousSource = null;
        selectedItemId = "";
        feedPane = 0;
        renderFeeds();
      }
      return;
    }
    const dismissInvite = event.target.closest("[data-dismiss-discover-invite]");
    if (dismissInvite) {
      feedState.dismissedDiscoverInvite = true;
      saveFeedState();
      renderFeeds();
      return;
    }
    const startFolder = event.target.closest("[data-start-folder]");
    if (startFolder) {
      folderDraft = true;
      folderDraftMoves = false;
      folderDraftName = "";
      folderDraftFocus = true;
      renderSources();
      return;
    }
    const renameFolderButton = event.target.closest("[data-rename-folder]");
    if (renameFolderButton) {
      editingFolderId = renameFolderButton.dataset.renameFolder;
      folderRenameFocus = true;
      renderSources();
      return;
    }
    const selectFolder = event.target.closest("[data-select-folder]");
    if (selectFolder) {
      toggleFolderSelection(selectFolder.dataset.selectFolder);
      return;
    }
    const selectFeed = event.target.closest("[data-select-feed]");
    if (selectFeed) {
      const feedId = selectFeed.dataset.selectFeed;
      if (selectedFeedIds.has(feedId)) selectedFeedIds.delete(feedId);
      else selectedFeedIds.add(feedId);
      renderSources();
      return;
    }
    const showSelectedFolders = event.target.closest("[data-show-selected-folders]");
    if (showSelectedFolders) {
      if (selectedFolderIds.size) {
        folderFilterMode = "show";
        selectedSource = "folders";
        selectedItemId = "";
        feedPane = 0;
        renderFeeds();
      }
      document.querySelector("#feedsAddDialog")?.close();
      return;
    }
    const hideSelectedFolders = event.target.closest("[data-hide-selected-folders]");
    if (hideSelectedFolders) {
      if (selectedFolderIds.size) {
        folderFilterMode = "hide";
        selectedSource = "folders";
        selectedItemId = "";
        feedPane = 0;
        renderFeeds();
      }
      document.querySelector("#feedsAddDialog")?.close();
      return;
    }
    const clearFolderFilter = event.target.closest("[data-clear-folder-filter]");
    if (clearFolderFilter) {
      clearFolderSelection();
      return;
    }
    const editFolderFilter = event.target.closest("[data-edit-folder-filter]");
    if (editFolderFilter) {
      openFeedsSetup();
      return;
    }
    const removeFolderButton = event.target.closest("[data-remove-folder]");
    if (removeFolderButton) {
      removeFolder(removeFolderButton.dataset.removeFolder);
      return;
    }
    const showFolder = event.target.closest("[data-show-folder]");
    if (showFolder) {
      previousSource = null;
      const folder = feedState.folders.find((item) => item.id === showFolder.dataset.showFolder);
      setFolderOpen(folder, true);
      selectedFolderIds = new Set([showFolder.dataset.showFolder]);
      folderFilterMode = "show";
      selectedSource = "folders";
      selectedItemId = "";
      feedPane = 0;
      saveFeedState();
      renderFeeds();
      document.querySelector("#feedsAddDialog")?.close();
      return;
    }
    const resolveAll = event.target.closest("[data-resolve-all]");
    if (resolveAll) {
      const task = resolveBrokenFeeds();
      window.pickerWaitUntil?.("feeds-resolve", "Finding working feeds", task);
      void task;
      return;
    }
    const resolveOne = event.target.closest("[data-resolve-feed]");
    if (resolveOne) {
      const task = resolveFeed(resolveOne.dataset.resolveFeed);
      window.pickerWaitUntil?.("feeds-resolve", "Finding a working feed", task);
      void task;
      return;
    }
    const deleteButton = event.target.closest("[data-delete-feeds]");
    if (deleteButton) {
      deleteSelectedFeeds();
      return;
    }
    const deleteOne = event.target.closest("[data-delete-feed]");
    if (deleteOne) {
      selectedFeedIds = new Set([deleteOne.dataset.deleteFeed]);
      deleteSelectedFeeds();
      return;
    }
    const topicButton = event.target.closest("[data-feed-topic]");
    if (topicButton) {
      const targetTopic = topicButton.dataset.feedTopic;
      selectedTopic = selectedTopic === targetTopic ? "popular" : targetTopic;
      void loadDirectory();
      return;
    }
    const catalogButton = event.target.closest("[data-catalog-url]");
    if (catalogButton && !catalogButton.disabled) {
      catalogButton.disabled = true;
      const folderNames = discoverFolderNames();
      void followUrl(catalogButton.dataset.catalogUrl, {
        title: catalogButton.dataset.catalogTitle,
        topics: (catalogButton.dataset.catalogTopics || "").split(",").filter(Boolean),
        folderNames,
        skipFormFolder: true,
        keepOpen: true,
      }).finally(() => {
        catalogButton.disabled = false;
        renderDirectory();
      });
      return;
    }
    const choice = event.target.closest("[data-feed-choice]");
    if (choice) {
      const feed = feedChoices[Number(choice.dataset.feedChoice)];
      if (feed) void followUrl(feed.url);
      return;
    }
    const sectionToggle = event.target.closest("[data-toggle-section]");
    if (sectionToggle) {
      const section = sectionToggle.dataset.toggleSection;
      if (section === "folders") {
        foldersSectionCollapsed = !foldersSectionCollapsed;
      } else if (section === "allFeeds") {
        allFeedsSectionCollapsed = !allFeedsSectionCollapsed;
      }
      renderSources();
      return;
    }
    const folderToggle = event.target.closest("[data-folder-toggle]");
    if (folderToggle) {
      const folder = feedState.folders.find((item) => item.id === folderToggle.dataset.folderToggle);
      if (folder) {
        setFolderOpen(folder, !folderIsOpen(folder));
        saveFeedState();
        renderFeeds();
      }
      return;
    }
    const sourceButton = event.target.closest("[data-source]");
    if (sourceButton) {
      previousSource = null;
      selectedSource = sourceButton.dataset.source || "all";
      if (selectedSource === "all") selectedFolderIds.clear();
      selectedItemId = "";
      feedPane = 0;
      renderFeeds();
      document.querySelector("#feedsAddDialog")?.close();
      return;
    }
    const story = event.target.closest("[data-open-story]");
    if (story) {
      openStory(story.dataset.openStory);
      return;
    }
    const star = event.target.closest("[data-star-item]");
    if (star) {
      const id = star.dataset.starItem;
      if (feedState.starred[id]) delete feedState.starred[id];
      else feedState.starred[id] = true;
      saveFeedState();
      renderFeeds();
      return;
    }
    const archive = event.target.closest("[data-archive-item]");
    if (archive) {
      const id = archive.dataset.archiveItem;
      if (feedState.archived[id]) delete feedState.archived[id];
      else {
        feedState.archived[id] = true;
        feedState.read[id] = true;
      }
      saveFeedState();
      if (feedState.archived[id] && selectedSource !== "archive") selectedItemId = "";
      if (!selectedItemId) feedPane = 0;
      renderFeeds();
      return;
    }
    const saveButton = event.target.closest("[data-save-video]");
    if (saveButton) saveFeedVideo(itemById(saveButton.dataset.saveVideo));
  });
  document.querySelector("#desk-feeds")?.addEventListener("change", () => {
    if (!document.querySelector("#desk-feeds")?.checked) return;
    renderFeeds();
    const task = refreshFeeds();
    if (task) window.pickerWaitUntil?.("feeds", "Loading feeds", task);
  });
  window.addEventListener("resize", applyPane);
  renderFeeds();
  watchFeedRefresh();
}

document.addEventListener("DOMContentLoaded", bindFeedsDesk);
