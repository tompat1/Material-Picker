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
  if (!text || text === "undefined" || text === "null" || text === "[object Object]") return "";
  try {
    const url = new URL(text, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.pathname.endsWith("/undefined") || url.pathname.endsWith("/null")) return "";
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
  for (const name of ["encoded", "description", "summary", "content"]) {
    const match = block.match(new RegExp(`<(?:[\\w.:-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.:-]+:)?${name}>`, "i"));
    if (!match || !/<img\b/i.test(match[1])) continue;
    for (const imgMatch of decodeXml(match[1]).matchAll(/<img\b([^>]*)\/?>/gi)) {
      const tag = imgMatch[0];
      const src = attrValue(tag, "src") || attrValue(tag, "data-src") || attrValue(tag, "data-original");
      if (!src || /^data:/i.test(src) || src === "undefined" || src === "null") continue;
      if (/(?:pixel|tracking|spacer|\b1x1\b)/i.test(src)) continue;
      const resolved = absoluteHttp(src, base);
      if (resolved) return resolved;
    }
  }
  return "";
}

function imageUrl(block, base) {
  for (const tag of [...tagsOf(block, "thumbnail"), ...tagsOf(block, "image")]) {
    const rawUrl = attrValue(tag[1], "url") || attrValue(tag[1], "href");
    if (!rawUrl || rawUrl === "undefined" || rawUrl === "null") continue;
    const url = absoluteHttp(rawUrl, base);
    if (url) return url;
  }
  for (const tag of [...tagsOf(block, "content"), ...tagsOf(block, "enclosure")]) {
    const type = attrValue(tag[1], "type").toLowerCase();
    const medium = attrValue(tag[1], "medium").toLowerCase();
    if (type.startsWith("video/") || type.startsWith("audio/") || medium === "video" || medium === "audio") continue;
    const rawUrl = attrValue(tag[1], "url");
    if (!rawUrl || rawUrl === "undefined" || rawUrl === "null") continue;
    const url = absoluteHttp(rawUrl, base);
    if (!url) continue;
    if (type.startsWith("image/") || medium === "image" || looksLikeImage(url)) return url;
  }
  return imageFromHtml(block, base);
}

function openGraphImage(html, base) {
  for (const tag of tagsOf(html, "meta")) {
    const prop = (attrValue(tag[1], "property") || attrValue(tag[1], "name")).toLowerCase();
    if (prop !== "og:image" && prop !== "twitter:image") continue;
    const rawUrl = attrValue(tag[1], "content");
    if (!rawUrl || rawUrl === "undefined" || rawUrl === "null") continue;
    const url = absoluteHttp(rawUrl, base);
    if (url) return url;
  }
  return "";
}

async function fillMissingImages(feed, fetchText) {
  if (!feed?.items?.length || feed.items.some((item) => item.image)) return feed;
  const targets = feed.items.filter((item) => item.link && !item.image).slice(0, 12);
  let cursor = 0;
  const worker = async () => {
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
  let feeds = discoverFeeds(first.body, pageUrl);
  if (!feeds.length) feeds = await probeCommonFeedPaths(pageUrl, fetchText);
  if (!feeds.length) throw fail(404, "No RSS or Atom feed was found.");
  if (feeds.length > 1) return { kind: "choices", pageUrl, feeds };
  const next = await fetchText(feeds[0].url);
  const feedUrl = next.finalUrl || feeds[0].url;
  if (!looksLikeFeed(next.body, next.contentType)) throw fail(404, "No RSS or Atom feed was found.");
  const feed = parseFeed(next.body, feedUrl);
  if (feed.title === "Untitled feed" && feeds[0].title) feed.title = feeds[0].title;
  return { kind: "feed", feed: await fillMissingImages(feed, fetchText) };
}

const COMMON_FEED_PATHS = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/index.rss",
  "/feeds/posts/default",
];

