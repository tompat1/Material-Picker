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

function looksLikeImage(url) {
  const path = String(url || "").split("?")[0];
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path) || /(?:i\.guim\.co\.uk|wp-content\/uploads|\/img\/media\/)/i.test(url);
}

function imageFromHtml(block, base) {
  const raw = innerRaw(block, ["encoded", "description", "summary", "content"]);
  if (!raw || !/<img\b/i.test(raw)) return "";
  const tag = decodeXml(raw).match(/<img\b[^>]*>/i);
  if (!tag) return "";
  const src = attrValue(tag[0], "src") || attrValue(tag[0], "data-src") || attrValue(tag[0], "data-original");
  if (!src || /^data:/i.test(src)) return "";
  return absoluteHttp(src, base);
}

function imageUrl(block, base) {
  for (const tag of [...tagsOf(block, "thumbnail"), ...tagsOf(block, "image")]) {
    const url = absoluteHttp(attrValue(tag[1], "url") || attrValue(tag[1], "href"), base);
    if (url) return url;
  }
  for (const tag of [...tagsOf(block, "content"), ...tagsOf(block, "enclosure")]) {
    const type = attrValue(tag[1], "type").toLowerCase();
    const medium = attrValue(tag[1], "medium").toLowerCase();
    if (type.startsWith("video/") || type.startsWith("audio/") || medium === "video" || medium === "audio") continue;
    const url = absoluteHttp(attrValue(tag[1], "url"), base);
    if (!url) continue;
    if (type.startsWith("image/") || medium === "image" || looksLikeImage(url)) return url;
  }
  return imageFromHtml(block, base);
}

function openGraphImage(html, base) {
  for (const tag of tagsOf(html, "meta")) {
    const prop = (attrValue(tag[1], "property") || attrValue(tag[1], "name")).toLowerCase();
    if (prop !== "og:image" && prop !== "twitter:image") continue;
    const url = absoluteHttp(attrValue(tag[1], "content"), base);
    if (url) return url;
  }
  return "";
}

async function fillMissingImages(feed, fetchText) {
  if (!feed?.items?.length || feed.items.some((item) => item.image)) return feed;
  const targets = feed.items.filter((item) => item.link && !item.image).slice(0, 12);
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const item = targets[cursor];
      cursor += 1;
      try {
        const page = await fetchText(item.link);
        const image = openGraphImage(page.body, page.finalUrl || item.link);
        if (image) item.image = image;
      } catch {
        // A page without a preview image should not fail the feed.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
  return feed;
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
    return { kind: "feed", feed: await fillMissingImages(parseFeed(first.body, pageUrl), fetchText) };
  }
  const feeds = discoverFeeds(first.body, pageUrl);
  if (!feeds.length) throw fail(404, "No RSS or Atom feed was found.");
  if (feeds.length > 1) return { kind: "choices", pageUrl, feeds };
  const next = await fetchText(feeds[0].url);
  const feedUrl = next.finalUrl || feeds[0].url;
  if (!looksLikeFeed(next.body, next.contentType)) throw fail(404, "No RSS or Atom feed was found.");
  const feed = parseFeed(next.body, feedUrl);
  if (feed.title === "Untitled feed" && feeds[0].title) feed.title = feeds[0].title;
  return { kind: "feed", feed: await fillMissingImages(feed, fetchText) };
}

export const RSS_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.1";
export const RSS_CONTENT_TYPE = /(^$|xml|rss|atom|html|text\/plain|octet-stream)/i;

export const FEED_TOPICS = [
  { id: "news", label: "News" },
  { id: "tech", label: "Tech" },
  { id: "apple", label: "Apple" },
  { id: "ai", label: "AI" },
  { id: "politics", label: "Politics" },
  { id: "movies", label: "Movies" },
  { id: "gaming", label: "Gaming" },
  { id: "science", label: "Science" },
  { id: "business", label: "Business" },
  { id: "sports", label: "Sports" },
];

