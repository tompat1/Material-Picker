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
};

const feedState = loadFeedState();
let selectedSource = "all";
let selectedItemId = "";
let feedPane = 0;
let feedChoices = [];
let feedRefreshTask = null;
let lastFeedRefreshAt = 0;
let selectedFeedIds = new Set();
let folderDraft = false;
let folderDraftMoves = false;
let folderDraftName = "";
let folderDraftFocus = false;
let selectedTopic = "";
let catalogQuery = "";
let catalogTopics = [];
let directoryFeeds = [];
let directoryRequest = 0;
let touchStart = null;

function loadFeedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEEDS_KEY) || "{}");
    return {
      feeds: Array.isArray(saved.feeds) ? saved.feeds : [],
      folders: Array.isArray(saved.folders) ? saved.folders : [],
      items: Array.isArray(saved.items) ? saved.items : [],
      read: saved.read && typeof saved.read === "object" ? saved.read : {},
      archived: saved.archived && typeof saved.archived === "object" ? saved.archived : {},
      starred: saved.starred && typeof saved.starred === "object" ? saved.starred : {},
    };
  } catch {
    return { feeds: [], folders: [], items: [], read: {}, archived: {}, starred: {} };
  }
}

function saveFeedState() {
  const payload = { ...feedState };
  localStorage.setItem(FEEDS_KEY, JSON.stringify(payload));
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

function canonicalFeedUrl(value) {
  try {
    const url = new URL(normalizeFeedInput(value));
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const dropPort = (url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80");
    const port = url.port && !dropPort ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
    const search = params.length ? `?${params.map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`).join("&")}` : "";
    return `${url.protocol.toLowerCase()}//${host}${port}${path}${search}`;
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function canonicalItemKey(item) {
  const link = item?.link || item?.videoUrl || "";
  if (link) return canonicalFeedUrl(link);
  return `item:${item?.feedId || ""}:${item?.title || item?.id || ""}`;
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
    folder = { id, name: label, collapsed: feedState.folders.length > 3 };
    feedState.folders.push(folder);
  }
  return folder;
}

function feedTime(item) {
  const value = Date.parse(item?.publishedAt || "");
  return Number.isFinite(value) ? value : 0;
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
  if (source.startsWith("folder:")) return feedState.folders.find((folder) => folder.id === source.slice(7))?.name || "Folder";
  if (source.startsWith("feed:")) return feedRecord(source.slice(5))?.title || "Feed";
  return "All";
}

function countLabel(count) {
  return new Intl.NumberFormat(undefined).format(count);
}

function setFeedStatus(message) {
  const node = document.querySelector("#feedsStatus");
  if (node) node.textContent = message || "";
}

async function requestFeed(url) {
  const response = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The feed could not be loaded.");
  return data;
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
  let record = feedState.feeds.find((item) => canonicalFeedUrl(item.url) === key);
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
    image: item.image || "",
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
  if (back) back.hidden = !isPhoneFeeds() || feedPane === 0;
  const title = document.querySelector("#feedsTitle");
  const subtitle = document.querySelector("#feedsSubtitle");
  const article = itemById(selectedItemId);
  const onArticle = isPhoneFeeds() && feedPane === 1;
  if (title) {
    title.textContent = onArticle ? (feedRecord(article?.feedId)?.title || "Article") : sourceTitle();
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

function feedSourceRow(feed, options = {}) {
  const unread = itemsForSource(`feed:${feed.id}`).length;
  const checked = selectedFeedIds.has(feed.id) ? "checked" : "";
  const folders = (feed.folderIds || []).map((id) => feedState.folders.find((folder) => folder.id === id)?.name).filter(Boolean);
  const folderNote = options.showFolder && folders.length ? `<small>${escapeFeedText(folders.join(", "))}</small>` : "";
  const remove = options.showDelete
    ? `<button class="feeds-feed-delete" type="button" data-delete-feed="${escapeFeedText(feed.id)}" aria-label="Delete ${escapeFeedText(feed.title)}">Delete</button>`
    : "";
  return `<li class="feeds-feed-row">
    <label class="feeds-select"><input type="checkbox" data-select-feed="${escapeFeedText(feed.id)}" ${checked} aria-label="Select ${escapeFeedText(feed.title)}" /></label>
    <button type="button" data-source="feed:${escapeFeedText(feed.id)}" aria-pressed="${selectedSource === `feed:${feed.id}` ? "true" : "false"}"><span>${escapeFeedText(feed.title)}${folderNote}</span><em>${unread ? countLabel(unread) : ""}</em></button>
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
  const allCount = unreadItems().length;
  const folders = feedState.folders.map((folder) => {
    const count = itemsForSource(`folder:${folder.id}`).length;
    return `<li class="feeds-folder">
      <button type="button" data-source="folder:${escapeFeedText(folder.id)}" aria-pressed="${selectedSource === `folder:${folder.id}` ? "true" : "false"}"><span>${escapeFeedText(folder.name)}</span><em>${count ? countLabel(count) : ""}</em></button>
      <button class="feeds-folder-remove" type="button" data-remove-folder="${escapeFeedText(folder.id)}" aria-label="Remove ${escapeFeedText(folder.name)} folder">Remove</button>
    </li>`;
  }).join("");
  const allFeeds = [...feedState.feeds].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const folderOptions = feedState.folders.map((folder) => `<option value="${escapeFeedText(folder.name)}">${escapeFeedText(folder.name)}</option>`).join("");
  const selection = selectedFeedIds.size
    ? `<div class="feeds-selection">
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
  <div class="feeds-folder-heading"><span>Folders</span><button type="button" data-start-folder>New folder</button></div>
  ${folderDraft && !folderDraftMoves ? newFolderForm() : ""}
  ${selection}
  <ul class="feeds-source-list">${folders}</ul>
  <div class="feeds-folder-heading"><span>All feeds</span></div>
  <ul class="feeds-source-list">${allFeeds.map((feed) => feedSourceRow(feed, { showDelete: true, showFolder: true })).join("") || `<li class="feeds-feed-empty">Feeds you follow show up here.</li>`}</ul>`;
  if (folderDraftFocus) {
    folderDraftFocus = false;
    document.querySelector("#newFolderInput")?.focus();
  }
}

function renderFolderPicker() {
  const select = document.querySelector("#followFeedFolder");
  if (!select) return;
  const current = select.value;
  const names = feedState.folders.map((folder) => folder.name);
  select.innerHTML = [`<option value="">No folder</option>`, ...names.map((name) => `<option value="${escapeFeedText(name)}">${escapeFeedText(name)}</option>`), `<option value="__new">New folder…</option>`].join("");
  select.value = ["", "__new", ...names].includes(current) ? current : "";
  const nameInput = document.querySelector("#followFeedFolderName");
  if (nameInput) nameInput.hidden = select.value !== "__new";
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
    if (folder) folder.collapsed = false;
  });
}

function moveSelectedFeeds(name) {
  const folder = ensureFolder(name);
  folder.collapsed = false;
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
  renderFeeds();
}

function removeFolder(id) {
  feedState.folders = feedState.folders.filter((folder) => folder.id !== id);
  feedState.feeds.forEach((feed) => {
    feed.folderIds = (feed.folderIds || []).filter((folderId) => folderId !== id);
  });
  if (selectedSource === `folder:${id}`) selectedSource = "all";
  saveFeedState();
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
          <p>Click the + button in the corner to follow a site, or upload the Feedly list you downloaded.</p>
        </div>`;
}

function renderList() {
  const river = document.querySelector("#feedRiver");
  if (!river) return;
  const items = itemsForSource().sort((a, b) => feedTime(b) - feedTime(a));
  if (!items.length) {
    river.innerHTML = feedState.feeds.length
      ? `<p class="feeds-river-empty">Nothing unread in this view.</p>${feedsSignInNote()}`
      : feedsWelcome();
    return;
  }
  const signedOutNote = feedsSignInNote();
  let lastDay = "";
  river.innerHTML = signedOutNote + items.map((item) => {
    const feed = feedRecord(item.feedId);
    const day = dayKey(item.publishedAt);
    const heading = day === lastDay ? "" : `<h3 class="feeds-day">${escapeFeedText(dayLabel(item.publishedAt))}</h3>`;
    lastDay = day;
    const when = formatClock(item.publishedAt);
    return `${heading}<button class="feed-row${selectedItemId === item.id ? " is-selected" : ""}" type="button" data-open-story="${escapeFeedText(item.id)}">
      <span class="feed-row-copy">
        <span class="feed-row-source"><span>${escapeFeedText(feed?.title || "Feed")}</span>${when ? `<time>${escapeFeedText(when)}</time>` : ""}</span>
        <strong>${feedState.starred[item.id] ? "★ " : ""}${escapeFeedText(item.title)}</strong>
        ${item.summary ? `<span>${escapeFeedText(item.summary)}</span>` : ""}
      </span>
      ${item.image ? `<img src="${escapeFeedText(item.image)}" alt="" />` : `<span class="feed-row-thumb" aria-hidden="true"></span>`}
    </button>`;
  }).join("");
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
  reader.innerHTML = `<article class="feed-article">
    ${when ? `<p class="feed-article-date">${escapeFeedText(when)}</p>` : ""}
    <h3>${escapeFeedText(item.title)}</h3>
    ${item.author ? `<p class="feed-article-by">${escapeFeedText(item.author)}</p>` : ""}
    <p class="feed-article-source">${escapeFeedText(feed?.title || "")}</p>
    ${item.image ? `<img src="${escapeFeedText(item.image)}" alt="" />` : ""}
    ${item.link ? `<a class="feed-article-link" href="${escapeFeedText(item.link)}" target="_blank" rel="noreferrer">${escapeFeedText(feedHost(item.link) || "Open")} →</a>` : ""}
    ${item.summary ? `<p class="feed-article-body">${escapeFeedText(item.summary)}</p>` : ""}
    <div class="feed-article-actions">
      <button class="ghost-button" type="button" data-star-item="${escapeFeedText(item.id)}">${feedState.starred[item.id] ? "Starred" : "Star"}</button>
      <button class="ghost-button" type="button" data-archive-item="${escapeFeedText(item.id)}">${feedState.archived[item.id] ? "Archived" : "Archive"}</button>
      ${item.videoUrl ? `<button class="ghost-button" type="button" data-save-video="${escapeFeedText(item.id)}">Save</button>` : ""}
    </div>
  </article>`;
}

function topicLabel(id) {
  return catalogTopics.find((topic) => topic.id === id)?.label || TOPIC_LABELS[id] || id;
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
    box.innerHTML = "";
    return;
  }
  if (!directoryFeeds.length) {
    box.innerHTML = `<p class="feeds-directory-empty">No feeds match that search.</p>`;
    return;
  }
  box.innerHTML = directoryFeeds.map((feed) => {
    const following = feedState.feeds.some((item) => canonicalFeedUrl(item.url) === canonicalFeedUrl(feed.url));
    return `<article class="feed-directory-card">
      <p>${escapeFeedText((feed.topics || []).map(topicLabel).join(" · "))}</p>
      <h3>${escapeFeedText(feed.title)}</h3>
      <p>${escapeFeedText(feed.blurb)}</p>
      <button class="ghost-button" type="button" data-catalog-url="${escapeFeedText(feed.url)}" data-catalog-title="${escapeFeedText(feed.title)}" data-catalog-topics="${escapeFeedText((feed.topics || []).join(","))}" ${following ? "disabled" : ""}>${following ? "Following" : "Follow"}</button>
    </article>`;
  }).join("");
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

async function followUrl(value, options = {}) {
  const url = normalizeFeedInput(value);
  if (!url) return;
  setFeedStatus("Looking for a feed…");
  try {
    const result = await requestFeed(url);
    if (result.kind === "choices") {
      feedChoices = result.feeds || [];
      setFeedStatus("Choose which feed to follow.");
      renderFeeds();
      return;
    }
    feedChoices = [];
    const record = storeFeed(result.feed, { ...options, folderNames: [...(options.folderNames || []), ...chosenFolderNames()] });
    revealFolders(record);
    saveFeedState();
    selectedSource = `feed:${record.id}`;
    selectedItemId = "";
    const input = document.querySelector("#followFeedInput");
    if (input) input.value = "";
    setFeedStatus(`Following ${record.title}.`);
    feedPane = 0;
    renderFeeds();
    document.querySelector("#feedsAddDialog")?.close();
  } catch (error) {
    setFeedStatus(error.message || "The feed could not be loaded.");
    renderFeeds();
  }
}

function paintIncomingFeeds() {
  document.querySelector("#feedsPanel")?.classList.toggle("is-empty", feedState.feeds.length === 0);
  renderSources();
  renderList();
  applyPane();
}

async function refreshFeeds(options = {}) {
  if (feedRefreshTask) return feedRefreshTask;
  if (!feedState.feeds.length) return;
  if (!options.force && lastFeedRefreshAt && Date.now() - lastFeedRefreshAt < FEED_REFRESH_MS) return;
  const button = document.querySelector("#refreshFeeds");
  if (button) button.disabled = true;
  lastFeedRefreshAt = Date.now();
  feedRefreshTask = pullFeeds().finally(() => {
    feedRefreshTask = null;
    if (button) button.disabled = false;
  });
  return feedRefreshTask;
}

async function pullFeeds() {
  const queue = [...feedState.feeds];
  const total = queue.length;
  let done = 0;
  const failures = [];
  setFeedStatus(total === 1 ? "Refreshing 1 feed…" : `Refreshing ${total} feeds…`);
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      try {
        const result = await requestFeed(feed.url);
        if (result.kind === "feed") storeFeed(result.feed);
      } catch {
        failures.push(feed.title);
      }
      done += 1;
      if (done < total) setFeedStatus(`Refreshing feeds… ${done} of ${total}`);
      paintIncomingFeeds();
    }
  });
  await Promise.all(workers);
  dedupeFeedLibrary();
  setFeedStatus(failures.length ? `Some feeds could not refresh: ${failures.slice(0, 3).join(", ")}` : "Feeds are up to date.");
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
    if (!isPhoneFeeds() || event.button !== 0) return;
    if (event.target.closest("input, textarea, a")) return;
    touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId, captured: false };
  });
  swipe.addEventListener("pointermove", (event) => {
    if (!touchStart || event.pointerId !== touchStart.id || touchStart.captured) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return;
    swipe.setPointerCapture(event.pointerId);
    touchStart.captured = true;
  });
  swipe.addEventListener("pointerup", (event) => {
    if (!touchStart || event.pointerId !== touchStart.id) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    suppressNextClick();
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
    touchStart = null;
  });
}

