const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export function parseChapterClock(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const parts = text.split(":").map((part) => Number(part) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

export function formatChapterClock(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clocked = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : clocked;
}

export function normalizeChapters(chapters) {
  const seen = new Set();
  return chapters
    .map((chapter) => {
      const title = String(chapter.title || chapter.text || "").trim();
      const startSeconds = Number.isFinite(chapter.startSeconds)
        ? chapter.startSeconds
        : parseChapterClock(chapter.time);
      const time = chapter.time || formatChapterClock(startSeconds);
      return { title, startSeconds, time };
    })
    .filter((chapter) => chapter.title)
    .filter((chapter) => {
      const key = `${chapter.startSeconds}|${chapter.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function decodeJsonString(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\u([\da-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function youtubeChaptersFromWatchHtml(html) {
  const text = String(html || "");
  const chapters = [];
  const macroRe =
    /macroMarkersListItemRenderer":\{[\s\S]*?"title":\{"simpleText":"((?:\\.|[^"\\])*)"\}[\s\S]*?"timeDescription":\{"simpleText":"([^"]+)"\}/g;
  let match;
  while ((match = macroRe.exec(text))) {
    chapters.push({
      title: decodeJsonString(match[1]),
      time: match[2],
      startSeconds: parseChapterClock(match[2]),
    });
  }
  const rendererRe =
    /chapterRenderer":\{[\s\S]*?"title":\{"simpleText":"((?:\\.|[^"\\])*)"\}[\s\S]*?"timeRangeStartMillis":(\d+)/g;
  while ((match = rendererRe.exec(text))) {
    const startSeconds = Math.round(Number(match[2]) / 1000);
    chapters.push({
      title: decodeJsonString(match[1]),
      time: formatChapterClock(startSeconds),
      startSeconds,
    });
  }
  return normalizeChapters(chapters);
}

function parseVideoTarget(videoUrl) {
  let parsed;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    const id =
      host === "youtu.be"
        ? parsed.pathname.split("/").filter(Boolean)[0]
        : parsed.searchParams.get("v") ||
          (parsed.pathname.startsWith("/embed/") ? parsed.pathname.split("/")[2] : parsed.pathname.split("/").filter(Boolean).at(-1));
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    return { source: "youtube", id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id =
      host === "player.vimeo.com" && parts[0] === "video" && parts.length === 2
        ? parts[1]
        : host === "vimeo.com" && parts.length === 1
          ? parts[0]
          : parts.find((part) => /^\d{5,}$/.test(part)) || "";
    if (!/^\d{5,}$/.test(id)) return null;
    return { source: "vimeo", id, canonicalUrl: `https://vimeo.com/${id}` };
  }
  return null;
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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parseVttClock(value) {
  const text = String(value || "").trim().replace(",", ".");
  const match = text.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export function chaptersFromVtt(vtt) {
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
    if (!text) return;
    const startSeconds = parseVttClock(start);
    cues.push({
      title: text,
      time: formatChapterClock(startSeconds),
      startSeconds,
    });
  });
  return normalizeChapters(cues);
}

async function fetchYoutubeChapters(target, fetchImpl) {
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${target.id}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error("YouTube did not return chapter information.");
    error.status = 502;
    throw error;
  }
  const chapters = youtubeChaptersFromWatchHtml(await response.text());
  if (!chapters.length) {
    const error = new Error("This video does not list chapters on YouTube.");
    error.status = 404;
    throw error;
  }
  return { chapters, source: "youtube", url: target.canonicalUrl };
}

async function fetchVimeoChapters(target, fetchImpl) {
  const response = await fetchImpl(`https://player.vimeo.com/video/${target.id}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`Vimeo returned ${response.status}.`);
    error.status = 502;
    throw error;
  }
  const config = extractPlayerConfig(await response.text());
  const tracks = config.request?.text_tracks || [];
  const chapterTrack =
    tracks.find((item) => String(item.kind || "").toLowerCase() === "chapters") ||
    tracks.find((item) => /chapter/i.test(String(item.label || "")));
  if (!chapterTrack?.url) {
    const error = new Error("This Vimeo video does not provide a public chapter track.");
    error.status = 404;
    throw error;
  }
  const caption = await fetchImpl(chapterTrack.url, {
    headers: { "user-agent": USER_AGENT, accept: "text/vtt,text/plain,*/*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!caption.ok) {
    const error = new Error(`Vimeo chapters returned ${caption.status}.`);
    error.status = 502;
    throw error;
  }
  const chapters = chaptersFromVtt(await caption.text());
  if (!chapters.length) {
    const error = new Error("The chapter track was empty.");
    error.status = 404;
    throw error;
  }
  return { chapters, source: "vimeo", url: target.canonicalUrl, label: chapterTrack.label || "Chapters" };
}

export async function fetchVideoChapters(videoUrl, fetchImpl = fetch) {
  const target = parseVideoTarget(videoUrl);
  if (!target) {
    const error = new Error("Chapters are only available for YouTube and Vimeo videos.");
    error.status = 400;
    throw error;
  }
  if (target.source === "youtube") return fetchYoutubeChapters(target, fetchImpl);
  return fetchVimeoChapters(target, fetchImpl);
}
