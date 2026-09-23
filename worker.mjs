const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPublicIp(address) {
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicIp(mapped[1]);
  if (address.includes(":")) return true;

  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function assertPageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail(400, "The page URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail(400, "Only HTTP and HTTPS page URLs are allowed.");
  }
  if (url.username || url.password) throw fail(400, "URLs containing credentials are not allowed.");

  const host = url.hostname.toLowerCase();
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal";
  if (blockedName || (looksLikeIp(host) && !isPublicIp(host))) {
    throw fail(400, "Local and private network addresses are not allowed.");
  }
  return url;
}

function looksLikeIp(host) {
  return host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

async function readLimitedText(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PAGE_BYTES) throw fail(502, "The response is larger than the allowed limit.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw fail(502, "The response is larger than the allowed limit.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(merged);
}

async function fetchPage(value, fetchImpl, redirects = 0) {
  const url = assertPageUrl(value);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain",
      "User-Agent": BROWSER_USER_AGENT,
    },
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= MAX_REDIRECTS) throw fail(502, "The page redirected too many times.");
    const next = new URL(response.headers.get("location"), url).href;
    return fetchPage(next, fetchImpl, redirects + 1);
  }
  if (!response.ok) throw fail(502, `The page returned ${response.status}.`);

  const contentType = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw fail(502, "The URL returned an unsupported content type.");
  }
  const body = await readLimitedText(response);
  return { body, finalUrl: url.href, challenged: isBotChallenge(body) };
}

function isBotChallenge(html) {
  return /sgcaptcha|Robot Challenge Screen|cf-browser-verification|Just a moment/i.test(html);
}

async function renderPage(browser, url) {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw fail(502, `The page's bot check could not be completed (${response.status}). ${detail}`.trim());
  }
  const contentType = response.headers.get("content-type") || "";
  const html = contentType.includes("json") ? await htmlFromBrowserJson(response) : await readLimitedText(response);
  if (isBotChallenge(html)) {
    throw fail(502, "The site's bot check blocked the scan. Paste the page HTML below instead.");
  }
  return html;
}

async function htmlFromBrowserJson(response) {
  const data = JSON.parse(await readLimitedText(response));
  if (!data?.success || typeof data.result !== "string") {
    throw fail(502, "The page's bot check could not be completed.");
  }
  if (data.result.length > MAX_PAGE_BYTES) throw fail(502, "The response is larger than the allowed limit.");
  return data.result;
}

function parseHlsAttributes(value) {
  const attributes = {};
  const pattern = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return attributes;
}

function replaceHlsAttribute(line, name, value) {
  const pattern = new RegExp(`${name}=(?:"[^"]*"|[^,]*)`, "i");
  const replacement = `${name}="${value}"`;
  return pattern.test(line) ? line.replace(pattern, replacement) : `${line},${replacement}`;
}

function removeHlsAttribute(line, name) {
  const value = `${name}=(?:"[^"]*"|[^,]*)`;
  return String(line || "")
    .replace(new RegExp(`,${value}`, "gi"), "")
    .replace(new RegExp(`${value},?`, "gi"), "");
}

function selectHlsVariant(manifest, maxHeight = 1080) {
  const lines = String(manifest || "").split(/\r?\n/);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue;
    const uriIndex = lines.findIndex((line, candidate) => candidate > index && line.trim() && !line.startsWith("#"));
    if (uriIndex < 0) continue;
    const attributes = parseHlsAttributes(lines[index].slice("#EXT-X-STREAM-INF:".length));
    const height = Number((attributes.RESOLUTION || "x0").split("x")[1] || 0);
    const bandwidth = Number(attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH || 0);
    variants.push({ attributes, bandwidth, height, infoLine: lines[index], uri: lines[uriIndex].trim() });
  }
  if (!variants.length) return null;
  const compatible = variants.filter((variant) => variant.height <= maxHeight || variant.height === 0);
  return (compatible.length ? compatible : variants).sort(
    (left, right) => right.height - left.height || right.bandwidth - left.bandwidth
  )[0];
}

function assertUnencryptedHls(manifest) {
  const protectedTag = String(manifest || "")
    .split(/\r?\n/)
    .find((line) => /^#EXT-X-(?:SESSION-)?KEY:/i.test(line) && !/METHOD=NONE(?:,|$)/i.test(line));
  if (protectedTag) throw fail(502, "This stream is encrypted or DRM-protected and cannot be saved by Material Picker.");
}

function localMediaName(remoteUrl, index) {
  let extension = ".bin";
  try {
    const pathname = new URL(remoteUrl).pathname;
    const candidate = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(candidate)) extension = candidate;
  } catch {
    // Keep the generic extension.
  }
  return `${String(index).padStart(5, "0")}${extension}`;
}

