const { execFile } = require("node:child_process");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const fsp = fs.promises;
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function loadEnvFile(filePath) {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator < 1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile(path.join(__dirname, ".env"));

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, "public");
const DATA_ROOT = path.join(ROOT, "data");
const VIDEO_ROOT = path.join(DATA_ROOT, "videos");
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSLATION_BYTES = 300 * 1024;
const MAX_REDIRECTS = 5;
const PORT = Number(process.env.PORT || 4173);
const IS_DEV = process.env.NODE_ENV !== "production";
const STATIC_CACHE_CONTROL = IS_DEV ? "no-store, must-revalidate" : "no-cache";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const offlineJobs = new Map();

const CONTENT_TYPES = {
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".css": "text/css; charset=utf-8",
  ".flv": "video/x-flv",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".m4v": "video/mp4",
  ".map": "application/json; charset=utf-8",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
  ".svg": "image/svg+xml",
  ".ts": "video/mp2t",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
};

const SUPPORTED_VIDEO_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES).filter((ext) => ext !== ".css" && ext !== ".html" && ext !== ".js" && ext !== ".json" && ext !== ".map" && ext !== ".svg"));
const STANDALONE_VIDEO_EXTENSIONS = new Set(Array.from(SUPPORTED_VIDEO_EXTENSIONS).filter((ext) => ext !== ".m4s" && ext !== ".m3u8"));

function isPublicIp(address) {
  if (!net.isIP(address)) return false;
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicIp(mapped[1]);
  if (net.isIPv6(address)) return true;

  const [a, b] = address.split(".").map(Number);
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

async function validateRemoteUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP and HTTPS page URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Local and private network addresses are not allowed.");
  }
  return url;
}

