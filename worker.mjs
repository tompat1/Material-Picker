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
  const durationSeconds = String(playlistText)
    .split(/\r?\n/)
    .reduce((total, line) => (line.startsWith("#EXTINF:") ? total + (Number.parseFloat(line.slice("#EXTINF:".length)) || 0) : total), 0);
  return { text: `${rewritten.join("\n")}\n`, files, durationSeconds };
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
    return {
      files: [{ path: "playlist.m3u8", text: media.text }, ...media.files],
      estimatedBytes: 0,
      durationSeconds: media.durationSeconds,
    };
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
  const bandwidth = Number(variant.attributes["AVERAGE-BANDWIDTH"] || variant.attributes.BANDWIDTH || 0);
  const durationSeconds = video.durationSeconds || 0;
  const estimatedBytes = bandwidth > 0 && durationSeconds > 0 ? Math.round((durationSeconds * bandwidth) / 8) : 0;
  return { files, estimatedBytes, durationSeconds };
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
  const planned = await planHlsDownload(sourceUrl, fetchImpl);
  return {
    provider,
    format: "hls",
    files: planned.files,
    estimatedBytes: planned.estimatedBytes,
    durationSeconds: planned.durationSeconds,
  };
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

export async function resolveOfflineSource(videoUrl, fetchImpl = fetch) {
  if (/vimeo\.com/i.test(videoUrl)) {
    const videoId = vimeoIdFromUrl(videoUrl);
    if (!videoId) throw fail(400, "This is not a supported Vimeo video URL.");
    const player = await fetchPublic(`https://player.vimeo.com/video/${videoId}`, fetchImpl, "text/html");
    if (!player.response.ok) throw fail(502, `Vimeo returned ${player.response.status}.`);
    const config = extractPlayerConfig(await readLimitedText(player.response));
    const progressive = [...(config.request?.files?.progressive || [])].sort((a, b) => Number(b.height) - Number(a.height));
    if (progressive[0]?.url) return { type: "file", url: progressive[0].url, provider: "Vimeo public download" };
    const hls = config.request?.files?.hls;
    const hlsUrl = hls?.cdns?.[hls.default_cdn]?.url || Object.values(hls?.cdns || {})[0]?.url;
    if (hlsUrl) return { type: "hls", url: hlsUrl, provider: "Vimeo public HLS" };
    throw fail(502, "Vimeo did not expose a public downloadable file or unencrypted stream.");
  }
  if (/\.m3u8([?#].*)?$/i.test(videoUrl)) return { type: "hls", url: videoUrl, provider: "Direct HLS" };
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)([?#].*)?$/i.test(videoUrl)) {
    return { type: "file", url: videoUrl, provider: "Direct file" };
  }
  throw fail(400, "Offline saving supports public Vimeo media, direct video files, and unencrypted HLS streams.");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parseVtt(vtt) {
  const cues = [];
  const blocks = String(vtt || "").replace(/^\uFEFF/, "").split(/\r?\n\r?\n+/);
  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0 || /^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0] || "")) return;
    const start = lines[timingIndex].split("-->")[0].trim();
    const text = decodeEntities(
      lines
        .slice(timingIndex + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (!text || text === cues.at(-1)?.text) return;
    cues.push({ start, text });
  });
  return cues;
}

function transcriptFromCues(cues) {
  return cues.map((cue) => `[${cue.start.replace(/\.\d+$/, "")}] ${cue.text}`).join("\n");
}

export async function getVimeoTranscript(videoUrl, language, fetchImpl = fetch) {
  const videoId = vimeoIdFromUrl(videoUrl);
  if (!videoId) throw fail(400, "This is not a supported Vimeo video URL.");
  const player = await fetchPublic(`https://player.vimeo.com/video/${videoId}`, fetchImpl, "text/html");
  if (!player.response.ok) throw fail(502, `Vimeo returned ${player.response.status}.`);
  const config = extractPlayerConfig(await readLimitedText(player.response));
  const tracks = config.request?.text_tracks || [];
  const requested = language === "auto" ? null : language;
  const track =
    tracks.find((item) => requested && item.lang?.toLowerCase().startsWith(requested.toLowerCase())) ||
    tracks.find((item) => item.default) ||
    tracks[0];
  if (!track?.url) throw fail(404, "This Vimeo video does not provide a public caption track.");

  const caption = await fetchPublic(track.url, fetchImpl, "text/vtt,text/plain,*/*");
  if (!caption.response.ok) throw fail(502, `Vimeo captions returned ${caption.response.status}.`);
  const vttText = await readLimitedText(caption.response);
  const cues = parseVtt(vttText);
  if (!cues.length) throw fail(404, "The caption track was empty.");
  return { cues, language: track.lang || language || "auto", label: track.label || "Captions" };
}

function splitTranslationText(text, maxLength = 3500) {
  const chunks = [];
  let current = "";
  String(text || "")
    .split(/(\n+)/)
    .forEach((part) => {
      if (current && current.length + part.length > maxLength) {
        chunks.push(current);
        current = "";
      }
      if (part.length <= maxLength) {
        current += part;
        return;
      }
      for (let index = 0; index < part.length; index += maxLength) {
        if (current) chunks.push(current);
        chunks.push(part.slice(index, index + maxLength));
        current = "";
      }
    });
  if (current) chunks.push(current);
  return chunks;
}

export async function translateText(text, sourceLanguage, targetLanguage, fetchImpl = fetch) {
  const translated = [];
  for (const chunk of splitTranslationText(text)) {
    const endpoint = new URL("https://translate.googleapis.com/translate_a/single");
    endpoint.searchParams.set("client", "gtx");
    endpoint.searchParams.set("sl", sourceLanguage || "auto");
    endpoint.searchParams.set("tl", targetLanguage);
    endpoint.searchParams.set("dt", "t");
    endpoint.searchParams.set("q", chunk);
    const response = await fetchImpl(endpoint, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
    });
    if (!response.ok) throw fail(502, `The translation service returned ${response.status}.`);
    const payload = JSON.parse(await readLimitedText(response));
    translated.push((payload[0] || []).map((segment) => segment[0] || "").join(""));
  }
  return translated.join("");
}