export const FEED_CATALOG = [
  { id: "bbc-news", title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", site: "bbc.com", topics: ["news"], blurb: "World and UK headlines" },
  { id: "nyt-home", title: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", site: "nytimes.com", topics: ["news"], blurb: "Top stories" },
  { id: "npr-news", title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", site: "npr.org", topics: ["news"], blurb: "US public radio headlines" },
  { id: "guardian-world", title: "The Guardian", url: "https://www.theguardian.com/world/rss", site: "theguardian.com", topics: ["news"], blurb: "World news" },
  { id: "aljazeera", title: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", site: "aljazeera.com", topics: ["news"], blurb: "International news" },
  { id: "verge", title: "The Verge", url: "https://www.theverge.com/rss/index.xml", site: "theverge.com", topics: ["tech"], blurb: "Technology and culture" },
  { id: "ars", title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", site: "arstechnica.com", topics: ["tech"], blurb: "Science and technology" },
  { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", site: "news.ycombinator.com", topics: ["tech"], blurb: "Front page" },
  { id: "wired", title: "WIRED", url: "https://www.wired.com/feed/rss", site: "wired.com", topics: ["tech"], blurb: "Culture, science, and gear" },
  { id: "engadget", title: "Engadget", url: "https://www.engadget.com/rss.xml", site: "engadget.com", topics: ["tech"], blurb: "Gadget news and reviews" },
  { id: "mkbhd", title: "Marques Brownlee", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ", site: "youtube.com", topics: ["tech"], blurb: "YouTube · MKBHD" },
  { id: "matt-wolfe", title: "Matt Wolfe", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UChpleBmo18P08aKCIgti38g", site: "youtube.com", topics: ["ai"], blurb: "YouTube · AI tools" },
  { id: "macrumors", title: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All", site: "macrumors.com", topics: ["apple", "tech"], blurb: "Apple news and rumors" },
  { id: "nineto5mac", title: "9to5Mac", url: "https://9to5mac.com/feed/", site: "9to5mac.com", topics: ["apple", "tech"], blurb: "Apple coverage" },
  { id: "daring-fireball", title: "Daring Fireball", url: "https://daringfireball.net/feeds/main", site: "daringfireball.net", topics: ["apple"], blurb: "John Gruber on Apple" },
  { id: "openai", title: "OpenAI News", url: "https://openai.com/news/rss.xml", site: "openai.com", topics: ["ai"], blurb: "OpenAI announcements" },
  { id: "mit-ai", title: "MIT Technology Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", site: "technologyreview.com", topics: ["ai"], blurb: "Artificial intelligence" },
  { id: "huggingface", title: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", site: "huggingface.co", topics: ["ai"], blurb: "Models and research" },
  { id: "google-ai", title: "Google AI", url: "https://blog.google/technology/ai/rss/", site: "blog.google", topics: ["ai"], blurb: "Google AI posts" },
  { id: "deepmind", title: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", site: "deepmind.google", topics: ["ai"], blurb: "DeepMind research" },
  { id: "bbc-politics", title: "BBC Politics", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", site: "bbc.com", topics: ["politics", "news"], blurb: "UK politics" },
  { id: "nyt-politics", title: "NYT Politics", url: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", site: "nytimes.com", topics: ["politics", "news"], blurb: "US politics" },
  { id: "the-hill", title: "The Hill", url: "https://thehill.com/feed/", site: "thehill.com", topics: ["politics"], blurb: "Washington news" },
  { id: "variety", title: "Variety", url: "https://variety.com/feed/", site: "variety.com", topics: ["movies"], blurb: "Film and entertainment" },
  { id: "indiewire", title: "IndieWire", url: "https://www.indiewire.com/feed/", site: "indiewire.com", topics: ["movies"], blurb: "Independent film" },
  { id: "ebert", title: "Roger Ebert", url: "https://www.rogerebert.com/feed", site: "rogerebert.com", topics: ["movies"], blurb: "Reviews and essays" },
  { id: "thr", title: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/feed/", site: "hollywoodreporter.com", topics: ["movies"], blurb: "Hollywood news" },
  { id: "polygon", title: "Polygon", url: "https://www.polygon.com/rss/index.xml", site: "polygon.com", topics: ["gaming"], blurb: "Games and entertainment" },
  { id: "kotaku", title: "Kotaku", url: "https://kotaku.com/rss", site: "kotaku.com", topics: ["gaming"], blurb: "Video games" },
  { id: "ign", title: "IGN", url: "https://feeds.ign.com/ign/games-all", site: "ign.com", topics: ["gaming"], blurb: "Games coverage" },
  { id: "rps", title: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", site: "rockpapershotgun.com", topics: ["gaming"], blurb: "PC gaming" },
  { id: "eurogamer", title: "Eurogamer", url: "https://www.eurogamer.net/feed", site: "eurogamer.net", topics: ["gaming"], blurb: "European games news" },
  { id: "nasa", title: "NASA", url: "https://www.nasa.gov/rss/dyn/breaking_news.rss", site: "nasa.gov", topics: ["science"], blurb: "Breaking space news" },
  { id: "sciencedaily", title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", site: "sciencedaily.com", topics: ["science"], blurb: "Research roundups" },
  { id: "guardian-science", title: "Guardian Science", url: "https://www.theguardian.com/science/rss", site: "theguardian.com", topics: ["science"], blurb: "Science news" },
  { id: "nature", title: "Nature", url: "https://www.nature.com/nature.rss", site: "nature.com", topics: ["science"], blurb: "Journal highlights" },
  { id: "bbc-business", title: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", site: "bbc.com", topics: ["business", "news"], blurb: "Business headlines" },
  { id: "guardian-business", title: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss", site: "theguardian.com", topics: ["business"], blurb: "Markets and companies" },
  { id: "bbc-sport", title: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", site: "bbc.com", topics: ["sports"], blurb: "Sport headlines" },
  { id: "guardian-sport", title: "Guardian Sport", url: "https://www.theguardian.com/sport/rss", site: "theguardian.com", topics: ["sports"], blurb: "Sport news" },
];

const TOPIC_IDS = new Set(FEED_TOPICS.map((topic) => topic.id));

const POPULAR_FEED_IDS = [
  "bbc-news",
  "guardian-world",
  "npr-news",
  "verge",
  "ars",
  "hn",
  "engadget",
  "macrumors",
  "nineto5mac",
  "openai",
  "mit-ai",
  "mkbhd",
  "variety",
  "indiewire",
  "polygon",
  "ign",
  "nasa",
  "sciencedaily",
  "bbc-sport",
  "the-hill",
];

export function popularFeedCatalog() {
  const byId = new Map(FEED_CATALOG.map((feed) => [feed.id, feed]));
  return POPULAR_FEED_IDS.map((id) => byId.get(id)).filter(Boolean);
}

export function searchFeedCatalog({ query = "", topic = "" } = {}) {
  const selected = String(topic || "").trim().toLowerCase();
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (selected === "popular") {
    return popularFeedCatalog().filter((feed) => {
      if (!words.length) return true;
      const haystack = [feed.title, feed.site, feed.blurb, ...feed.topics].join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }
  if (selected && !TOPIC_IDS.has(selected)) return [];
  if (!selected && !words.length) return [];
  return FEED_CATALOG.filter((feed) => {
    if (selected && !feed.topics.includes(selected)) return false;
    const haystack = [feed.title, feed.site, feed.blurb, ...feed.topics].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function parseOpml(xml) {
  const source = String(xml || "");
  if (!/<outline\b/i.test(source)) throw fail(400, "That file is not an OPML list.");
  const feeds = [];
  const folders = [];
  const tag = /<outline\b([^>]*?)(\/?)\s*>|<\/outline\s*>/gi;
  let match;
  while ((match = tag.exec(source))) {
    if (match[0].startsWith("</")) {
      folders.pop();
      continue;
    }
    const attrs = outlineAttrs(match[1]);
    const selfClosing = match[2] === "/";
    const xmlUrl = String(attrs.xmlUrl || attrs.xmlurl || "").trim();
    const title = String(attrs.title || attrs.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const siteUrl = httpSite(attrs.htmlUrl || attrs.htmlurl);
    if (/^https?:\/\//i.test(xmlUrl)) {
      feeds.push({
        url: xmlUrl,
        title,
        siteUrl,
        folderNames: folders.filter(Boolean).slice(0, 4),
      });
      if (!selfClosing) folders.push("");
      continue;
    }
    if (!selfClosing && title) folders.push(title.slice(0, 80));
  }
  if (!feeds.length) throw fail(400, "That OPML file has no RSS feeds.");
  return feeds;
}

function outlineAttrs(raw) {
  const attrs = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(raw))) attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  return attrs;
}

function httpSite(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}