function bindFeedsDesk() {
  const panel = document.querySelector("#feedsPanel");
  if (!panel || panel.dataset.bound === "true") return;
  panel.dataset.bound = "true";
  dedupeFeedLibrary();
  feedState.feeds.forEach((feed) => {
    if (!Array.isArray(feed.folderIds)) feed.folderIds = [];
    (feed.topics || []).forEach((topic) => {
      const folder = ensureFolder(TOPIC_LABELS[topic] || topic);
      if (!feed.folderIds.includes(folder.id)) feed.folderIds.push(folder.id);
    });
  });
  bindSwipe();
  document.querySelector("#feedsAdd")?.addEventListener("click", () => {
    whenAccountKnown(() => {
      if (!pickerIsSignedIn()) {
        document.querySelector("#accountDialog")?.showModal();
        return;
      }
      document.querySelector("#feedsAddDialog")?.showModal();
      void loadDirectory();
    });
  });
  panel.addEventListener("click", (event) => {
    if (!event.target.closest("[data-feeds-signin]")) return;
    document.querySelector("#accountDialog")?.showModal();
  });
  document.addEventListener("picker-account", () => renderFeeds());
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
  document.querySelector("#feedsBack")?.addEventListener("click", () => showPane(0));
  document.querySelector("#followFeedForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void followUrl(document.querySelector("#followFeedInput")?.value);
  });
  document.querySelector("#feedTopicSearch")?.addEventListener("submit", (event) => event.preventDefault());
  document.querySelector("#feedTopicQuery")?.addEventListener("input", (event) => {
    catalogQuery = event.target.value || "";
    selectedTopic = "";
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
    if (event.target.id === "followFeedFolder") {
      const nameInput = document.querySelector("#followFeedFolderName");
      if (nameInput) {
        nameInput.hidden = event.target.value !== "__new";
        if (!nameInput.hidden) nameInput.focus();
      }
    }
  });
  panel.addEventListener("input", (event) => {
    if (event.target.id === "newFolderInput") folderDraftName = event.target.value;
  });
  panel.addEventListener("submit", (event) => {
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
    folder.collapsed = false;
    folderDraft = false;
    folderDraftName = "";
    saveFeedState();
    renderFeeds();
  });
  panel.addEventListener("click", (event) => {
    const startFolder = event.target.closest("[data-start-folder]");
    if (startFolder) {
      folderDraft = true;
      folderDraftMoves = false;
      folderDraftName = "";
      folderDraftFocus = true;
      renderSources();
      return;
    }
    const removeFolderButton = event.target.closest("[data-remove-folder]");
    if (removeFolderButton) {
      removeFolder(removeFolderButton.dataset.removeFolder);
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
      selectedTopic = selectedTopic === topicButton.dataset.feedTopic ? "" : topicButton.dataset.feedTopic;
      catalogQuery = "";
      const query = document.querySelector("#feedTopicQuery");
      if (query) query.value = "";
      void loadDirectory();
      return;
    }
    const catalogButton = event.target.closest("[data-catalog-url]");
    if (catalogButton && !catalogButton.disabled) {
      catalogButton.disabled = true;
      void followUrl(catalogButton.dataset.catalogUrl, {
        title: catalogButton.dataset.catalogTitle,
        topics: (catalogButton.dataset.catalogTopics || "").split(",").filter(Boolean),
      });
      return;
    }
    const choice = event.target.closest("[data-feed-choice]");
    if (choice) {
      const feed = feedChoices[Number(choice.dataset.feedChoice)];
      if (feed) void followUrl(feed.url);
      return;
    }
    const folderToggle = event.target.closest("[data-folder-toggle]");
    if (folderToggle) {
      const folder = feedState.folders.find((item) => item.id === folderToggle.dataset.folderToggle);
      if (folder) {
        folder.collapsed = !folder.collapsed;
        saveFeedState();
        renderFeeds();
      }
      return;
    }
    const sourceButton = event.target.closest("[data-source]");
    if (sourceButton) {
      selectedSource = sourceButton.dataset.source || "all";
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
    void refreshFeeds();
  });
  window.addEventListener("resize", applyPane);
  renderFeeds();
  watchFeedRefresh();
}

document.addEventListener("DOMContentLoaded", bindFeedsDesk);