const NON_SPEAKER_LABELS = new Set([
  "note",
  "warning",
  "important",
  "caution",
  "tip",
  "example",
  "for example",
  "chapter",
  "part",
  "section",
  "ps",
  "p.s",
  "definition",
  "conclusion",
  "summary",
  "time",
  "date",
  "source",
  "http",
  "https",
]);

export function proofreadText(text, language = "en", options = {}) {
  if (!text) return "";
  const removeTimestamps = options.removeTimestamps !== false;
  const deduplicateSpeakers = options.deduplicateSpeakers !== false;

  const lines = String(text).split(/\r?\n/);
  let currentSpeaker = "";
  const processedLines = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    let timestampPrefix = "";
    const timestampMatch = line.match(/^(\[\s*\d{1,2}(?::\d{2}){1,2}(?:\.\d+)?\s*\]\s*)/);
    if (timestampMatch) {
      if (!removeTimestamps) {
        timestampPrefix = timestampMatch[1];
      }
      line = line.slice(timestampMatch[0].length).trim();
    } else if (removeTimestamps) {
      line = line.replace(/\[\s*\d{1,2}(?::\d{2}){1,2}(?:\.\d+)?\s*\]\s*/g, "").trim();
    }

    if (!line) continue;

    let speakerPrefix = "";
    if (deduplicateSpeakers) {
      const speakerMatch = line.match(/^\[?([A-Z\p{Lu}][\p{L}\p{N}\s.,'()\-#]{0,50}?)\]?:\s*(.*)$/u);
      if (speakerMatch && !NON_SPEAKER_LABELS.has(speakerMatch[1].trim().toLowerCase())) {
        const speaker = speakerMatch[1].trim().replace(/^\[|\]$/g, "");
        const restOfLine = speakerMatch[2].trim();

        if (speaker.toLowerCase() === currentSpeaker.toLowerCase()) {
          line = restOfLine;
        } else {
          currentSpeaker = speaker;
          speakerPrefix = `${speaker}: `;
          line = restOfLine;
        }
      }
    }

    let cleaned = line
      .replace(/\b(um|uh|er|erm|ah|umm|uhh)\b/gi, "")
      .replace(/\b(yyy|eee|ymm)\b/gi, "")
      .replace(/\b(äh|ehm)\b/gi, "")
      .replace(/\b(euh)\b/gi, "")
      .replace(/\b(you know|wiesz|tu sais|weißt du)\b(?=[,\s]|$)/gi, "")
      .replace(/\b(like|liksom|jakby)\b(?=[,\s]+(you|we|they|he|she|it|I|to|the|that|a|an)\b)/gi, "");

    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, "$1");
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, "$1");

    cleaned = cleaned
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/([.!?])([A-Za-z\p{L}])/gu, "$1 $2")
      .trim();

    if (!cleaned && !speakerPrefix) continue;

    if (cleaned) {
      cleaned = cleaned
        .split(/(?<=[.!?]\s+)/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    }

    const finalLine = `${timestampPrefix}${speakerPrefix}${cleaned}`.trim();
    if (finalLine) {
      processedLines.push(finalLine);
    }
  }

  return processedLines.join("\n");
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
  if (request.method === "GET" && url.pathname === "/api/transcript") {
    const target = url.searchParams.get("url");
    const language = url.searchParams.get("language") || "auto";
    if (!target) return json(400, { error: "A video URL is required." });
    try {
      const transcript = await getVimeoTranscript(target, language, fetchImpl);
      return json(200, {
        text: transcriptFromCues(transcript.cues),
        cueCount: transcript.cues.length,
        language: transcript.language,
        label: transcript.label,
        source: "provider-captions",
      });
    } catch (error) {
      return json(error.status || 404, { error: error.message || "A transcript could not be loaded." });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/stream") {
    const target = url.searchParams.get("url");
    if (!target) return json(400, { error: "A video URL is required." });
    try {
      const source = await resolveOfflineSource(target, fetchImpl);
      return json(200, {
        url: source.url,
        type: source.type,
        provider: source.provider,
      });
    } catch (error) {
      return json(error.status || 404, { error: error.message || "A stream could not be resolved." });
    }
  }
  if (request.method === "POST" && url.pathname === "/api/translate") {
    try {
      const body = await request.json().catch(() => ({}));
      const text = String(body.text || "").trim();
      const sourceLanguage = String(body.sourceLanguage || "auto").toLowerCase();
      const targetLanguage = String(body.targetLanguage || "").toLowerCase();
      if (!text) return json(400, { error: "Transcript text is required." });
      if (!/^(auto|[a-z]{2,3})$/.test(sourceLanguage) || !/^[a-z]{2,3}$/.test(targetLanguage)) {
        return json(400, { error: "The selected language is not supported." });
      }
      const translation = await translateText(text, sourceLanguage, targetLanguage, fetchImpl);
      return json(200, { translation, service: "Google Translate" });
    } catch (error) {
      return json(502, { error: error.message || "Translation failed." });
    }
  }
  if (request.method === "POST" && url.pathname === "/api/proofread") {
    try {
      const body = await request.json().catch(() => ({}));
      const text = String(body.text || "").trim();
      if (!text) return json(400, { error: "Text is required to proofread." });
      const language = String(body.language || "en").toLowerCase();
      const options = {
        removeTimestamps: body.removeTimestamps !== false,
        deduplicateSpeakers: body.deduplicateSpeakers !== false,
      };
      const proofread = proofreadText(text, language, options);
      return json(200, { proofread, original: text });
    } catch (error) {
      return json(500, { error: error.message || "Proofreading failed." });
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
