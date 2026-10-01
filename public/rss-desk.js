const FEEDS_KEY = "material-picker:feeds";
const FEED_ITEM_CAP = 40;
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
let feedsRefreshed = false;
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
      feedlyLabel: typeof saved.feedlyLabel === "string" ? saved.feedlyLabel : "",
      feedlyToken: typeof saved.feedlyToken === "string" ? saved.feedlyToken : "",
    };
  } catch {
    return { feeds: [], folders: [], items: [], read: {}, archived: {}, starred: {}, feedlyLabel: "", feedlyToken: "" };
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

function itemsForSource(source = selectedSource) {
  if (source === "archive") return feedState.items.filter((item) => feedState.archived[item.id]);
  if (source === "all") return unreadItems();
  if (source.startsWith("folder:")) {
    const folderId = source.slice(7);
    const feedIds = new Set(feedState.feeds.filter((feed) => (feed.folderIds || []).includes(folderId)).map((feed) => feed.id));
    return unreadItems().filter((item) => feedIds.has(item.feedId));
  }
  if (source.startsWith("feed:")) {
    const feedId = source.slice(5);
    return unreadItems().filter((item) => item.feedId === feedId);
  }
  return unreadItems();
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
  let record = feedState.feeds.find((item) => item.url === feed.url);
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
  }));
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

function renderSources() {
  const root = document.querySelector("#feedsSources");
  if (!root) return;
  const allCount = unreadItems().length;
  const folders = feedState.folders.map((folder) => {
    const feeds = feedState.feeds.filter((feed) => (feed.folderIds || []).includes(folder.id));
    const count = itemsForSource(`folder:${folder.id}`).length;
    const nested = folder.collapsed ? "" : `<ul>${feeds.map((feed) => {
      const unread = itemsForSource(`feed:${feed.id}`).length;
      return `<li><button type="button" data-source="feed:${escapeFeedText(feed.id)}" aria-pressed="${selectedSource === `feed:${feed.id}` ? "true" : "false"}"><span class="feeds-feed-mark" aria-hidden="true"></span><span>${escapeFeedText(feed.title)}</span><em>${unread ? countLabel(unread) : ""}</em></button></li>`;
    }).join("")}</ul>`;
    return `<li class="feeds-folder">
      <button class="feeds-folder-toggle" type="button" data-folder-toggle="${escapeFeedText(folder.id)}" aria-expanded="${folder.collapsed ? "false" : "true"}" aria-label="${folder.collapsed ? "Expand" : "Collapse"} ${escapeFeedText(folder.name)}">${folder.collapsed ? "›" : "⌄"}</button>
      <button type="button" data-source="folder:${escapeFeedText(folder.id)}" aria-pressed="${selectedSource === `folder:${folder.id}` ? "true" : "false"}"><span>${escapeFeedText(folder.name)}</span><em>${count ? countLabel(count) : ""}</em></button>
      ${nested}
    </li>`;
  }).join("");
  const loose = feedState.feeds.filter((feed) => !(feed.folderIds || []).length).map((feed) => `<li><button type="button" data-source="feed:${escapeFeedText(feed.id)}" aria-pressed="${selectedSource === `feed:${feed.id}` ? "true" : "false"}"><span class="feeds-feed-mark" aria-hidden="true"></span><span>${escapeFeedText(feed.title)}</span><em>${countLabel(itemsForSource(`feed:${feed.id}`).length)}</em></button></li>`).join("");
  root.innerHTML = `<ul class="feeds-source-list">
    <li><button type="button" data-source="all" aria-pressed="${selectedSource === "all" ? "true" : "false"}"><span>All items</span><em>${countLabel(allCount)}</em></button></li>
    <li><button type="button" data-source="archive" aria-pressed="${selectedSource === "archive" ? "true" : "false"}"><span>Archive</span><em></em></button></li>
  </ul>
  <div class="feeds-folder-heading"><span>Folders</span></div>
  <ul class="feeds-source-list">${folders}${loose}</ul>
  ${feedState.feeds.length ? "" : `<p class="feeds-river-empty">Add a feed or connect Feedly to copy your subscriptions.</p>`}`;
}

