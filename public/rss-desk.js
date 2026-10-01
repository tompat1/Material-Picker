const FEEDS_KEY = "material-picker:feeds";
const FEED_ITEM_CAP = 40;

const feedState = loadFeedState();
let selectedFeedId = "all";
let feedFilter = "all";
let feedChoices = [];
let feedsRefreshed = false;

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

function visibleFeedItems() {
  return feedState.items
    .filter((item) => selectedFeedId === "all" || item.feedId === selectedFeedId)
    .filter((item) => feedFilter === "all" || !feedState.read[item.id])
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

function storeFeed(feed) {
  let record = feedState.feeds.find((item) => item.url === feed.url);
  if (!record) {
    record = {
      id: crypto.randomUUID(),
      url: feed.url,
      title: feed.title || feedHost(feed.url) || "Untitled feed",
      siteUrl: feed.siteUrl || "",
      addedAt: new Date().toISOString(),
    };
    feedState.feeds.unshift(record);
  } else {
    record.title = feed.title || record.title;
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
    : `<p class="feeds-river-empty">${feedState.feeds.length ? (feedFilter === "unread" ? "Nothing unread in this view." : "No stories in this view yet.") : "Follow a site or a feed URL. New stories collect here."}</p>`;
  document.querySelectorAll("[data-feed-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.feedFilter === feedFilter ? "true" : "false");
  });
  renderFeedChoices();
}

async function followUrl(value) {
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
    const record = storeFeed(result.feed);
    selectedFeedId = record.id;
    const input = document.querySelector("#followFeedInput");
    if (input) input.value = "";
    setFeedStatus(`Following ${record.title}.`);
    renderFeeds();
  } catch (error) {
    setFeedStatus(error.message || "The feed could not be loaded.");
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
  document.querySelector("#refreshFeeds")?.addEventListener("click", () => {
    void refreshFeeds();
  });
  document.querySelector("#markFeedsRead")?.addEventListener("click", markVisibleRead);
  panel.addEventListener("click", (event) => {
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
}

document.addEventListener("DOMContentLoaded", bindFeedsDesk);