async function probeCommonFeedPaths(pageUrl, fetchText) {
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const found = [];
  const seen = new Set();
  for (const path of COMMON_FEED_PATHS) {
    const target = `${origin}${path}`;
    if (seen.has(target)) continue;
    seen.add(target);
    try {
      const next = await fetchText(target);
      const feedUrl = next.finalUrl || target;
      if (!looksLikeFeed(next.body, next.contentType)) continue;
      if (seen.has(feedUrl) && feedUrl !== target) continue;
      seen.add(feedUrl);
      found.push({
        url: feedUrl,
        title: "",
        type: next.contentType || "application/rss+xml",
      });
      if (found.length >= 3) break;
    } catch {
      // Try the next common path.
    }
  }
  return found;
}

export const RSS_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.1";
export const RSS_CONTENT_TYPE = /(^$|xml|rss|atom|html|text\/plain|octet-stream)/i;

export const FEED_TOPICS = [
  { id: "news", label: "News" },
  { id: "tech", label: "Tech" },
  { id: "apple", label: "Apple" },
  { id: "ai", label: "AI" },
  { id: "gaming", label: "Gaming" },
  { id: "science", label: "Science" },
  { id: "movies", label: "Movies" },
  { id: "business", label: "Business" },
  { id: "sports", label: "Sports" },
  { id: "politics", label: "Politics" },
  { id: "design", label: "Design" },
  { id: "evs", label: "EVs & Auto" },
  { id: "music", label: "Music" },
  { id: "photography", label: "Photography" },
];