function renderList() {
  const river = document.querySelector("#feedRiver");
  if (!river) return;
  const items = itemsForSource().sort((a, b) => feedTime(b) - feedTime(a));
  if (!items.length) {
    river.innerHTML = `<p class="feeds-river-empty">${feedState.feeds.length ? "Nothing unread in this view." : "Stories you follow will show up here."}</p>`;
    return;
  }
  let lastDay = "";
  river.innerHTML = items.map((item) => {
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
    const following = feedState.feeds.some((item) => item.url === feed.url);
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
  renderSources();
  renderList();
  renderReader();
  renderDirectory();
  renderFeedChoices();
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
    const record = storeFeed(result.feed, options);
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

async function refreshFeeds() {
  if (!feedState.feeds.length) return;
  const button = document.querySelector("#refreshFeeds");
  if (button) button.disabled = true;
  setFeedStatus("Refreshing feeds…");
  const queue = [...feedState.feeds];
  const failures = [];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      try {
        const result = await requestFeed(feed.url);
        if (result.kind === "feed") storeFeed(result.feed);
      } catch (error) {
        failures.push(feed.title);
      }
    }
  });
  await Promise.all(workers);
  setFeedStatus(failures.length ? `Some feeds could not refresh: ${failures.slice(0, 3).join(", ")}` : "Feeds are up to date.");
  if (button) button.disabled = false;
  renderFeeds();
}

async function connectFeedly(token) {
  setFeedStatus("Copying Feedly subscriptions…");
  const response = await fetch("/api/feedly/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Feedly could not be connected.");
  const importedFolders = data.folders || [];
  importedFolders.forEach((folder) => ensureFolder(folder.name));
  const imported = [];
  (data.feeds || []).forEach((feed) => {
    const names = (feed.folderIds || []).map((id) => importedFolders.find((folder) => folder.id === id)?.name).filter(Boolean);
    let record = feedState.feeds.find((item) => item.url === feed.url);
    if (!record) {
      record = {
        id: crypto.randomUUID(),
        url: feed.url,
        title: feed.title || feedHost(feed.url) || "Untitled feed",
        siteUrl: feed.siteUrl || "",
        topics: [],
        folderIds: [],
        addedAt: new Date().toISOString(),
      };
      feedState.feeds.push(record);
    }
    assignFolderNames(record, names);
    if (feed.title) record.title = feed.title;
    imported.push(record);
  });
  feedState.feedlyLabel = data.label || "Feedly";
  feedState.feedlyToken = token;
  selectedSource = "all";
  selectedItemId = "";
  feedPane = 0;
  saveFeedState();
  setFeedStatus(`Copied ${imported.length} subscriptions from Feedly. Loading stories…`);
  renderFeeds();
  document.querySelector("#feedsAddDialog")?.close();
  const queue = [...imported];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      try {
        const result = await requestFeed(feed.url);
        if (result.kind === "feed") storeFeed(result.feed, { title: feed.title, folderIds: feed.folderIds });
      } catch {
        /* Keep the subscription even if this refresh fails. */
      }
    }
  });
  await Promise.all(workers);
  setFeedStatus(`Feedly is connected. ${feedState.feeds.length} subscriptions are in your folders.`);
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
    touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    swipe.setPointerCapture(event.pointerId);
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
  feedState.feeds.forEach((feed) => {
    if (!Array.isArray(feed.folderIds)) feed.folderIds = [];
    (feed.topics || []).forEach((topic) => {
      const folder = ensureFolder(TOPIC_LABELS[topic] || topic);
      if (!feed.folderIds.includes(folder.id)) feed.folderIds.push(folder.id);
    });
  });
  bindSwipe();
  document.querySelector("#feedsAdd")?.addEventListener("click", () => {
    document.querySelector("#feedsAddDialog")?.showModal();
    void loadDirectory();
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
  document.querySelector("#feedlyConnectForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = document.querySelector("#feedlyToken")?.value || "";
    void connectFeedly(token).catch((error) => setFeedStatus(error.message || "Feedly could not be connected."));
  });
  document.querySelector("#refreshFeeds")?.addEventListener("click", () => {
    void refreshFeeds();
  });
  panel.addEventListener("click", (event) => {
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
    if (!feedsRefreshed && feedState.feeds.length && feedState.feeds.length <= 12) {
      feedsRefreshed = true;
      void refreshFeeds();
    }
  });
  window.addEventListener("resize", applyPane);
  renderFeeds();
}

document.addEventListener("DOMContentLoaded", bindFeedsDesk);
