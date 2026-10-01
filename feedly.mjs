const FEEDLY_SUBSCRIPTIONS = "https://cloud.feedly.com/v3/subscriptions";
const FEEDLY_PROFILE = "https://cloud.feedly.com/v3/profile";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function assertFeedlyToken(value) {
  const token = String(value || "").trim();
  if (token.length < 20 || token.length > 4000 || /\s/.test(token)) {
    throw fail(400, "A Feedly token is required.");
  }
  return token;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function categoryName(category) {
  const label = String(category?.label || "").trim();
  if (label) return label.slice(0, 80);
  const tail = decodeURIComponent(String(category?.id || "").split("/").pop() || "").trim();
  return (tail || "Folder").slice(0, 80);
}

function folderId(name) {
  const id = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return id || "folder";
}

export function normalizeFeedlySubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) throw fail(502, "Feedly returned an unexpected subscription list.");
  const folders = new Map();
  const feeds = new Map();
  subscriptions.forEach((subscription) => {
    const url = httpUrl(String(subscription?.id || "").replace(/^feed\//, ""));
    if (!url) return;
    const folderIds = [];
    (Array.isArray(subscription.categories) ? subscription.categories : []).forEach((category) => {
      const name = categoryName(category);
      const id = folderId(name);
      folders.set(id, { id, name });
      if (!folderIds.includes(id)) folderIds.push(id);
    });
    const current = feeds.get(url) || {
      url,
      title: String(subscription.title || "").trim().slice(0, 300),
      siteUrl: httpUrl(subscription.website),
      folderIds: [],
    };
    folderIds.forEach((id) => {
      if (!current.folderIds.includes(id)) current.folderIds.push(id);
    });
    if (!current.title && subscription.title) current.title = String(subscription.title).trim().slice(0, 300);
    feeds.set(url, current);
  });
  return {
    folders: [...folders.values()],
    feeds: [...feeds.values()],
  };
}

async function feedlyJson(fetchImpl, token, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401 || response.status === 403) throw fail(401, "That Feedly token was not accepted.");
  if (!response.ok) throw fail(502, "Feedly could not be reached.");
  return response.json();
}

export async function loadFeedlyAccount(tokenValue, fetchImpl = fetch) {
  const token = assertFeedlyToken(tokenValue);
  const subscriptions = await feedlyJson(fetchImpl, token, FEEDLY_SUBSCRIPTIONS);
  const account = normalizeFeedlySubscriptions(subscriptions);
  account.label = "Feedly";
  try {
    const profile = await feedlyJson(fetchImpl, token, FEEDLY_PROFILE);
    account.label = String(profile.fullName || profile.email || profile.givenName || "Feedly").trim().slice(0, 80) || "Feedly";
  } catch (error) {
    if (error.status === 401) throw error;
  }
  return account;
}