export const FEED_CATALOG = [
  // News
  { id: "bbc-news", title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", site: "bbc.com", topics: ["news"], blurb: "World and UK headlines" },
  { id: "nyt-home", title: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", site: "nytimes.com", topics: ["news"], blurb: "Top stories and global reporting" },
  { id: "npr-news", title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", site: "npr.org", topics: ["news"], blurb: "US public radio headlines" },
  { id: "guardian-world", title: "The Guardian", url: "https://www.theguardian.com/world/rss", site: "theguardian.com", topics: ["news"], blurb: "Independent international news" },
  { id: "aljazeera", title: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", site: "aljazeera.com", topics: ["news"], blurb: "Global news coverage" },
  { id: "reuters", title: "Reuters", url: "https://www.reutersagency.com/feed/?best-topics=top-news", site: "reuters.com", topics: ["news"], blurb: "Breaking market and world news" },
  { id: "ap-news", title: "Associated Press", url: "https://apnews.com/rss", site: "apnews.com", topics: ["news"], blurb: "Unbiased wire headlines" },
  { id: "wapo", title: "Washington Post", url: "https://feeds.washingtonpost.com/rss/world", site: "washingtonpost.com", topics: ["news"], blurb: "World and national affairs" },
  { id: "politico", title: "Politico", url: "https://www.politico.com/rss/politicopicks.xml", site: "politico.com", topics: ["news", "politics"], blurb: "Political reporting and analysis" },
  { id: "axios", title: "Axios", url: "https://api.axios.com/feed/", site: "axios.com", topics: ["news"], blurb: "Smart brevity on world events" },
  { id: "vox", title: "Vox", url: "https://www.vox.com/rss/index.xml", site: "vox.com", topics: ["news"], blurb: "Explanatory journalism" },

  // Tech
  { id: "verge", title: "The Verge", url: "https://www.theverge.com/rss/index.xml", site: "theverge.com", topics: ["tech"], blurb: "Technology, science, and culture" },
  { id: "ars", title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", site: "arstechnica.com", topics: ["tech"], blurb: "Tech news and in-depth reviews" },
  { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", site: "news.ycombinator.com", topics: ["tech"], blurb: "Tech, startup, and developer links" },
  { id: "wired", title: "WIRED", url: "https://www.wired.com/feed/rss", site: "wired.com", topics: ["tech"], blurb: "Culture, science, and future tech" },
  { id: "engadget", title: "Engadget", url: "https://www.engadget.com/rss.xml", site: "engadget.com", topics: ["tech"], blurb: "Gadgets and consumer technology" },
  { id: "techcrunch", title: "TechCrunch", url: "https://techcrunch.com/feed/", site: "techcrunch.com", topics: ["tech"], blurb: "Startups, venture capital, and tech" },
  { id: "tomshardware", title: "Tom's Hardware", url: "https://www.tomshardware.com/feeds/all", site: "tomshardware.com", topics: ["tech"], blurb: "PC hardware news and testing" },
  { id: "github-blog", title: "GitHub Blog", url: "https://github.blog/feed/", site: "github.blog", topics: ["tech"], blurb: "Software updates and dev trends" },
  { id: "smashing", title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", site: "smashingmagazine.com", topics: ["tech", "design"], blurb: "Web design and development" },
  { id: "css-tricks", title: "CSS-Tricks", url: "https://css-tricks.com/feed/", site: "css-tricks.com", topics: ["tech", "design"], blurb: "Front-end tips and web development" },
  { id: "mkbhd", title: "Marques Brownlee", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ", site: "youtube.com", topics: ["tech"], blurb: "YouTube · Tech reviews with MKBHD" },
  { id: "ltt", title: "Linus Tech Tips", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw", site: "youtube.com", topics: ["tech"], blurb: "YouTube · Hardware and build projects" },

  // Apple
  { id: "macrumors", title: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All", site: "macrumors.com", topics: ["apple", "tech"], blurb: "Apple news, leaks, and rumors" },
  { id: "nineto5mac", title: "9to5Mac", url: "https://9to5mac.com/feed/", site: "9to5mac.com", topics: ["apple", "tech"], blurb: "Comprehensive Apple coverage" },
  { id: "daring-fireball", title: "Daring Fireball", url: "https://daringfireball.net/feeds/main", site: "daringfireball.net", topics: ["apple"], blurb: "John Gruber's commentary on Apple" },
  { id: "appleinsider", title: "AppleInsider", url: "https://appleinsider.com/rss/news", site: "appleinsider.com", topics: ["apple"], blurb: "Apple hardware and software news" },
  { id: "sixcolors", title: "Six Colors", url: "https://sixcolors.com/feed/", site: "sixcolors.com", topics: ["apple"], blurb: "Jason Snell on Apple and tech" },
  { id: "macstories", title: "MacStories", url: "https://www.macstories.net/feed/", site: "macstories.net", topics: ["apple"], blurb: "iOS, macOS apps and workflows" },

  // AI
  { id: "matt-wolfe", title: "Matt Wolfe", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UChpleBmo18P08aKCIgti38g", site: "youtube.com", topics: ["ai", "tech"], blurb: "YouTube · Latest AI tools and news" },
  { id: "openai", title: "OpenAI News", url: "https://openai.com/news/rss.xml", site: "openai.com", topics: ["ai"], blurb: "Official OpenAI research & product updates" },
  { id: "mit-ai", title: "MIT Tech Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", site: "technologyreview.com", topics: ["ai"], blurb: "Artificial intelligence reporting" },
  { id: "huggingface", title: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", site: "huggingface.co", topics: ["ai"], blurb: "Open source AI models and research" },
  { id: "google-ai", title: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", site: "blog.google", topics: ["ai"], blurb: "Google AI announcements" },
  { id: "deepmind", title: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", site: "deepmind.google", topics: ["ai"], blurb: "DeepMind research breakthroughs" },
  { id: "anthropic", title: "Anthropic News", url: "https://www.anthropic.com/feed.xml", site: "anthropic.com", topics: ["ai"], blurb: "Claude and AI safety research" },
  { id: "two-minute-papers", title: "Two Minute Papers", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg", site: "youtube.com", topics: ["ai", "science"], blurb: "YouTube · AI research papers summarized" },
  { id: "ai-explained", title: "AI Explained", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC98gO_5L3V2fthcZzN4-2vQ", site: "youtube.com", topics: ["ai"], blurb: "YouTube · In-depth AI analysis" },

  // Gaming
  { id: "polygon", title: "Polygon", url: "https://www.polygon.com/rss/index.xml", site: "polygon.com", topics: ["gaming"], blurb: "Games, entertainment, and gaming culture" },
  { id: "kotaku", title: "Kotaku", url: "https://kotaku.com/rss", site: "kotaku.com", topics: ["gaming"], blurb: "Video game news and reviews" },
  { id: "ign", title: "IGN", url: "https://feeds.ign.com/ign/games-all", site: "ign.com", topics: ["gaming"], blurb: "Video games, trailers, and reviews" },
  { id: "rps", title: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", site: "rockpapershotgun.com", topics: ["gaming"], blurb: "PC gaming news and indie games" },
  { id: "eurogamer", title: "Eurogamer", url: "https://www.eurogamer.net/feed", site: "eurogamer.net", topics: ["gaming"], blurb: "European video game news and reviews" },
  { id: "gamespot", title: "GameSpot", url: "https://www.gamespot.com/feeds/news/", site: "gamespot.com", topics: ["gaming"], blurb: "Gaming news, reviews, and walkthroughs" },
  { id: "nintendo-life", title: "Nintendo Life", url: "https://www.nintendolife.com/feeds/latest", site: "nintendolife.com", topics: ["gaming"], blurb: "Switch and Nintendo news" },

  // Science
  { id: "nasa", title: "NASA Breaking News", url: "https://www.nasa.gov/rss/dyn/breaking_news.rss", site: "nasa.gov", topics: ["science"], blurb: "Space exploration and astronomy" },
  { id: "sciencedaily", title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", site: "sciencedaily.com", topics: ["science"], blurb: "Research discoveries roundups" },
  { id: "guardian-science", title: "Guardian Science", url: "https://www.theguardian.com/science/rss", site: "theguardian.com", topics: ["science"], blurb: "Science reporting and discovery" },
  { id: "nature", title: "Nature Journal", url: "https://www.nature.com/nature.rss", site: "nature.com", topics: ["science"], blurb: "Peer-reviewed scientific highlights" },
  { id: "sci-american", title: "Scientific American", url: "https://www.scientificamerican.com/feed/", site: "scientificamerican.com", topics: ["science"], blurb: "Science, health, and technology" },
  { id: "newscientist", title: "New Scientist", url: "https://www.newscientist.com/feed/home", site: "newscientist.com", topics: ["science"], blurb: "Global science news" },
  { id: "space-com", title: "Space.com", url: "https://www.space.com/feeds/all", site: "space.com", topics: ["science"], blurb: "Astronomy, skywatching, and rockets" },
  { id: "kurzgesagt", title: "Kurzgesagt", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q", site: "youtube.com", topics: ["science"], blurb: "YouTube · Animated science videos" },
  { id: "veritasium", title: "Veritasium", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA", site: "youtube.com", topics: ["science"], blurb: "YouTube · Science experiments and ideas" },

  // Movies
  { id: "variety", title: "Variety", url: "https://variety.com/feed/", site: "variety.com", topics: ["movies"], blurb: "Hollywood film and TV entertainment" },
  { id: "indiewire", title: "IndieWire", url: "https://www.indiewire.com/feed/", site: "indiewire.com", topics: ["movies"], blurb: "Independent film and festival coverage" },
  { id: "ebert", title: "Roger Ebert", url: "https://www.rogerebert.com/feed", site: "rogerebert.com", topics: ["movies"], blurb: "Film reviews and essays" },
  { id: "thr", title: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/feed/", site: "hollywoodreporter.com", topics: ["movies"], blurb: "Film, TV, and streaming industry" },
  { id: "slashfilm", title: "SlashFilm", url: "https://www.slashfilm.com/feed/", site: "slashfilm.com", topics: ["movies"], blurb: "Movie trailers and film news" },
  { id: "deadline", title: "Deadline", url: "https://deadline.com/feed/", site: "deadline.com", topics: ["movies"], blurb: "Entertainment news and box office" },

  // Business
  { id: "bbc-business", title: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", site: "bbc.com", topics: ["business", "news"], blurb: "Global economics and business" },
  { id: "guardian-business", title: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss", site: "theguardian.com", topics: ["business"], blurb: "Markets and corporate news" },
  { id: "cnbc", title: "CNBC Top News", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", site: "cnbc.com", topics: ["business"], blurb: "Stock markets and financial news" },
  { id: "economist", title: "The Economist", url: "https://www.economist.com/finance-and-economics/rss.xml", site: "economist.com", topics: ["business"], blurb: "Finance and global economics" },
  { id: "coindesk", title: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", site: "coindesk.com", topics: ["business", "tech"], blurb: "Crypto and Web3 financial news" },

  // Sports
  { id: "bbc-sport", title: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", site: "bbc.com", topics: ["sports"], blurb: "Football, F1, and world sports" },
  { id: "guardian-sport", title: "Guardian Sport", url: "https://www.theguardian.com/sport/rss", site: "theguardian.com", topics: ["sports"], blurb: "Live match reporting and analysis" },
  { id: "espn", title: "ESPN News", url: "https://www.espn.com/espn/rss/news", site: "espn.com", topics: ["sports"], blurb: "American and global sports coverage" },
  { id: "sky-sports", title: "Sky Sports", url: "https://www.skysports.com/rss/12040", site: "skysports.com", topics: ["sports"], blurb: "Premier League and sports scores" },

  // Politics
  { id: "bbc-politics", title: "BBC Politics", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", site: "bbc.com", topics: ["politics", "news"], blurb: "UK and international politics" },
  { id: "nyt-politics", title: "NYT Politics", url: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", site: "nytimes.com", topics: ["politics", "news"], blurb: "US government and election coverage" },
  { id: "the-hill", title: "The Hill", url: "https://thehill.com/feed/", site: "thehill.com", topics: ["politics"], blurb: "Capitol Hill news" },

  // Design
  { id: "abduzeedo", title: "Abduzeedo", url: "https://abduzeedo.com/feed", site: "abduzeedo.com", topics: ["design"], blurb: "3D, typography, and visual design" },
  { id: "design-milk", title: "Design Milk", url: "https://design-milk.com/feed/", site: "design-milk.com", topics: ["design"], blurb: "Modern architecture, art, and interior design" },
  { id: "creative-bloq", title: "Creative Bloq", url: "https://www.creativebloq.com/feed", site: "creativebloq.com", topics: ["design"], blurb: "Art, graphic design, and 3D modeling" },

  // EVs & Auto
  { id: "electrek", title: "Electrek", url: "https://electrek.co/feed/", site: "electrek.co", topics: ["evs", "tech"], blurb: "Electric vehicles, Tesla, and green tech" },
  { id: "teslarati", title: "Teslarati", url: "https://www.teslarati.com/feed/", site: "teslarati.com", topics: ["evs", "tech"], blurb: "Tesla, SpaceX, and EV news" },
  { id: "insideevs", title: "InsideEVs", url: "https://insideevs.com/rss/news/all/", site: "insideevs.com", topics: ["evs"], blurb: "EV reviews and automotive news" },

  // Music
  { id: "pitchfork", title: "Pitchfork", url: "https://pitchfork.com/feed/feed-news/rss", site: "pitchfork.com", topics: ["music"], blurb: "Album reviews and music news" },
  { id: "nme", title: "NME", url: "https://www.nme.com/feed", site: "nme.com", topics: ["music"], blurb: "Music, film, and pop culture" },
  { id: "rick-beato", title: "Rick Beato", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCJquYFIaeaczoV8ctLG5nUg", site: "youtube.com", topics: ["music"], blurb: "YouTube · Music theory and song analysis" },

  // Photography
  { id: "petapixel", title: "PetaPixel", url: "https://petapixel.com/feed/", site: "petapixel.com", topics: ["photography", "tech"], blurb: "Photography news, gear reviews, camera tech, and tutorials" },
  { id: "dpreview", title: "DPReview", url: "https://www.dpreview.com/feeds/news.xml", site: "dpreview.com", topics: ["photography", "tech"], blurb: "Digital camera reviews, lens tests, and photography news" },
  { id: "fstoppers", title: "Fstoppers", url: "https://fstoppers.com/feed", site: "fstoppers.com", topics: ["photography"], blurb: "Photography community, lighting guides, and technique" },
  { id: "500px-iso", title: "500px ISO", url: "https://iso.500px.com/feed/", site: "500px.com", topics: ["photography"], blurb: "Photo stories, creative inspiration, and portrait galleries" },
  { id: "feature-shoot", title: "Feature Shoot", url: "https://www.featureshoot.com/feed/", site: "featureshoot.com", topics: ["photography"], blurb: "International contemporary photography and photo essays" },
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
  "matt-wolfe",
  "variety",
  "indiewire",
  "polygon",
  "ign",
  "nasa",
  "sciencedaily",
  "bbc-sport",
  "the-hill",
  "electrek",
  "pitchfork",
];

const SUBJECT_TO_TOPIC = {
  cybersecurity: "tech",
  security: "tech",
  hacking: "tech",
  gadgets: "tech",
  startups: "tech",
  gardening: "science",
  garden: "science",
  space: "science",
  astronomy: "science",
  climate: "science",
  "indie games": "gaming",
  games: "gaming",
  gaming: "gaming",
  film: "movies",
  cinema: "movies",
  hollywood: "movies",
  movies: "movies",
  finance: "business",
  markets: "business",
  business: "business",
  football: "sports",
  soccer: "sports",
  sports: "sports",
  politics: "politics",
  apple: "apple",
  ai: "ai",
  "artificial intelligence": "ai",
  news: "news",
  design: "design",
  ev: "evs",
  evs: "evs",
  cars: "evs",
  tesla: "evs",
  music: "music",
  photography: "photography",
  photo: "photography",
  photos: "photography",
  camera: "photography",
  cameras: "photography",
  photographer: "photography",
  photographers: "photography",
};

export function popularFeedCatalog() {
  const byId = new Map(FEED_CATALOG.map((feed) => [feed.id, feed]));
  return POPULAR_FEED_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function subjectTopicForQuery(query) {
  const text = String(query || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (SUBJECT_TO_TOPIC[text]) return SUBJECT_TO_TOPIC[text];
  const hit = Object.keys(SUBJECT_TO_TOPIC)
    .sort((a, b) => b.length - a.length)
    .find((alias) => text.includes(alias));
  return hit ? SUBJECT_TO_TOPIC[hit] : "";
}

function catalogScore(feed, words, popularRank) {
  const haystack = [feed.title, feed.site, feed.blurb, feed.url, ...(feed.topics || [])].join(" ").toLowerCase();
  let score = 0;
  words.forEach((word) => {
    if (feed.title.toLowerCase().includes(word)) score += 8;
    if ((feed.topics || []).some((topic) => topic.includes(word))) score += 5;
    if (haystack.includes(word)) score += 2;
  });
  if (popularRank >= 0) score += Math.max(0, 20 - popularRank);
  return score;
}

export function searchFeedCatalog({ query = "", topic = "" } = {}) {
  const selected = String(topic || "").trim().toLowerCase();
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const popularRank = new Map(POPULAR_FEED_IDS.map((id, index) => [id, index]));
  if (selected === "popular") {
    if (words.length) {
      const popularMatches = popularFeedCatalog().filter((feed) => {
        const haystack = [feed.title, feed.site, feed.blurb, ...feed.topics].join(" ").toLowerCase();
        return words.every((word) => haystack.includes(word));
      });
      if (popularMatches.length) return popularMatches;
    } else {
      return popularFeedCatalog();
    }
  }
  let mapped = "";
  let topicFilter = "";
  if (selected) {
    if (TOPIC_IDS.has(selected)) {
      topicFilter = selected;
    } else {
      mapped = subjectTopicForQuery(selected);
      if (mapped) {
        topicFilter = mapped;
      } else {
        words.push(...selected.split(/\s+/).filter(Boolean));
      }
    }
  } else if (words.length) {
    mapped = subjectTopicForQuery(query);
    if (mapped) topicFilter = mapped;
  }
  if (!topicFilter && !words.length) return [];
  const uniqueWords = Array.from(new Set(words));
  return FEED_CATALOG
    .filter((feed) => {
      if (topicFilter && !(feed.topics || []).includes(topicFilter)) return false;
      if (!uniqueWords.length) return true;
      const haystack = [feed.title, feed.site, feed.blurb, ...(feed.topics || [])].join(" ").toLowerCase();
      return uniqueWords.every((word) => haystack.includes(word));
    })
    .sort((a, b) => catalogScore(b, uniqueWords, popularRank.get(b.id) ?? 99) - catalogScore(a, uniqueWords, popularRank.get(a.id) ?? 99));
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