function joinPlanPath(directory, name) {
  return directory ? `${directory}/${name}` : name;
}

async function fetchPublic(value, fetchImpl, accept) {
  let current = assertPageUrl(value).href;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current, {
      headers: { Accept: accept, "User-Agent": BROWSER_USER_AGENT },
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirects === MAX_REDIRECTS) throw fail(502, "The media redirected too many times.");
      current = assertPageUrl(new URL(response.headers.get("location"), current).href).href;
      continue;
    }
    return { response, finalUrl: current };
  }
  throw fail(502, "The media redirected too many times.");
}

function extractPlayerConfig(html) {
  const marker = "window.playerConfig = ";
  const start = String(html || "").indexOf(marker);
  const end = String(html || "").indexOf("</script>", start);
  if (start < 0 || end < 0) throw fail(502, "Vimeo did not expose a player configuration.");
  const json = String(html)
    .slice(start + marker.length, end)
    .trim()
    .replace(/;\s*$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw fail(502, "Vimeo returned an unreadable player configuration.");
  }
}

function vimeoIdFromUrl(value) {
  const url = assertPageUrl(value);
  if (!url.hostname.endsWith("vimeo.com")) return "";
  return url.pathname.split("/").find((part) => /^\d+$/.test(part)) || "";
}

function planMediaPlaylist(playlistText, playlistUrl, directory) {
  assertUnencryptedHls(playlistText);
  if (selectHlsVariant(playlistText)) throw fail(502, "The selected HLS variant contained another master playlist.");
  const remoteFiles = new Map();
  const files = [];
  const register = (rawUrl) => {
    const absolute = new URL(rawUrl, playlistUrl).href;
    if (!remoteFiles.has(absolute)) {
      const relative = `segments/${localMediaName(absolute, remoteFiles.size)}`;
      remoteFiles.set(absolute, relative);
      files.push({ path: joinPlanPath(directory, relative), url: absolute });
    }
    return remoteFiles.get(absolute);
  };
  const rewritten = String(playlistText)
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("#EXT-X-MAP:")) {
        const attributes = parseHlsAttributes(line.slice("#EXT-X-MAP:".length));
        if (!attributes.URI) return line;
        return replaceHlsAttribute(line, "URI", register(attributes.URI));
      }
      if (!line.trim() || line.startsWith("#")) return line;
      return register(line.trim());
    });
  return { text: `${rewritten.join("\n")}\n`, files };
}

async function fetchPlaylistText(url, fetchImpl) {
  const { response, finalUrl } = await fetchPublic(
    url,
    fetchImpl,
    "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"
  );
  if (!response.ok) throw fail(502, `The media server returned ${response.status}.`);
  return { text: await readLimitedText(response), finalUrl };
}

async function planHlsDownload(sourceUrl, fetchImpl) {
  const master = await fetchPlaylistText(sourceUrl, fetchImpl);
  assertUnencryptedHls(master.text);
  const variant = selectHlsVariant(master.text);
  if (!variant) {
    const media = planMediaPlaylist(master.text, master.finalUrl, "");
    return [{ path: "playlist.m3u8", text: media.text }, ...media.files];
  }

  const files = [];
  const videoPlaylist = await fetchPlaylistText(new URL(variant.uri, master.finalUrl).href, fetchImpl);
  const video = planMediaPlaylist(videoPlaylist.text, videoPlaylist.finalUrl, "video");
  files.push({ path: "video/playlist.m3u8", text: video.text }, ...video.files);

  const masterLines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  const audioGroup = variant.attributes.AUDIO;
  if (audioGroup) {
    const audioLine = master.text.split(/\r?\n/).find((line) => {
      if (!line.startsWith("#EXT-X-MEDIA:")) return false;
      const attributes = parseHlsAttributes(line.slice("#EXT-X-MEDIA:".length));
      return attributes.TYPE === "AUDIO" && attributes["GROUP-ID"] === audioGroup && attributes.URI;
    });
    if (audioLine) {
      const audioAttributes = parseHlsAttributes(audioLine.slice("#EXT-X-MEDIA:".length));
      const audioPlaylist = await fetchPlaylistText(new URL(audioAttributes.URI, master.finalUrl).href, fetchImpl);
      const audio = planMediaPlaylist(audioPlaylist.text, audioPlaylist.finalUrl, "audio");
      files.push({ path: "audio/playlist.m3u8", text: audio.text }, ...audio.files);
      masterLines.push(replaceHlsAttribute(audioLine, "URI", "audio/playlist.m3u8"));
    }
  }
  const infoLine = removeHlsAttribute(removeHlsAttribute(variant.infoLine, "SUBTITLES"), "CLOSED-CAPTIONS");
  masterLines.push(infoLine, "video/playlist.m3u8");
  files.unshift({ path: "master.m3u8", text: `${masterLines.join("\n")}\n` });
  return files;
}

