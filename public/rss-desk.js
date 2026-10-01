const FEEDS_KEY = "material-picker:feeds";
const FEED_ITEM_CAP = 40;

const feedState = loadFeedState();
let selectedFeedId = "all";
let feedFilter = "all";
let feedChoices = [];
let feedsRefreshed = false;
let selectedTopic = "";
let catalogQuery = "";
let catalogTopics = [];
let directoryFeeds = [];
let directoryRequest = 0;

function loadFeedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEEDS_KEY) || "{}");
    return {
      feeds: Array.isArray(saved.feeds) ? saved.feeds : [],
      items: Array.isArray(saved.items) ? saved.items : [],
      read: saved.read && typeof saved.read === "object" ? saved.read : {},
    };
  } catch {
    return { feeds: [], items: [], read: {} };
  }
}

function saveFeedState() {
  localStorage.setItem(FEEDS_KEY, JSON.stringify(feedState));
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

function feedTime(item) {
  const value = Date.parse(item.publishedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function formatFeedTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(time);
}

function unreadCount(feedId) {
  return feedState.items.filter((item) => item.feedId === feedId && !feedState.read[item.id]).length;
}

function feedRecord(feedId) {
  return feedState.feeds.find((entry) => entry.id === feedId);
}

function storyMatchesTopic(item) {
  if (!selectedTopic) return true;
  return (feedRecord(item.feedId)?.topics || []).includes(selectedTopic);
}

function storyMatchesQuery(item) {
  const words = catalogQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const feed = feedRecord(item.feedId);
  const haystack = `${item.title} ${item.summary} ${item.author} ${feed?.title || ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function visibleFeedItems() {
  return feedState.items
    .filter((item) => selectedFeedId === "all" || item.feedId === selectedFeedId)
    .filter((item) => feedFilter === "all" || !feedState.read[item.id])
    .filter(storyMatchesTopic)
    .filter(storyMatchesQuery)
    .sort((a, b) => feedTime(b) - feedTime(a));
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

function storeFeed(feed, options = {}) {
  let record = feedState.feeds.find((item) => item.url === feed.url);
  const topics = Array.isArray(options.topics) ? options.topics.filter(Boolean) : [];
  if (!record) {
    record = {
      id: crypto.randomUUID(),
      url: feed.url,
      title: options.title || feed.title || feedHost(feed.url) || "Untitled feed",
      siteUrl: feed.siteUrl || "",
      topics,
      addedAt: new Date().toISOString(),
    };
    feedState.feeds.unshift(record);
  } else {
    if (!record.title) record.title = options.title || feed.title || "Untitled feed";
    if (topics.length) record.topics = topics;
    if (!Array.isArray(record.topics)) record.topics = [];
    record.siteUrl = feed.siteUrl || record.siteUrl;
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
  const merged = [...kept.values()]
    .sort((a, b) => feedTime(b) - feedTime(a))
    .slice(0, FEED_ITEM_CAP);
  feedState.items = feedState.items.filter((item) => item.feedId !== record.id).concat(merged);
  saveFeedState();
  return record;
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
  const list = document.querySelector("#feedList");
  const empty = document.querySelector("#feedsEmpty");
  const river = document.querySelector("#feedRiver");
  if (!list || !river) return;
  if (empty) empty.hidden = feedState.feeds.length > 0;
  const allUnread = feedState.items.filter((item) => !feedState.read[item.id]).length;
  list.innerHTML = feedState.feeds.length
    ? `<li><button type="button" data-feed-id="all" aria-pressed="${selectedFeedId === "all" ? "true" : "false"}"><span>All</span><em>${allUnread}</em></button></li>${feedState.feeds
      .map((feed) => `<li><button type="button" data-feed-id="${escapeFeedText(feed.id)}" aria-pressed="${selectedFeedId === feed.id ? "true" : "false"}"><span>${escapeFeedText(feed.title)}</span><em>${unreadCount(feed.id)}</em></button><button class="feed-unfollow" type="button" data-unfollow="${escapeFeedText(feed.id)}" aria-label="Unfollow ${escapeFeedText(feed.title)}">×</button></li>`)
      .join("")}`
    : "";

  const items = visibleFeedItems();
  river.innerHTML = items.length
    ? items.map((item) => {
      const feed = feedState.feeds.find((entry) => entry.id === item.feedId);
      const read = Boolean(feedState.read[item.id]);
      const when = formatFeedTime(item.publishedAt);
      const source = [feed?.title, item.author].filter(Boolean).join(" · ");
      const href = item.link || item.videoUrl;
      return `<article class="feed-card${read ? " is-read" : ""}">
        <a href="${escapeFeedText(href || "#")}" target="_blank" rel="noreferrer" data-open-item="${escapeFeedText(item.id)}" ${href ? "" : "aria-disabled=\"true\""}>
          <p class="feed-card-meta"><span>${escapeFeedText(source)}</span>${when ? `<time datetime="${escapeFeedText(item.publishedAt)}">${escapeFeedText(when)}</time>` : ""}</p>
          <h3>${escapeFeedText(item.title)}</h3>
          ${item.summary ? `<p>${escapeFeedText(item.summary)}</p>` : ""}
        </a>
        <div class="feed-card-actions">
          <button class="ghost-button" type="button" data-read-item="${escapeFeedText(item.id)}">${read ? "Keep unread" : "Mark read"}</button>
          ${item.videoUrl ? `<button class="ghost-button" type="button" data-save-video="${escapeFeedText(item.id)}">Save</button>` : ""}
        </div>
      </article>`;
    }).join("")
    : `<p class="feeds-river-empty">${riverEmptyMessage()}</p>`;
  document.querySelectorAll("[data-feed-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.feedFilter === feedFilter ? "true" : "false");
  });
  renderFeedChoices();
  renderDirectory();
}

function riverEmptyMessage() {
  if (!feedState.feeds.length && !selectedTopic && !catalogQuery) return "Follow a site or a feed URL. New stories collect here.";
  if (selectedTopic || catalogQuery) return "No stories in this search yet. Follow a feed above to fill the river.";
  if (feedFilter === "unread") return "Nothing unread in this view.";
  return "No stories in this view yet.";
}

function topicLabel(id) {
  return catalogTopics.find((topic) => topic.id === id)?.label || id;
}

function renderDirectory() {
  const box = document.querySelector("#feedDirectory");
  const topics = document.querySelector("#feedTopics");
  if (topics) {
    topics.querySelectorAll("[data-feed-topic]").forEach((button) => {
      button.setAttribute("aria-pressed", (button.dataset.feedTopic || "") === selectedTopic ? "true" : "false");
    });
  }
  if (!box) return;
  const active = Boolean(selectedTopic || catalogQuery.trim());
  box.hidden = !active;
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
      <p>${escapeFeedText(feed.topics.map(topicLabel).join(" · "))}</p>
      <h3>${escapeFeedText(feed.title)}</h3>
      <p>${escapeFeedText(feed.blurb)}</p>
      <button class="ghost-button" type="button" data-catalog-url="${escapeFeedText(feed.url)}" data-catalog-title="${escapeFeedText(feed.title)}" data-catalog-topics="${escapeFeedText(feed.topics.join(","))}" ${following ? "disabled" : ""}>${following ? "Following" : "Follow"}</button>
    </article>`;
  }).join("");
}

