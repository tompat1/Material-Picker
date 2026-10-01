const MAX_ITEMS = 40;
const TITLE_LIMIT = 300;
const SUMMARY_LIMIT = 280;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => codePoint(Number(digits)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function codePoint(value) {
  return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : "";
}

function stripTags(value) {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function stripNoise(xml) {
  return String(xml || "")
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

function localName(tag) {
  return String(tag || "").split(":").pop().toLowerCase();
}

function extractBlocks(xml, names) {
  const wanted = new Set(names);
  const blocks = [];
  const pattern = /<\/?([A-Za-z_][\w.:-]*)([^>]*)>/g;
  const stack = [];
  let match;
  while ((match = pattern.exec(xml))) {
    const name = localName(match[1]);
    if (match[0].startsWith("</")) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name !== name) continue;
        const opened = stack[index];
        stack.length = index;
        if (wanted.has(name) && opened.depth === 0) blocks.push(xml.slice(opened.index, pattern.lastIndex));
        break;
      }
      continue;
    }
    if (match[2].trimEnd().endsWith("/")) continue;
    const depth = stack.reduce((count, frame) => count + (frame.name === name ? 1 : 0), 0);
    stack.push({ name, index: match.index, depth });
  }
  return blocks;
}

function innerRaw(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<(?:[\\w.:-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.:-]+:)?${name}>`, "i"));
    if (match && stripTags(match[1])) return match[1];
  }
  return "";
}

function textOf(block, names, limit) {
  return clip(stripTags(innerRaw(block, names)), limit);
}

function attrValue(source, name) {
  const match = String(source || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXml((match && (match[1] || match[2])) || "").trim();
}

function tagsOf(block, name) {
  return [...String(block || "").matchAll(new RegExp(`<(?:[\\w.:-]+:)?${name}\\b([^>]*)\\/?>`, "gi"))];
}

function absoluteHttp(value, base) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function entryLink(block, base) {
  let alternate = "";
  let first = "";
  tagsOf(block, "link").forEach((tag) => {
    const href = absoluteHttp(attrValue(tag[1], "href"), base);
    if (!href) return;
    const relation = (attrValue(tag[1], "rel") || "alternate").toLowerCase();
    if (!first) first = href;
    if (!alternate && relation.split(/\s+/).includes("alternate")) alternate = href;
  });
  return alternate || absoluteHttp(textOf(block, ["link"], 2000), base) || first;
}

function enclosureUrl(block, base) {
  for (const tag of [...tagsOf(block, "enclosure"), ...tagsOf(block, "content")]) {
    const type = attrValue(tag[1], "type").toLowerCase();
    const medium = attrValue(tag[1], "medium").toLowerCase();
    const url = absoluteHttp(attrValue(tag[1], "url"), base);
    if (url && (type.startsWith("video/") || medium === "video")) return url;
  }
  return "";
}

function imageUrl(block, base) {
  for (const tag of tagsOf(block, "thumbnail")) {
    const url = absoluteHttp(attrValue(tag[1], "url"), base);
    if (url) return url;
  }
  for (const tag of tagsOf(block, "content")) {
    const type = attrValue(tag[1], "type").toLowerCase();
    const medium = attrValue(tag[1], "medium").toLowerCase();
    if (!type.startsWith("image/") && medium !== "image") continue;
    const url = absoluteHttp(attrValue(tag[1], "url"), base);
    if (url) return url;
  }
  return "";
}

function authorOf(block) {
  const named = block.match(/<(?:[\w.:-]+:)?author\b[^>]*>[\s\S]*?<(?:[\w.:-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[\w.:-]+:)?name>/i);
  if (named) return clip(stripTags(named[1]), 120);
  return textOf(block, ["creator", "author"], 120);
}

function publishedOf(block) {
  const text = textOf(block, ["published", "pubDate", "updated", "date"], 80);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function videoPage(value) {
  return /(?:youtube\.com\/(?:watch|shorts)\/?|youtu\.be\/|vimeo\.com\/\d+)/i.test(String(value || ""));
}

function itemFrom(block, base, index) {
  const link = entryLink(block, base);
  const videoId = textOf(block, ["videoId"], 32);
  const enclosed = enclosureUrl(block, base);
  const videoUrl = enclosed || (videoPage(link) ? link : "") || (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "");
  const title = textOf(block, ["title"], TITLE_LIMIT) || "Untitled";
  const summary = textOf(block, ["description", "summary", "subtitle", "encoded", "content"], SUMMARY_LIMIT);
  const guid = textOf(block, ["guid", "id"], 400);
  return {
    id: guid || link || `${index}:${title}`,
    title,
    link,
    summary,
    publishedAt: publishedOf(block),
    author: authorOf(block),
    image: imageUrl(block, base),
    videoUrl: absoluteHttp(videoUrl, base),
  };
}

export function looksLikeFeed(body, contentType = "") {
  const sample = stripNoise(body).trim().slice(0, 1200).toLowerCase();
  if (/<(rss|feed|rdf:rdf)\b/.test(sample)) return true;
  const type = String(contentType || "").toLowerCase();
  return /xml|rss|atom/.test(type) && !/html/.test(type) && /<(rss|feed|channel|item|entry)\b/.test(sample);
}

export function discoverFeeds(html, pageUrl) {
  const found = [];
  const seen = new Set();
  [...String(html || "").matchAll(/<link\b([^>]*)>/gi)].forEach((match) => {
    const rel = attrValue(match[1], "rel").toLowerCase();
    const type = attrValue(match[1], "type").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate") || !/rss|atom|xml|rdf/.test(type)) return;
    const url = absoluteHttp(attrValue(match[1], "href"), pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({
      url,
      title: clip(attrValue(match[1], "title"), TITLE_LIMIT),
      type,
    });
  });
  return found;
}

export function parseFeed(xml, feedUrl) {
  const source = stripNoise(xml);
  if (!looksLikeFeed(source)) throw fail(404, "No RSS or Atom feed was found.");
  const base = absoluteHttp(feedUrl, "https://picker.local/") || String(feedUrl || "");
  const head = source.replace(/<(?:[\w.:-]+:)?(?:item|entry)\b[\s\S]*?<\/(?:[\w.:-]+:)?(?:item|entry)>/gi, "");
  const siteLink = entryLink(head, base);
  const items = extractBlocks(source, ["item", "entry"]).slice(0, MAX_ITEMS).map((block, index) => itemFrom(block, base, index));
  return {
    url: base,
    siteUrl: siteLink && siteLink !== base ? siteLink : "",
    title: textOf(head, ["title"], TITLE_LIMIT) || "Untitled feed",
    items,
  };
}

export async function loadFeed(value, fetchText) {
  const first = await fetchText(value);
  const pageUrl = first.finalUrl || value;
  if (looksLikeFeed(first.body, first.contentType)) {
    return { kind: "feed", feed: parseFeed(first.body, pageUrl) };
  }
  const feeds = discoverFeeds(first.body, pageUrl);
  if (!feeds.length) throw fail(404, "No RSS or Atom feed was found.");
  if (feeds.length > 1) return { kind: "choices", pageUrl, feeds };
  const next = await fetchText(feeds[0].url);
  const feedUrl = next.finalUrl || feeds[0].url;
  if (!looksLikeFeed(next.body, next.contentType)) throw fail(404, "No RSS or Atom feed was found.");
  const feed = parseFeed(next.body, feedUrl);
  if (feed.title === "Untitled feed" && feeds[0].title) feed.title = feeds[0].title;
  return { kind: "feed", feed };
}

export const RSS_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.1";
export const RSS_CONTENT_TYPE = /(^$|xml|rss|atom|html|text\/plain|octet-stream)/i;