export async function buildDownloadPlan(pageUrl, fetchImpl = fetch) {
  assertPageUrl(pageUrl);
  let sourceUrl = pageUrl;
  let provider = "Direct file";
  let type = "file";
  if (/vimeo\.com/i.test(pageUrl)) {
    const videoId = vimeoIdFromUrl(pageUrl);
    if (!videoId) throw fail(400, "This is not a supported Vimeo video URL.");
    const player = await fetchPublic(`https://player.vimeo.com/video/${videoId}`, fetchImpl, "text/html");
    if (!player.response.ok) throw fail(502, `Vimeo returned ${player.response.status}.`);
    const config = extractPlayerConfig(await readLimitedText(player.response));
    const progressive = [...(config.request?.files?.progressive || [])].sort(
      (left, right) => Number(right.height) - Number(left.height)
    );
    if (progressive[0]?.url) {
      sourceUrl = progressive[0].url;
      provider = "Vimeo public download";
    } else {
      const hls = config.request?.files?.hls;
      sourceUrl = hls?.cdns?.[hls.default_cdn]?.url || Object.values(hls?.cdns || {})[0]?.url;
      if (!sourceUrl) throw fail(502, "Vimeo did not expose a public downloadable file or unencrypted stream.");
      provider = "Vimeo public HLS";
      type = "hls";
    }
  } else if (/\.m3u8(?:[?#].*)?$/i.test(pageUrl)) {
    provider = "Direct HLS";
    type = "hls";
  } else if (!/\.(?:mp4|webm|ogv|ogg|mov|m4v)(?:[?#].*)?$/i.test(pageUrl)) {
    throw fail(400, "Offline saving supports public Vimeo media, direct video files, and unencrypted HLS streams.");
  }

  if (type === "file") {
    const pathname = new URL(sourceUrl).pathname;
    const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ".mp4";
    return { provider, format: "file", files: [{ path: `video${safeExtension}`, url: sourceUrl }] };
  }
  return { provider, format: "hls", files: await planHlsDownload(sourceUrl, fetchImpl) };
}

export async function proxyMedia(target, fetchImpl = fetch) {
  const { response } = await fetchPublic(target, fetchImpl, "*/*");
  if (!response.ok) return json(502, { error: `The media server returned ${response.status}.` });
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (/text\/html|application\/json/i.test(contentType)) {
    return json(502, { error: "The media URL returned a web page instead of video data." });
  }
  const headers = { "Content-Type": contentType, "Cache-Control": "no-store" };
  const length = response.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  return new Response(response.body, { status: 200, headers });
}

export async function handleApiRequest(request, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/offline/library") {
    return json(200, { videos: [], storagePath: "" });
  }
  if (request.method === "GET" && url.pathname === "/api/media-plan") {
    const target = url.searchParams.get("url");
    if (!target) return json(400, { error: "A video URL is required." });
    try {
      return json(200, await buildDownloadPlan(target, fetchImpl));
    } catch (error) {
      return json(error.status || 502, { error: error.message || "The video could not be prepared for download." });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/media-proxy") {
    const target = url.searchParams.get("url");
    if (!target) return json(400, { error: "A media URL is required." });
    try {
      return await proxyMedia(target, fetchImpl);
    } catch (error) {
      return json(error.status || 502, { error: error.message || "The media file could not be downloaded." });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/scrape") {
    const target = url.searchParams.get("url");
    if (!target) return json(400, { error: "A page URL is required." });
    try {
      const page = await fetchPage(target, fetchImpl);
      if (!page.challenged) return json(200, { html: page.body, finalUrl: page.finalUrl });
      if (!dependencies.renderPage) {
        throw fail(502, "The site's bot check blocked the scan. Paste the page HTML below instead.");
      }
      const html = await dependencies.renderPage(page.finalUrl);
      return json(200, { html, finalUrl: page.finalUrl });
    } catch (error) {
      return json(error.status || 502, { error: error.message || "The page could not be scanned." });
    }
  }
  return json(404, { error: "This API is only available in the local app." });
}

export default {
  async fetch(request, env) {
    return handleApiRequest(request, {
      renderPage: env?.BROWSER ? (url) => renderPage(env.BROWSER, url) : null,
    });
  },
};