async function loadDirectory() {
  const requestId = ++directoryRequest;
  const params = new URLSearchParams();
  if (selectedTopic) params.set("topic", selectedTopic);
  if (catalogQuery.trim()) params.set("q", catalogQuery.trim());
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
  renderFeeds();
}

async function followUrl(value, options = {}) {
  const url = normalizeFeedInput(value);
  if (!url) return;
  setFeedStatus("Looking for a feed…");
  try {
    const result = await requestFeed(url);
    if (result.kind === "choices") {
      feedChoices = result.feeds || [];
      setFeedStatus("");
      renderFeeds();
      return;
    }
    feedChoices = [];
    const record = storeFeed(result.feed, options);
    selectedFeedId = record.id;
    const input = document.querySelector("#followFeedInput");
    if (input) input.value = "";
    setFeedStatus(`Following ${record.title}.`);
    renderFeeds();
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
  const failures = [];
  for (const feed of [...feedState.feeds]) {
    try {
      const result = await requestFeed(feed.url);
      if (result.kind === "feed") storeFeed(result.feed);
    } catch (error) {
      failures.push(`${feed.title}: ${error.message || "could not refresh"}`);
    }
  }
  setFeedStatus(failures.length ? failures.join(" ") : "Feeds are up to date.");
  if (button) button.disabled = false;
  renderFeeds();
}

function unfollow(feedId) {
  const feed = feedState.feeds.find((item) => item.id === feedId);
  if (!feed) return;
  if (!confirm(`Unfollow ${feed.title}?`)) return;
  feedState.feeds = feedState.feeds.filter((item) => item.id !== feedId);
  const removed = new Set(feedState.items.filter((item) => item.feedId === feedId).map((item) => item.id));
  feedState.items = feedState.items.filter((item) => item.feedId !== feedId);
  removed.forEach((id) => delete feedState.read[id]);
  if (selectedFeedId === feedId) selectedFeedId = "all";
  saveFeedState();
  renderFeeds();
}

function markVisibleRead() {
  visibleFeedItems().forEach((item) => {
    feedState.read[item.id] = true;
  });
  saveFeedState();
  renderFeeds();
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

function bindFeedsDesk() {
  const panel = document.querySelector("#feedsPanel");
  if (!panel || panel.dataset.bound === "true") return;
  panel.dataset.bound = "true";
  document.querySelector("#followFeedForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void followUrl(document.querySelector("#followFeedInput")?.value);
  });
  document.querySelector("#feedTopicSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.querySelector("#feedTopicQuery")?.addEventListener("input", (event) => {
    catalogQuery = event.target.value || "";
    void loadDirectory();
  });
  document.querySelector("#refreshFeeds")?.addEventListener("click", () => {
    void refreshFeeds();
  });
  document.querySelector("#markFeedsRead")?.addEventListener("click", markVisibleRead);
  panel.addEventListener("click", (event) => {
    const topicButton = event.target.closest("[data-feed-topic]");
    if (topicButton) {
      selectedTopic = topicButton.dataset.feedTopic || "";
      void loadDirectory();
      return;
    }
    const catalogButton = event.target.closest("[data-catalog-url]");
    if (catalogButton) {
      const url = catalogButton.dataset.catalogUrl;
      const existing = feedState.feeds.find((item) => item.url === url);
      if (existing) {
        selectedFeedId = existing.id;
        renderFeeds();
        return;
      }
      catalogButton.disabled = true;
      void followUrl(url, {
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
    const filter = event.target.closest("[data-feed-filter]");
    if (filter) {
      feedFilter = filter.dataset.feedFilter || "all";
      renderFeeds();
      return;
    }
    const unfollowButton = event.target.closest("[data-unfollow]");
    if (unfollowButton) {
      unfollow(unfollowButton.dataset.unfollow);
      return;
    }
    const feedButton = event.target.closest("[data-feed-id]");
    if (feedButton) {
      selectedFeedId = feedButton.dataset.feedId || "all";
      renderFeeds();
      return;
    }
    const readButton = event.target.closest("[data-read-item]");
    if (readButton) {
      const id = readButton.dataset.readItem;
      if (feedState.read[id]) delete feedState.read[id];
      else feedState.read[id] = true;
      saveFeedState();
      renderFeeds();
      return;
    }
    const saveButton = event.target.closest("[data-save-video]");
    if (saveButton) {
      saveFeedVideo(feedState.items.find((item) => item.id === saveButton.dataset.saveVideo));
      return;
    }
    const open = event.target.closest("[data-open-item]");
    if (open) {
      if (!open.getAttribute("href") || open.getAttribute("href") === "#") event.preventDefault();
      feedState.read[open.dataset.openItem] = true;
      saveFeedState();
      open.closest(".feed-card")?.classList.add("is-read");
      const readButton = open.parentElement?.querySelector("[data-read-item]");
      if (readButton) readButton.textContent = "Keep unread";
      setTimeout(renderFeeds, 0);
    }
  });
  document.querySelector("#desk-feeds")?.addEventListener("change", () => {
    if (!document.querySelector("#desk-feeds")?.checked) return;
    renderFeeds();
    if (!feedsRefreshed) {
      feedsRefreshed = true;
      void refreshFeeds();
    }
  });
  renderFeeds();
  void loadDirectory();
}

document.addEventListener("DOMContentLoaded", bindFeedsDesk);