async function fetchRemoteText(
  value,
  {
    accept = "text/plain",
    contentTypePattern = /text\//i,
    maxBytes = MAX_PAGE_BYTES,
    redirects = 0,
  } = {}
) {
  const url = await validateRemoteUrl(value);
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": BROWSER_USER_AGENT },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });

  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= MAX_REDIRECTS) throw new Error("The page redirected too many times.");
    return fetchRemoteText(new URL(response.headers.get("location"), url).href, {
      accept,
      contentTypePattern,
      maxBytes,
      redirects: redirects + 1,
    });
  }
  if (!response.ok) throw new Error(`The page returned ${response.status}.`);

  const contentType = response.headers.get("content-type") || "";
  if (!contentTypePattern.test(contentType)) {
    throw new Error("The URL returned an unsupported content type.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("The response is larger than the allowed limit.");

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("The response is larger than the allowed limit.");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return { body, finalUrl: url.href, contentType };
}

async function fetchPage(value) {
  return fetchRemoteText(value, {
    accept: "text/html,application/xhtml+xml,text/plain",
    contentTypePattern: /text\/html|application\/xhtml\+xml|text\/plain/i,
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(data));
}

async function handleOpml(request, response) {
  try {
    const xml = await readRequestBody(request);
    const { parseOpml } = await import("./rss.mjs");
    const text = Buffer.isBuffer(xml) ? xml.toString("utf8") : String(xml || "");
    return sendJson(response, 200, { feeds: parseOpml(text) });
  } catch (error) {
    return sendJson(response, error.status || 400, { error: error.message || "That OPML file could not be read." });
  }
}

async function handleRssCatalog(response, requestUrl) {
  const { FEED_TOPICS, searchFeedCatalog } = await import("./rss.mjs");
  return sendJson(response, 200, {
    topics: FEED_TOPICS,
    feeds: searchFeedCatalog({
      query: requestUrl.searchParams.get("q") || "",
      topic: requestUrl.searchParams.get("topic") || "",
    }),
  });
}

async function handleRss(response, requestUrl) {
  const target = requestUrl.searchParams.get("url");
  if (!target) return sendJson(response, 400, { error: "A feed or page URL is required." });
  try {
    const { loadFeed, RSS_ACCEPT, RSS_CONTENT_TYPE } = await import("./rss.mjs");
    const result = await loadFeed(target, (value) => fetchRemoteText(value, {
      accept: RSS_ACCEPT,
      contentTypePattern: RSS_CONTENT_TYPE,
    }));
    return sendJson(response, 200, result);
  } catch (error) {
    const message = error.message || "The feed could not be loaded.";
    const blocked = error instanceof TypeError || /private|credential|not valid|Only HTTP|not allowed/i.test(message);
    return sendJson(response, error.status || (blocked ? 400 : 502), { error: message });
  }
}

async function handleVideoSearch(response, requestUrl) {
  try {
    const { searchVideos, videoFeed } = await import("./video-search.mjs");
    const feed = requestUrl.searchParams.get("feed");
    const results = feed
      ? await videoFeed(feed, fetch)
      : await searchVideos(requestUrl.searchParams.get("q"), requestUrl.searchParams.get("source"), fetch);
    return sendJson(response, 200, { results });
  } catch (error) {
    return sendJson(response, error.status || 502, { error: error.message || "The search could not be completed." });
  }
}

async function handleScrape(request, response, requestUrl) {
  const target = requestUrl.searchParams.get("url");
  if (!target) return sendJson(response, 400, { error: "A page URL is required." });
  try {
    const page = await fetchPage(target);
    return sendJson(response, 200, { html: page.body, finalUrl: page.finalUrl });
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 502;
    return sendJson(response, status, { error: error.message || "The page could not be scanned." });
  }
}

function vimeoIdFromUrl(value) {
  const url = new URL(value);
  if (!url.hostname.endsWith("vimeo.com")) return "";
  return url.pathname.split("/").find((part) => /^\d+$/.test(part)) || "";
}

function extractPlayerConfig(html) {
  const marker = "window.playerConfig = ";
  const start = String(html || "").indexOf(marker);
  const end = String(html || "").indexOf("</script>", start);
  if (start < 0 || end < 0) throw new Error("Vimeo did not expose a player configuration.");
  const json = String(html || "")
    .slice(start + marker.length, end)
    .trim()
    .replace(/;\s*$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Vimeo returned an unreadable player configuration.");
  }
}

async function getVimeoPlayerConfig(videoUrl) {
  const videoId = vimeoIdFromUrl(videoUrl);
  if (!videoId) throw new Error("This is not a supported Vimeo video URL.");
  const player = await fetchRemoteText(`https://player.vimeo.com/video/${videoId}`, {
    accept: "text/html",
    contentTypePattern: /text\/html/i,
  });
  return extractPlayerConfig(player.body);
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

async function getVimeoTranscript(videoUrl, language) {
  const config = await getVimeoPlayerConfig(videoUrl);
  const tracks = config.request?.text_tracks || [];
  const requested = language === "auto" ? null : language;
  const track =
    tracks.find((item) => requested && item.lang?.toLowerCase().startsWith(requested.toLowerCase())) ||
    tracks.find((item) => item.default) ||
    tracks[0];
  if (!track?.url) throw new Error("This Vimeo video does not provide a public caption track.");

  const caption = await fetchRemoteText(track.url, {
    accept: "text/vtt,text/plain",
    contentTypePattern: /text\/vtt|text\/plain|application\/octet-stream/i,
  });
  const cues = parseVtt(caption.body);
  if (!cues.length) throw new Error("The caption track was empty.");
  return { cues, language: track.lang || language || "auto", label: track.label || "Captions" };
}

async function handleChapters(response, requestUrl) {
  const videoUrl = requestUrl.searchParams.get("url");
  if (!videoUrl) return sendJson(response, 400, { error: "A video URL is required." });
  try {
    const { fetchVideoChapters } = await import("./video-chapters.mjs");
    const result = await fetchVideoChapters(videoUrl, fetch);
    return sendJson(response, 200, result);
  } catch (error) {
    return sendJson(response, error.status || 502, { error: error.message || "Chapters could not be loaded." });
  }
}

async function handleTranscript(response, requestUrl) {
  const videoUrl = requestUrl.searchParams.get("url");
  const language = requestUrl.searchParams.get("language") || "auto";
  if (!videoUrl) return sendJson(response, 400, { error: "A video URL is required." });
  try {
    const transcript = await getVimeoTranscript(videoUrl, language);
    return sendJson(response, 200, {
      text: transcriptFromCues(transcript.cues),
      cueCount: transcript.cues.length,
      language: transcript.language,
      label: transcript.label,
      source: "provider-captions",
    });
  } catch (error) {
    return sendJson(response, 404, { error: error.message || "A transcript could not be loaded." });
  }
}

async function handleStream(response, requestUrl) {
  const videoUrl = requestUrl.searchParams.get("url");
  if (!videoUrl) return sendJson(response, 400, { error: "A video URL is required." });
  try {
    const source = await resolveOfflineSource(videoUrl);
    return sendJson(response, 200, {
      url: source.url,
      type: source.type,
      provider: source.provider,
    });
  } catch (error) {
    return sendJson(response, 404, { error: error.message || "A stream could not be resolved." });
  }
}

function readJsonBody(request, maxBytes = MAX_TRANSLATION_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("The request payload is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("The request was not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

let whisperPipelinePromise = null;

async function getWhisperPipeline() {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = (async () => {
      const { pipeline } = require("@xenova/transformers");
      return pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
        quantized: true,
      });
    })().catch((error) => {
      whisperPipelinePromise = null;
      throw error;
    });
  }
  return whisperPipelinePromise;
}

function pcmBufferToFloat32(pcm) {
  const evenLength = pcm.length - (pcm.length % 2);
  const samples = new Float32Array(evenLength / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

const WHISPER_LANGUAGES = {
  auto: null,
  en: "english",
  pl: "polish",
  de: "german",
  es: "spanish",
  fr: "french",
  it: "italian",
  pt: "portuguese",
  sv: "swedish",
};

async function handleTranscribe(request, response) {
  try {
    const body = await readJsonBody(request, 10 * 1024 * 1024);
    let floatSamples = null;

    if (body.pcmBase64) {
      floatSamples = pcmBufferToFloat32(Buffer.from(body.pcmBase64, "base64"));
    } else if (Array.isArray(body.samples)) {
      floatSamples = new Float32Array(body.samples);
    }

    if (!floatSamples || floatSamples.length === 0) {
      return sendJson(response, 400, { error: "Audio samples are required." });
    }

    let sumSquares = 0;
    for (let i = 0; i < floatSamples.length; i++) {
      sumSquares += floatSamples[i] * floatSamples[i];
    }
    const rms = Math.sqrt(sumSquares / floatSamples.length);
    if (rms < 0.005) {
      return sendJson(response, 200, {
        text: "",
        isSilent: true,
        timestamp: body.currentTime || 0,
      });
    }

    const transcriber = await getWhisperPipeline();
    const sourceLang = String(body.language || "auto").toLowerCase();
    const whisperLang = WHISPER_LANGUAGES[sourceLang] || null;

    const options = { task: "transcribe" };
    if (whisperLang) {
      options.language = whisperLang;
    }

    const result = await transcriber(floatSamples, options);
    let text = String(result?.text || "").trim();

    if (/^\[(?:blank_audio|applause|laughter|noise|\s*)\]$/i.test(text)) {
      text = "";
    }

    return sendJson(response, 200, {
      text,
      language: sourceLang,
      timestamp: body.currentTime || 0,
      service: "Whisper (local)",
    });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Transcription failed." });
  }
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

function proofreadText(text, language = "en", options = {}) {
  if (!text) return "";
  const removeTimestamps = options.removeTimestamps !== false;
  const deduplicateSpeakers = options.deduplicateSpeakers !== false;
  const addLineBreaks = options.addLineBreaks !== false;

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

    let sentences = [];
    if (cleaned) {
      sentences = cleaned
        .split(/(?<=[.!?]\s+)/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    }

    if (addLineBreaks && sentences.length > 2) {
      let currentGroup = [];
      let currentLength = 0;

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        currentGroup.push(sentence);
        currentLength += sentence.length;

        if (
          currentGroup.length >= 3 ||
          (currentLength >= 250 && currentGroup.length >= 2) ||
          i === sentences.length - 1
        ) {
          const groupText = currentGroup.join(" ");
          const prefix = i - currentGroup.length + 1 === 0 ? `${timestampPrefix}${speakerPrefix}` : "";
          const lineStr = `${prefix}${groupText}`.trim();
          if (lineStr) processedLines.push(lineStr);
          currentGroup = [];
          currentLength = 0;
        }
      }
    } else {
      const lineText = sentences.join(" ");
      const finalLine = `${timestampPrefix}${speakerPrefix}${lineText}`.trim();
      if (finalLine) {
        processedLines.push(finalLine);
      }
    }
  }

  return processedLines.join("\n");
}

async function formatLineBreaksWithLlm(text, language = "en") {
  if (!text || text.length < 50) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey && !process.env.LLM_ENDPOINT) {
    return null;
  }

  try {
    if (process.env.GEMINI_API_KEY || (apiKey && !process.env.OPENAI_API_KEY)) {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const key = process.env.GEMINI_API_KEY || apiKey;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const prompt = `You are an expert transcript editor. Format the following transcript text by inserting paragraph breaks (separated by blank lines / double newlines) to turn long continuous text into clear, readable paragraphs with line breaks. Do not alter, omit, or invent words, speaker tags, or timestamps. Return ONLY the formatted transcript text with double-newline paragraph breaks.\n\nTranscript:\n${text}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const llmResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (llmResult && llmResult.trim()) {
          return llmResult.trim();
        }
      }
    } else if (process.env.OPENAI_API_KEY || process.env.LLM_ENDPOINT) {
      const url = process.env.LLM_ENDPOINT || "https://api.openai.com/v1/chat/completions";
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const headers = { "Content-Type": "application/json" };
      if (process.env.OPENAI_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
      }

      const prompt = `You are an expert transcript editor. Format the following transcript text by inserting paragraph breaks (separated by blank lines / double newlines) to turn long continuous text into clear, readable paragraphs with line breaks. Do not alter, omit, or invent words, speaker tags, or timestamps. Return ONLY the formatted transcript text with double-newline paragraph breaks.\n\nTranscript:\n${text}`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const llmResult = data.choices?.[0]?.message?.content;
        if (llmResult && llmResult.trim()) {
          return llmResult.trim();
        }
      }
    }
  } catch (error) {
    // Failover silently to smart heuristic line breaking
  }

  return null;
}

async function handleProofread(request, response) {
  try {
    const body = await readJsonBody(request);
    const text = String(body.text || "").trim();
    if (!text) {
      return sendJson(response, 400, { error: "Text is required to proofread." });
    }
    const language = String(body.language || "en").toLowerCase();
    const options = {
      removeTimestamps: body.removeTimestamps !== false,
      deduplicateSpeakers: body.deduplicateSpeakers !== false,
      addLineBreaks: body.addLineBreaks !== false,
    };
    let proofread = proofreadText(text, language, options);

    if (options.addLineBreaks) {
      const llmResult = await formatLineBreaksWithLlm(proofread, language);
      if (llmResult) {
        proofread = llmResult;
      }
    }

    return sendJson(response, 200, { proofread, original: text });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Proofreading failed." });
  }
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

async function translateText(text, sourceLanguage, targetLanguage) {
  const translated = [];
  for (const chunk of splitTranslationText(text)) {
    const endpoint = new URL("https://translate.googleapis.com/translate_a/single");
    endpoint.searchParams.set("client", "gtx");
    endpoint.searchParams.set("sl", sourceLanguage || "auto");
    endpoint.searchParams.set("tl", targetLanguage);
    endpoint.searchParams.set("dt", "t");
    endpoint.searchParams.set("q", chunk);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`The translation service returned ${response.status}.`);
    const payload = await response.json();
    translated.push((payload[0] || []).map((segment) => segment[0] || "").join(""));
  }
  return translated.join("");
}

async function handleTranslate(request, response) {
  try {
    const body = await readJsonBody(request);
    const text = String(body.text || "").trim();
    const sourceLanguage = String(body.sourceLanguage || "auto").toLowerCase();
    const targetLanguage = String(body.targetLanguage || "").toLowerCase();
    if (!text) return sendJson(response, 400, { error: "Transcript text is required." });
    if (!/^(auto|[a-z]{2,3})$/.test(sourceLanguage) || !/^[a-z]{2,3}$/.test(targetLanguage)) {
      return sendJson(response, 400, { error: "The selected language is not supported." });
    }
    const translation = await translateText(text, sourceLanguage, targetLanguage);
    return sendJson(response, 200, { translation, service: "Google Translate" });
  } catch (error) {
    return sendJson(response, 502, { error: error.message || "Translation failed." });
  }
}

function safeVideoId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("The video ID is invalid.");
  return id;
}

function downloadMetrics(job, now = Date.now()) {
  const startedAt = Date.parse(job?.startedAt || "");
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, (Number(now) - startedAt) / 1000) : 0;
  const bytesDownloaded = Math.max(0, Number(job?.bytesDownloaded || 0));
  const totalBytes = Math.max(0, Number(job?.totalBytes || 0));
  const filesDone = Math.max(0, Number(job?.filesDone || 0));
  const filesTotal = Math.max(0, Number(job?.filesTotal || 0));
  const speed = elapsedSeconds >= 1 && bytesDownloaded > 0 ? bytesDownloaded / elapsedSeconds : 0;
  const fraction = totalBytes > 0
    ? Math.min(1, bytesDownloaded / totalBytes)
    : filesTotal > 0
      ? Math.min(1, filesDone / filesTotal)
      : 0;
  let etaSeconds = null;

  if (job?.status === "completed") {
    etaSeconds = 0;
  } else if (speed > 0 && totalBytes > bytesDownloaded) {
    etaSeconds = (totalBytes - bytesDownloaded) / speed;
  } else if (elapsedSeconds >= 1 && fraction > 0 && fraction < 1) {
    etaSeconds = (elapsedSeconds * (1 - fraction)) / fraction;
  }

  return {
    downloadSpeedBytesPerSecond: Math.round(speed),
    etaSeconds: etaSeconds === null ? null : Math.max(0, Math.round(etaSeconds)),
  };
}

function parseHlsAttributes(value) {
  const attributes = {};
  const input = String(value || "");
  const pattern = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(input))) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return attributes;
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
    (a, b) => b.height - a.height || b.bandwidth - a.bandwidth
  )[0];
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

function sanitizeOfflineMaster(manifest) {
  return String(manifest || "")
    .split(/\r?\n/)
    .filter((line) => !/^#EXT-X-MEDIA:.*TYPE=(?:SUBTITLES|CLOSED-CAPTIONS)(?:,|$)/i.test(line))
    .map((line) => {
      if (!line.startsWith("#EXT-X-STREAM-INF:")) return line;
      return removeHlsAttribute(removeHlsAttribute(line, "SUBTITLES"), "CLOSED-CAPTIONS");
    })
    .join("\n");
}

function assertUnencryptedHls(manifest) {
  const protectedTag = String(manifest || "")
    .split(/\r?\n/)
    .find((line) => /^#EXT-X-(?:SESSION-)?KEY:/i.test(line) && !/METHOD=NONE(?:,|$)/i.test(line));
  if (protectedTag) {
    throw new Error("This stream is encrypted or DRM-protected and cannot be saved by Material Picker.");
  }
}

async function fetchRemoteResponse(value, { accept = "*/*", redirects = 0 } = {}) {
  const url = await validateRemoteUrl(value);
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": BROWSER_USER_AGENT },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= MAX_REDIRECTS) throw new Error("The media redirected too many times.");
    return fetchRemoteResponse(new URL(response.headers.get("location"), url).href, {
      accept,
      redirects: redirects + 1,
    });
  }
  if (!response.ok) throw new Error(`The media server returned ${response.status}.`);
  return { response, finalUrl: url.href };
}

async function downloadRemoteFile(url, destination, job) {
  const { response } = await fetchRemoteResponse(url);
  const contentType = response.headers.get("content-type") || "";
  if (/text\/html|application\/json/i.test(contentType)) {
    throw new Error("The media URL returned a web page instead of video data.");
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fsp.open(destination, "w");
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk);
      job.bytesDownloaded += chunk.length;
      job.updatedAt = new Date().toISOString();
    }
  } finally {
    await handle.close();
  }
}

function localMediaName(remoteUrl, index) {
  let extension = ".bin";
  try {
    const candidate = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(candidate)) extension = candidate;
  } catch {
    // Keep the generic extension.
  }
  return `${String(index).padStart(5, "0")}${extension}`;
}

async function cacheMediaPlaylist(playlistUrl, destination, job) {
  const playlist = await fetchRemoteText(playlistUrl, {
    accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain",
    contentTypePattern: /mpegurl|text\/plain|application\/octet-stream/i,
    maxBytes: 5 * 1024 * 1024,
  });
  assertUnencryptedHls(playlist.body);
  if (selectHlsVariant(playlist.body)) throw new Error("The selected HLS variant contained another master playlist.");

  const lines = playlist.body.split(/\r?\n/);
  const remoteFiles = new Map();
  const register = (rawUrl) => {
    const absolute = new URL(rawUrl, playlist.finalUrl).href;
    if (!remoteFiles.has(absolute)) remoteFiles.set(absolute, `segments/${localMediaName(absolute, remoteFiles.size)}`);
    return remoteFiles.get(absolute);
  };

  const rewritten = lines.map((line) => {
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseHlsAttributes(line.slice("#EXT-X-MAP:".length));
      if (!attributes.URI) return line;
      return replaceHlsAttribute(line, "URI", register(attributes.URI));
    }
    if (!line.trim() || line.startsWith("#")) return line;
    return register(line.trim());
  });

  const entries = [...remoteFiles.entries()];
  job.filesTotal += entries.length;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const [remoteUrl, localName] = entries[cursor++];
      await downloadRemoteFile(remoteUrl, path.join(destination, localName), job);
      job.filesDone += 1;
      job.updatedAt = new Date().toISOString();
    }
  });
  await Promise.all(workers);
  await fsp.writeFile(path.join(destination, "playlist.m3u8"), rewritten.join("\n"), "utf8");
}

async function cacheHlsStream(sourceUrl, destination, job) {
  const master = await fetchRemoteText(sourceUrl, {
    accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain",
    contentTypePattern: /mpegurl|text\/plain|application\/octet-stream/i,
    maxBytes: 5 * 1024 * 1024,
  });
  assertUnencryptedHls(master.body);
  const variant = selectHlsVariant(master.body);
  if (!variant) {
    await cacheMediaPlaylist(master.finalUrl, destination, job);
    return { offlineUrl: `${job.publicBase}/playlist.m3u8`, format: "hls" };
  }

  const videoDir = path.join(destination, "video");
  await cacheMediaPlaylist(new URL(variant.uri, master.finalUrl).href, videoDir, job);
  const masterLines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  const audioGroup = variant.attributes.AUDIO;
  if (audioGroup) {
    const audioLine = master.body
      .split(/\r?\n/)
      .find((line) => {
        if (!line.startsWith("#EXT-X-MEDIA:")) return false;
        const attributes = parseHlsAttributes(line.slice("#EXT-X-MEDIA:".length));
        return attributes.TYPE === "AUDIO" && attributes["GROUP-ID"] === audioGroup && attributes.URI;
      });
    if (audioLine) {
      const audioAttributes = parseHlsAttributes(audioLine.slice("#EXT-X-MEDIA:".length));
      await cacheMediaPlaylist(new URL(audioAttributes.URI, master.finalUrl).href, path.join(destination, "audio"), job);
      masterLines.push(replaceHlsAttribute(audioLine, "URI", "audio/playlist.m3u8"));
    }
  }
  masterLines.push(sanitizeOfflineMaster(variant.infoLine), "video/playlist.m3u8");
  await fsp.writeFile(path.join(destination, "master.m3u8"), `${masterLines.join("\n")}\n`, "utf8");
  return { offlineUrl: `${job.publicBase}/master.m3u8`, format: "hls" };
}

function directMediaExtension(url, contentType) {
  const {pathname} = new URL(url);
  const candidate = path.extname(pathname).toLowerCase();
  if ([".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v"].includes(candidate)) return candidate;
  if (/webm/i.test(contentType)) return ".webm";
  if (/ogg/i.test(contentType)) return ".ogv";
  if (/quicktime/i.test(contentType)) return ".mov";
  return ".mp4";
}

async function cacheDirectVideo(sourceUrl, destination, job) {
  const { response, finalUrl } = await fetchRemoteResponse(sourceUrl, { accept: "video/*,application/octet-stream" });
  const contentType = response.headers.get("content-type") || "";
  if (!/video\/|application\/octet-stream/i.test(contentType)) {
    throw new Error("The URL did not return a downloadable video file.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength) job.totalBytes = declaredLength;
  const filename = `video${directMediaExtension(finalUrl, contentType)}`;
  const handle = await fsp.open(path.join(destination, filename), "w");
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk);
      job.bytesDownloaded += chunk.length;
      job.updatedAt = new Date().toISOString();
    }
  } finally {
    await handle.close();
  }
  job.filesTotal = 1;
  job.filesDone = 1;
  return { offlineUrl: `${job.publicBase}/${filename}`, format: "file" };
}

async function resolveOfflineSource(videoUrl) {
  if (/vimeo\.com/i.test(videoUrl)) {
    const config = await getVimeoPlayerConfig(videoUrl);
    const progressive = [...(config.request?.files?.progressive || [])].sort((a, b) => Number(b.height) - Number(a.height));
    if (progressive[0]?.url) return { type: "file", url: progressive[0].url, provider: "Vimeo public download" };
    const hls = config.request?.files?.hls;
    const hlsUrl = hls?.cdns?.[hls.default_cdn]?.url || Object.values(hls?.cdns || {})[0]?.url;
    if (hlsUrl) return { type: "hls", url: hlsUrl, provider: "Vimeo public HLS" };
    throw new Error("Vimeo did not expose a public downloadable file or unencrypted stream.");
  }
  if (/\.m3u8([?#].*)?$/i.test(videoUrl)) return { type: "hls", url: videoUrl, provider: "Direct HLS" };
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)([?#].*)?$/i.test(videoUrl)) {
    return { type: "file", url: videoUrl, provider: "Direct file" };
  }
  throw new Error("Offline saving supports public Vimeo media, direct video files, and unencrypted HLS streams.");
}

async function runOfflineSave({ id, title, url }) {
  const job = offlineJobs.get(id);
  const temporary = path.join(VIDEO_ROOT, `${id}.partial`);
  const destination = path.join(VIDEO_ROOT, id);
  try {
    await fsp.mkdir(VIDEO_ROOT, { recursive: true });
    await fsp.rm(temporary, { recursive: true, force: true });
    await fsp.mkdir(temporary, { recursive: true });
    const source = await resolveOfflineSource(url);
    job.provider = source.provider;
    const result =
      source.type === "hls"
        ? await cacheHlsStream(source.url, temporary, job)
        : await cacheDirectVideo(source.url, temporary, job);
    const metadata = {
      id,
      title: title || "Untitled video",
      sourceUrl: url,
      offlineUrl: result.offlineUrl,
      format: result.format,
      provider: source.provider,
      size: job.bytesDownloaded,
      savedAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(temporary, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.rename(temporary, destination);
    Object.assign(job, metadata, { status: "completed", updatedAt: new Date().toISOString() });
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {});
    job.status = "failed";
    job.error = error.message || "The video could not be saved.";
    job.updatedAt = new Date().toISOString();
  }
}

async function handleOfflineSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const id = safeVideoId(body.videoId);
    const url = String(body.url || "");
    await validateRemoteUrl(url);
    if (body.rightsConfirmed !== true) {
      return sendJson(response, 400, { error: "Confirm that you have permission to save this video." });
    }
    const current = offlineJobs.get(id);
    if (current?.status === "downloading") return sendJson(response, 409, { error: "This video is already downloading." });
    const job = {
      id,
      title: String(body.title || "Untitled video").slice(0, 300),
      sourceUrl: url,
      status: "downloading",
      bytesDownloaded: 0,
      totalBytes: 0,
      filesDone: 0,
      filesTotal: 0,
      publicBase: `/offline-media/${id}`,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    offlineJobs.set(id, job);
    void runOfflineSave({ id, title: job.title, url });
    return sendJson(response, 202, { ...job, ...downloadMetrics(job) });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "The offline save request was invalid." });
  }
}

async function readOfflineLibrary() {
  await fsp.mkdir(VIDEO_ROOT, { recursive: true });
  const entries = await fsp.readdir(VIDEO_ROOT, { withFileTypes: true });
  const library = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith(".partial")) continue;
    try {
      const directory = path.join(VIDEO_ROOT, entry.name);
      const masterPath = path.join(directory, "master.m3u8");
      try {
        const master = await fsp.readFile(masterPath, "utf8");
        const repaired = sanitizeOfflineMaster(master);
        if (repaired !== master) await fsp.writeFile(masterPath, repaired, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const metadata = JSON.parse(await fsp.readFile(path.join(directory, "metadata.json"), "utf8"));
      library.push(metadata);
    } catch {
      // Ignore incomplete or manually modified archive folders.
    }
  }
  return library;
}

async function listArchiveFiles(directory, prefix = "") {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listArchiveFiles(fullPath, relativePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await fsp.stat(fullPath);
    files.push({ path: relativePath, size: stats.size });
  }
  return files;
}

async function handleOfflineFiles(response, idValue, pathParam) {
  try {
    let directory;
    let id = idValue || "";
    if (pathParam) {
      directory = resolveLocalPath(pathParam);
      if (!id) id = path.basename(directory);
    } else if (idValue) {
      id = safeVideoId(idValue);
      directory = path.join(VIDEO_ROOT, id);
    } else {
      return sendJson(response, 400, { error: "An id or path is required." });
    }

    let metadata = null;
    try {
      metadata = JSON.parse(await fsp.readFile(path.join(directory, "metadata.json"), "utf8"));
    } catch {}

    const files = await listArchiveFiles(directory);
    const filePaths = new Set(files.map((f) => f.path));
    const emptyFiles = files.filter((f) => f.size <= 0).map((f) => f.path);

    let masterText = "";
    try {
      masterText = await fsp.readFile(path.join(directory, "master.m3u8"), "utf8");
    } catch {}

    const missingFiles = [];
    let expectedCount = files.length;
    let healthy = false;

    if (masterText) {
      const subPlaylists = {};
      const lines = masterText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        let subUri = "";
        if (line.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/i.test(line)) {
          const match = line.match(/URI="([^"]*)"/i);
          if (match) subUri = match[1];
        } else if (!line.startsWith("#") && (line.includes(".m3u8") || line.endsWith(".m3u8"))) {
          subUri = line;
        }
        if (subUri && !subPlaylists[subUri]) {
          try {
            subPlaylists[subUri] = await fsp.readFile(path.join(directory, subUri), "utf8");
          } catch {
            missingFiles.push(subUri);
          }
        }
      }

      const checkSegments = (subUri, text) => {
        const dir = subUri.includes("/") ? subUri.slice(0, subUri.lastIndexOf("/")) : "";
        const resolve = (u) => (dir ? `${dir}/${u}` : u);
        const pLines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pLines.forEach((l) => {
          let segPath = null;
          if (l.startsWith("#EXT-X-MAP:")) {
            const m = l.match(/URI="([^"]*)"/i);
            if (m) segPath = resolve(m[1]);
          } else if (!l.startsWith("#")) {
            segPath = resolve(l);
          }
          if (segPath && !filePaths.has(segPath)) {
            missingFiles.push(segPath);
          }
        });
      };

      for (const [subUri, pText] of Object.entries(subPlaylists)) {
        checkSegments(subUri, pText);
      }

      expectedCount = files.length + missingFiles.length;
      healthy = missingFiles.length === 0 && emptyFiles.length === 0 && files.length > 0;
    } else {
      healthy =
        files.some((f) => f.path.endsWith(".mp4") || f.path.endsWith(".m3u8") || f.path.endsWith(".webm")) &&
        emptyFiles.length === 0;
    }

    const message = healthy
      ? `All ${files.length} segments intact and playable.`
      : missingFiles.length > 0
      ? `Incomplete copy: missing ${missingFiles.length} segment(s) (e.g. ${missingFiles[0]}).`
      : emptyFiles.length > 0
      ? `Corrupted copy: ${emptyFiles.length} empty file(s).`
      : "Archive is empty or unplayable.";

    return sendJson(response, 200, {
      id: metadata?.id || id,
      title: metadata?.title || path.basename(directory),
      format: metadata?.format || (masterText ? "hls" : "file"),
      size: files.reduce((total, file) => total + file.size, 0),
      files,
      healthy,
      playable: healthy,
      missingFiles,
      emptyFiles,
      expectedCount,
      foundCount: files.length,
      message,
    });
  } catch (error) {
    const status = error.code === "ENOENT" ? 404 : 400;
    return sendJson(response, status, { error: error.message || "The offline copy could not be listed." });
  }
}

async function handleOfflineDelete(response, idValue) {
  try {
    const id = safeVideoId(idValue);
    await fsp.rm(path.join(VIDEO_ROOT, id), { recursive: true, force: true });
    await fsp.rm(path.join(VIDEO_ROOT, `${id}.partial`), { recursive: true, force: true });
    offlineJobs.delete(id);
    return sendJson(response, 200, { removed: true, id });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "The offline copy could not be removed." });
  }
}

function serveOfflineFile(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.replace(/^\/offline-media\//, ""));
  } catch {
    return sendJson(response, 400, { error: "Invalid media path." });
  }
  const filePath = path.resolve(VIDEO_ROOT, decoded);
  if (!filePath.startsWith(`${VIDEO_ROOT}${path.sep}`)) return sendJson(response, 403, { error: "Forbidden." });
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(response, 404, { error: "Offline media not found." });
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stats.size - 1) : stats.size - 1;
      if (start > end || start >= stats.size) {
        response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
        return response.end();
      }
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      return fs.createReadStream(filePath, { start, end }).pipe(response);
    }
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": stats.size,
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
    if (request.method === "HEAD") return response.end();
    return fs.createReadStream(filePath).pipe(response);
  });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(PUBLIC_ROOT, `.${decoded}`);
  if (!filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) return sendJson(response, 403, { error: "Forbidden." });
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(response, 404, { error: "Not found." });
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": STATIC_CACHE_CONTROL,
      ...(IS_DEV ? { Pragma: "no-cache" } : {}),
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

function resolveLocalPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return "";
  let clean = inputPath.trim();
  if (clean.startsWith("~")) {
    clean = path.join(os.homedir(), clean.slice(1));
  }
  const resolved = path.resolve(clean);
  if (!fs.existsSync(resolved)) {
    const dataCandidate = path.join(DATA_ROOT, clean);
    if (fs.existsSync(dataCandidate)) return dataCandidate;
    const projectCandidate = path.join(ROOT, clean);
    if (fs.existsSync(projectCandidate)) return projectCandidate;
  }
  return resolved;
}

function isHlsPackageDirectory(entries) {
  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase()));
  const dirNames = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()));
  const actualFile = (lower) => entries.find((e) => e.isFile() && e.name.toLowerCase() === lower)?.name;

  if (fileNames.has("master.m3u8")) return actualFile("master.m3u8");
  if (fileNames.has("index.m3u8")) return actualFile("index.m3u8");
  if (fileNames.has("playlist.m3u8") && (dirNames.has("audio") || dirNames.has("video") || dirNames.has("segments"))) {
    return actualFile("playlist.m3u8");
  }
  if ((dirNames.has("audio") || dirNames.has("video") || dirNames.has("segments")) && entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith(".m3u8"))) {
    const m3u8File = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".m3u8"));
    return m3u8File.name;
  }
  return null;
}

async function getDirectorySize(dir) {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySize(full);
      } else if (entry.isFile()) {
        const stats = await fsp.stat(full);
        total += stats.size;
      }
    }
  } catch {}
  return total;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function locateHlsManifest(dirPath, entries) {
  const listed = isHlsPackageDirectory(entries);
  if (listed) return listed;
  const dirNames = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));
  const hasBucket = dirNames.has("audio") || dirNames.has("video") || dirNames.has("segments");
  if (!hasBucket) return null;
  const hasMediaHint =
    (dirNames.has("audio") && dirNames.has("video")) ||
    entries.some((entry) => entry.isFile() && (entry.name.toLowerCase() === "metadata.json" || entry.name.toLowerCase().endsWith(".m3u8")));
  if (!hasMediaHint) return null;
  const probes = ["master.m3u8", "index.m3u8", "playlist.m3u8", "video/playlist.m3u8", "audio/playlist.m3u8"];
  for (const probe of probes) {
    try {
      await fsp.access(path.join(dirPath, probe));
      return probe;
    } catch {
      // This layout does not use that manifest path.
    }
  }
  return null;
}

async function scanDirectoryForVideos(dirPath, relativePrefix = "", visitedDirs = new Set()) {
  const resolved = path.resolve(dirPath);
  let real;
  try {
    real = await fsp.realpath(resolved);
  } catch {
    real = resolved;
  }
  if (visitedDirs.has(real)) return [];
  visitedDirs.add(real);

  let entries;
  try {
    entries = await fsp.readdir(resolved, { withFileTypes: true });
  } catch {
    return [];
  }

  // One library item per saved video. Do not open audio/video/segments folders.
  const hlsManifestName = await locateHlsManifest(resolved, entries);
  if (hlsManifestName) {
    let meta = null;
    const metaEntry = entries.find((e) => e.isFile() && e.name.toLowerCase() === "metadata.json");
    if (metaEntry) {
      try {
        meta = JSON.parse(await fsp.readFile(path.join(resolved, metaEntry.name), "utf8"));
      } catch {}
    }

    const folderBaseName = path.basename(resolved);
    const title =
      meta?.title ||
      (folderBaseName !== "videos" && folderBaseName !== "data"
        ? folderBaseName.replace(/[-_]+/g, " ").trim()
        : "HLS Video");
    const totalSize = Number(meta?.size) || 0;
    const rel = relativePrefix ? `${relativePrefix}/${hlsManifestName}` : hlsManifestName;
    const full = path.join(resolved, hlsManifestName);

    return [
      {
        id: meta?.id || undefined,
        name: path.basename(hlsManifestName),
        title: title || hlsManifestName,
        relativePath: rel,
        absolutePath: full,
        subfolder: relativePrefix || "",
        size: totalSize,
        format: "hls",
        url: `/local-media/${encodeURIComponent(resolved)}/${hlsManifestName}`,
        sourceUrl: meta?.sourceUrl || undefined,
        speaker: meta?.speaker || undefined,
        language: meta?.language || undefined,
        tags: meta?.tags || undefined,
        notes: meta?.notes || undefined,
        transcriptLanguage: meta?.transcriptLanguage || undefined,
        transcriptSource: meta?.transcriptSource || undefined,
        durationSeconds: Number(meta?.durationSeconds) || undefined,
        offlineUrl: `/local-media/${encodeURIComponent(resolved)}/${hlsManifestName}`,
        offlineFormat: meta?.format || "hls",
        offlineSize: totalSize,
        offlineSavedAt: meta?.savedAt || meta?.downloadedAt || undefined,
        offlineProvider: meta?.provider || undefined,
      },
    ];
  }

  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  visible.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const directories = visible.filter((entry) => entry.isDirectory());
  const files = visible.filter((entry) => entry.isFile());
  const nested = await mapLimit(directories, 8, (entry) => {
    const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    return scanDirectoryForVideos(path.join(resolved, entry.name), rel, visitedDirs);
  });
  const results = nested.flat();

  for (const entry of files) {
    const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const full = path.join(resolved, entry.name);
    const lowerName = entry.name.toLowerCase();
    const isInternalHls =
      lowerName === "playlist.m3u8" ||
      lowerName === "master.m3u8" ||
      lowerName === "index.m3u8" ||
      lowerName === "metadata.json" ||
      /^\d{5,}\.(mp4|m4s|ts)$/i.test(lowerName);
    if (isInternalHls) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!STANDALONE_VIDEO_EXTENSIONS.has(ext)) continue;
    try {
      const stats = await fsp.stat(full);
      const title = entry.name
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      results.push({
        name: entry.name,
        title: title || entry.name,
        relativePath: rel,
        absolutePath: full,
        subfolder: relativePrefix || "",
        size: stats.size,
        format: ext.replace(".", ""),
        url: `/local-media/${encodeURIComponent(resolved)}/${entry.name}`,
      });
    } catch {
      // Ignore unreadable files
    }
  }
  return results;
}

async function handleScanFolder(response, requestUrl) {
  const rawPath = requestUrl.searchParams.get("path");
  if (!rawPath) return sendJson(response, 400, { error: "A folder path is required." });
  const folderPath = resolveLocalPath(rawPath);
  try {
    const stats = await fsp.stat(folderPath);
    if (!stats.isDirectory()) {
      return sendJson(response, 400, { error: "The specified path is not a directory." });
    }
    const videos = await scanDirectoryForVideos(folderPath);
    const folderName = path.basename(folderPath) || "Local Videos";
    return sendJson(response, 200, {
      folderPath,
      folderName,
      totalCount: videos.length,
      videos,
    });
  } catch (error) {
    const status = error.code === "ENOENT" ? 404 : 500;
    return sendJson(response, status, { error: `Could not access directory: ${error.message}` });
  }
}

function serveLocalMedia(request, response, requestUrl) {
  let filePath;

  if (requestUrl.pathname.startsWith("/local-media/")) {
    const remainder = requestUrl.pathname.slice("/local-media/".length);
    const slashIdx = remainder.indexOf("/");
    let baseDirEncoded, relPath;
    if (slashIdx >= 0) {
      baseDirEncoded = remainder.slice(0, slashIdx);
      relPath = decodeURIComponent(remainder.slice(slashIdx + 1));
    } else {
      baseDirEncoded = remainder;
      relPath = "";
    }
    const baseDir = decodeURIComponent(baseDirEncoded);
    filePath = path.resolve(baseDir, relPath);
    const resolvedBase = path.resolve(baseDir);
    if (!filePath.startsWith(resolvedBase + path.sep) && filePath !== resolvedBase) {
      return sendJson(response, 403, { error: "Forbidden path." });
    }
  } else {
    const rawPath = requestUrl.searchParams.get("path");
    if (!rawPath) return sendJson(response, 400, { error: "A file path is required." });
    filePath = resolveLocalPath(rawPath);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return sendJson(response, 403, { error: "File format is not a supported media type." });
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(response, 404, { error: "Media file not found." });
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    const isPlaylist = ext === ".m3u8";
    const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);

    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stats.size - 1) : stats.size - 1;
      if (start > end || start >= stats.size) {
        response.writeHead(416, {
          "Content-Range": `bytes */${stats.size}`,
          "Access-Control-Allow-Origin": "*",
        });
        return response.end();
      }
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Type": contentType,
        "Cache-Control": isPlaylist ? "no-cache" : "private, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      return fs.createReadStream(filePath, { start, end }).pipe(response);
    }

    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": stats.size,
      "Content-Type": contentType,
      "Cache-Control": isPlaylist ? "no-cache" : "private, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    });
    if (request.method === "HEAD") return response.end();
    return fs.createReadStream(filePath).pipe(response);
  });
}

const FOLDER_METADATA_TEXT_FIELDS = [
  "id",
  "title",
  "speaker",
  "language",
  "tags",
  "notes",
  "transcript",
  "translation",
  "transcriptLanguage",
  "transcriptSource",
  "sourceUrl",
  "format",
  "provider",
  "savedAt",
];

function clipMetadataText(value, max = 500000) {
  return String(value ?? "").slice(0, max);
}

async function directoryHasSavedVideo(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  if (isHlsPackageDirectory(entries)) return true;
  return entries.some((entry) => {
    if (!entry.isFile()) return false;
    const name = entry.name.toLowerCase();
    return name === "metadata.json" || STANDALONE_VIDEO_EXTENSIONS.has(path.extname(name));
  });
}

async function handleUpdateFolderMetadata(request, response) {
  try {
    const body = await readJsonBody(request, MAX_PAGE_BYTES);
    const directory = resolveLocalPath(String(body.directory || ""));
    if (!directory) return sendJson(response, 400, { error: "A video folder is required." });
    const stats = await fsp.stat(directory);
    if (!stats.isDirectory()) return sendJson(response, 400, { error: "That path is not a folder." });
    if (!(await directoryHasSavedVideo(directory))) {
      return sendJson(response, 400, { error: "That folder does not contain a saved video." });
    }
    const metaPath = path.join(directory, "metadata.json");
    let existing = {};
    try {
      existing = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const incoming = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const next = { ...existing };
    FOLDER_METADATA_TEXT_FIELDS.forEach((field) => {
      if (field in incoming) next[field] = clipMetadataText(incoming[field], field === "transcript" || field === "translation" || field === "notes" ? 500000 : 4000);
    });
    if ("durationSeconds" in incoming) next.durationSeconds = Number(incoming.durationSeconds) || 0;
    if (typeof incoming.thumbnail === "string" && incoming.thumbnail.startsWith("data:image/")) {
      next.thumbnail = clipMetadataText(incoming.thumbnail, 500000);
    }
    if (incoming.thumbnails && typeof incoming.thumbnails === "object") {
      const current = next.thumbnails && typeof next.thumbnails === "object" ? { ...next.thumbnails } : {};
      const cinematic = typeof incoming.thumbnails.cinematic === "string" && incoming.thumbnails.cinematic.startsWith("data:image/")
        ? clipMetadataText(incoming.thumbnails.cinematic, 500000)
        : "";
      const newAge = typeof incoming.thumbnails.newAge === "string" && incoming.thumbnails.newAge.startsWith("data:image/")
        ? clipMetadataText(incoming.thumbnails.newAge, 500000)
        : "";
      if (cinematic) current.cinematic = cinematic;
      if (newAge) current.newAge = newAge;
      if (incoming.thumbnails.newAgeLook === "pastel") current.newAgeLook = "pastel";
      if (cinematic || newAge || current.newAgeLook) next.thumbnails = current;
      if (cinematic) next.thumbnail = cinematic;
    }
    if ("size" in incoming && Number(incoming.size) > 0) next.size = Number(incoming.size);
    next.updatedAt = new Date().toISOString();
    await fsp.writeFile(metaPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return sendJson(response, 200, { ok: true, updatedAt: next.updatedAt });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "The metadata could not be saved." });
  }
}

function handleChooseFolder(response) {
  if (process.platform !== "darwin") {
    return sendJson(response, 200, { supported: false, message: "Native dialog only supported on macOS." });
  }
  const script = 'POSIX path of (choose folder with prompt "Select video folder:")';
  execFile("osascript", ["-e", script], { timeout: 60000 }, (error, stdout) => {
    if (error) {
      return sendJson(response, 200, { supported: true, cancelled: true });
    }
    const chosenPath = stdout.trim().replace(/\/$/, "");
    return sendJson(response, 200, { supported: true, chosenPath });
  });
}

function imageContentType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return "image/jpeg";
}

const LIVE_THUMBNAIL_URL = "https://picker.rynell.org/api/thumbnail";

function sendThumbnail(response, bytes, contentType) {
  response.writeHead(200, {
    "Content-Type": contentType || imageContentType(bytes),
    "Cache-Control": "no-store",
  });
  response.end(bytes);
}

async function thumbnailFromAccount(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return { error: "Thumbnail model is not connected.", status: 503 };
  const aiResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });
  const contentType = aiResponse.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await aiResponse.json();
    const image = data?.result?.image || data?.image;
    if (!aiResponse.ok || !image) {
      return {
        error: data?.errors?.[0]?.message || "The thumbnail model returned no image.",
        status: aiResponse.ok ? 502 : aiResponse.status || 502,
      };
    }
    const bytes = Buffer.from(image, "base64");
    return { bytes, contentType: imageContentType(bytes) };
  }
  if (!aiResponse.ok) return { error: "The thumbnail could not be rendered.", status: aiResponse.status || 502 };
  const bytes = Buffer.from(await aiResponse.arrayBuffer());
  if (!bytes.byteLength) return { error: "The thumbnail model returned no image.", status: 502 };
  return { bytes, contentType: contentType || imageContentType(bytes) };
}

async function thumbnailFromLiveSite(prompt) {
  const live = await fetch(LIVE_THUMBNAIL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(90000),
  });
  const contentType = live.headers.get("content-type") || "";
  if (!live.ok || contentType.includes("application/json")) {
    const data = await live.json().catch(() => ({}));
    return { error: data.error || "The thumbnail could not be rendered.", status: live.status || 502 };
  }
  const bytes = Buffer.from(await live.arrayBuffer());
  if (!bytes.byteLength) return { error: "The thumbnail model returned no image.", status: 502 };
  return { bytes, contentType: contentType || imageContentType(bytes) };
}

async function handleThumbnail(request, response) {
  let body;
  try {
    body = await readJsonBody(request, 16_000);
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "The request was not valid JSON." });
  }
  const prompt = String(body.prompt || "").trim().slice(0, 1200);
  if (prompt.length < 8) return sendJson(response, 400, { error: "A thumbnail prompt is required." });
  try {
    let result = await thumbnailFromAccount(prompt);
    if (!result.bytes && (result.status === 503 || /authentication/i.test(result.error || ""))) {
      result = await thumbnailFromLiveSite(prompt);
    }
    if (!result.bytes) return sendJson(response, result.status || 502, { error: result.error || "The thumbnail could not be rendered." });
    return sendThumbnail(response, result.bytes, result.contentType);
  } catch (error) {
    return sendJson(response, 502, { error: error.message || "The thumbnail could not be rendered." });
  }
}

let accountStorePromise;

function accountStore() {
  accountStorePromise ||= import("./account-file.mjs").then(({ createFileAccountStore }) =>
    createFileAccountStore(path.join(DATA_ROOT, "accounts.json"))
  );
  return accountStorePromise;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

let cmsStorePromise;

function cmsStore() {
  cmsStorePromise ||= import("./cms.mjs").then(({ createFileCmsStore }) => createFileCmsStore(DATA_ROOT));
  return cmsStorePromise;
}

async function handleCms(request, response) {
  const [{ handleCmsRequest }, { sessionUser }] = await Promise.all([
    import("./cms.mjs"),
    import("./auth.mjs"),
  ]);
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `localhost:${PORT}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readRequestBody(request);
  const webRequest = new Request(`${proto}://${host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: body?.length ? body : undefined,
  });
  const store = await accountStore();
  const webResponse = await handleCmsRequest(webRequest, {
    store: await cmsStore(),
    user: await sessionUser(webRequest, store),
  });
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function handleFeedlyAuth(request, response) {
  const { handleFeedlyRequest } = await import("./feedly.mjs");
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `localhost:${PORT}`;
  const webRequest = new Request(`${proto}://${host}${request.url}`, {
    method: request.method,
    headers: request.headers,
  });
  const webResponse = await handleFeedlyRequest(webRequest, {
    store: await accountStore(),
    clientId: process.env.FEEDLY_CLIENT_ID || "",
    clientSecret: process.env.FEEDLY_CLIENT_SECRET || "",
  });
  const headers = {};
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const cookies = webResponse.headers.getSetCookie?.() || [];
  response.writeHead(webResponse.status, {
    ...headers,
    ...(cookies.length ? { "Set-Cookie": cookies } : {}),
  });
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function handleAccount(request, response) {
  const { handleAuthRequest } = await import("./auth.mjs");
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `localhost:${PORT}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readRequestBody(request);
  const webRequest = new Request(`${proto}://${host}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: body?.length ? body : undefined,
  });
  const webResponse = await handleAuthRequest(webRequest, {
    store: await accountStore(),
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  });
  const headers = {};
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const cookies = webResponse.headers.getSetCookie?.() || [];
  response.writeHead(webResponse.status, {
    ...headers,
    ...(cookies.length ? { "Set-Cookie": cookies } : {}),
  });
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function startServer() {
  fs.mkdirSync(VIDEO_ROOT, { recursive: true });
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      return response.end();
    }
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname.startsWith("/api/auth") || requestUrl.pathname.startsWith("/api/youtube/")) {
      return handleAccount(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/rss/opml") {
      return handleOpml(request, response);
    }
    if (requestUrl.pathname.startsWith("/api/feedly")) {
      return handleFeedlyAuth(request, response);
    }
    if (requestUrl.pathname.startsWith("/api/cms")) {
      return handleCms(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/video-search") {
      return handleVideoSearch(response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/rss/catalog") {
      return handleRssCatalog(response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/rss") {
      return handleRss(response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/scrape") {
      return handleScrape(request, response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/chapters") {
      return handleChapters(response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/transcript") {
      return handleTranscript(response, requestUrl);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stream") {
      return handleStream(response, requestUrl);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/translate") {
      return handleTranslate(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/transcribe") {
      return handleTranscribe(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/proofread") {
      return handleProofread(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/thumbnail") {
      return handleThumbnail(request, response);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/offline/save") {
      return handleOfflineSave(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/offline/library") {
      try {
        return sendJson(response, 200, { videos: await readOfflineLibrary(), storagePath: VIDEO_ROOT });
      } catch (error) {
        return sendJson(response, 500, { error: error.message || "The offline library could not be read." });
      }
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/offline/status") {
      const id = requestUrl.searchParams.get("id");
      try {
        const job = offlineJobs.get(safeVideoId(id));
        return job
          ? sendJson(response, 200, { ...job, ...downloadMetrics(job) })
          : sendJson(response, 404, { error: "No active download was found." });
      } catch (error) {
        return sendJson(response, 400, { error: error.message });
      }
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/offline/files") {
      return handleOfflineFiles(response, requestUrl.searchParams.get("id"), requestUrl.searchParams.get("path"));
    }
    if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/offline/")) {
      return handleOfflineDelete(response, requestUrl.pathname.slice("/api/offline/".length));
    }
    if ((request.method === "GET" || request.method === "HEAD") && requestUrl.pathname.startsWith("/offline-media/")) {
      return serveOfflineFile(request, response, requestUrl.pathname);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/scan-folder") {
      return handleScanFolder(response, requestUrl);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/folder-metadata") {
      return handleUpdateFolderMetadata(request, response);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/choose-folder") {
      return handleChooseFolder(response);
    }
    if ((request.method === "GET" || request.method === "HEAD") && (requestUrl.pathname === "/api/local-media" || requestUrl.pathname.startsWith("/local-media/"))) {
      return serveLocalMedia(request, response, requestUrl);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    return serveStatic(response, requestUrl.pathname);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other Material Picker process (lsof -i :${PORT}) or set PORT to another value.`
      );
      process.exit(1);
    }
    throw error;
  });
  server.listen(PORT, "0.0.0.0", () => {
    const mode = IS_DEV ? "development" : "production";
    console.log(`Material Picker running at http://localhost:${PORT} (${mode}, serving ${PUBLIC_ROOT})`);
    if (IS_DEV) {
      console.log("Local UI changes in public/ apply on refresh. picker.rynell.org is a separate deploy (npm run deploy).");
    }
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  assertUnencryptedHls,
  downloadMetrics,
  extractPlayerConfig,
  fetchPage,
  getVimeoTranscript,
  handleOfflineFiles,
  handleProofread,
  handleScanFolder,
  handleUpdateFolderMetadata,
  handleStream,
  handleTranscribe,
  handleTranslate,
  isHlsPackageDirectory,
  isPublicIp,
  listArchiveFiles,
  parseVtt,
  parseHlsAttributes,
  pcmBufferToFloat32,
  proofreadText,
  resolveLocalPath,
  resolveOfflineSource,
  sanitizeOfflineMaster,
  safeVideoId,
  scanDirectoryForVideos,
  selectHlsVariant,
  serveLocalMedia,
  splitTranslationText,
  STANDALONE_VIDEO_EXTENSIONS,
  startServer,
  SUPPORTED_VIDEO_EXTENSIONS,
  transcriptFromCues,
  validateRemoteUrl,
};
