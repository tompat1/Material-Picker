const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const RESULT_LIMIT = 12;

export async function searchVideos(query, source, fetchImpl = fetch) {
  const topic = String(query || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (topic.length < 2) {
    const error = new Error("Enter a topic, like gardening or ceramics.");
    error.status = 400;
    throw error;
  }
  const kind = source === "vimeo" || source === "web" ? source : "youtube";
  if (kind === "youtube") return youtubeSearch(topic, fetchImpl);
  if (kind === "vimeo") return videosFromDuckDuckGo(await duckDuckGo(`site:vimeo.com ${topic}`, fetchImpl), "vimeo");
  const pages = await Promise.all([
    duckDuckGo(`${topic} site:youtube.com/watch`, fetchImpl).catch(() => ""),
    duckDuckGo(`site:vimeo.com ${topic}`, fetchImpl).catch(() => ""),
  ]);
  const merged = [];
  const seen = new Set();
  for (const page of pages) {
    for (const item of videosFromDuckDuckGo(page, "web")) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= RESULT_LIMIT) return merged;
    }
  }
  if (merged.length < RESULT_LIMIT) {
    try {
      for (const item of await youtubeSearch(topic, fetchImpl)) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        merged.push(item);
        if (merged.length >= RESULT_LIMIT) break;
      }
    } catch (error) {
      if (!merged.length) throw error;
    }
  }
  return merged;
}

export function youtubeFromPayload(payload) {
  const found = [];
  const seen = new Set();
  walk(payload, (video) => {
    const id = String(video.videoId || "");
    if (!/^[\w-]{11}$/.test(id) || seen.has(id)) return;
    const title = runsText(video.title);
    if (!title) return;
    seen.add(id);
    found.push({
      title,
      speaker: runsText(video.ownerText) || runsText(video.longBylineText),
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: String(video.lengthText?.simpleText || ""),
      source: "youtube",
    });
  });
  return found.slice(0, RESULT_LIMIT);
}

export function videosFromDuckDuckGo(html, source) {
  const text = String(html || "");
  const found = [];
  const seen = new Set();
  const pattern = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const target = duckTarget(match[1]);
    if (!target || /ad_domain=|\/y\.js\?/i.test(target)) continue;
    const video = videoFromUrl(target);
    if (!video || seen.has(video.url)) continue;
    if (source === "vimeo" && video.source !== "vimeo") continue;
    seen.add(video.url);
    const cleaned = cleanResultTitle(decodeHtml(match[2].replace(/<[^>]+>/g, " ")));
    found.push({
      title: cleaned.title || video.url,
      speaker: cleaned.speaker,
      url: video.url,
      thumbnail: video.thumbnail || "",
      duration: "",
      source: video.source,
    });
    if (found.length >= RESULT_LIMIT) break;
  }
  return found;
}

async function youtubeSearch(topic, fetchImpl) {
  const response = await fetchImpl("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.youtube.com",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20250925.01.00", hl: "en" } },
      query: topic,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error("YouTube search is unavailable right now.");
    error.status = 502;
    throw error;
  }
  const payload = await response.json();
  return youtubeFromPayload(payload);
}

async function duckDuckGo(query, fetchImpl) {
  const response = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200) {
    const error = new Error("Web search is unavailable right now.");
    error.status = 502;
    throw error;
  }
  return response.text();
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer) visit(node.videoRenderer);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walk(value, visit);
  }
}

function runsText(node) {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText.trim();
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text || "").join("").trim();
  return "";
}

function duckTarget(href) {
  const decoded = String(href || "").replace(/&amp;/g, "&");
  const match = decoded.match(/[?&]uddg=([^&]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function videoFromUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    const id = host === "youtu.be"
      ? parsed.pathname.split("/").filter(Boolean)[0]
      : parsed.searchParams.get("v") || (parsed.pathname.startsWith("/embed/") ? parsed.pathname.split("/")[2] : "");
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    return {
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      source: "youtube",
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = host === "player.vimeo.com" && parts[0] === "video" && parts.length === 2
      ? parts[1]
      : host === "vimeo.com" && parts.length === 1
        ? parts[0]
        : "";
    if (!/^\d{5,}$/.test(id)) return null;
    return { url: `https://vimeo.com/${id}`, thumbnail: "", source: "vimeo" };
  }
  return null;
}

function cleanResultTitle(value) {
  let title = String(value || "").replace(/\s+/g, " ").trim();
  title = title.replace(/\s+\|\s+Videos(?:\s+&\s+Movies)?\s+on\s+Vimeo$/i, "");
  title = title.replace(/\s+on\s+Vimeo$/i, "");
  let speaker = "";
  const from = title.match(/^(.*?)\s+from\s+(.+)$/i);
  if (from) {
    title = from[1].trim();
    speaker = from[2].trim();
  }
  return { title, speaker };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
