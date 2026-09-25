(function attachMaterialPickerCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MaterialPickerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMaterialPickerCore() {
  const VIDEO_EXTENSION = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi|flv|wmv|ts|3gp|m3u8)([?#].*)?$/i;
  const VIDEO_PROVIDER = /youtube\.com|youtu\.be|vimeo\.com|wistia\.com|wistia\.net|brightcove|jwplayer/i;

// sourcery skip: avoid-function-declarations-in-blocks
  function decodeHtml(value) {
    return String(value || "")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/\\\//g, "/");
  }

  function cleanUrl(url) {
    return decodeHtml(url).replace(/[),.;]+$/g, "").trim();
  }

  function toAbsoluteUrl(url, baseUrl = "", fallbackUrl = "http://localhost/") {
    if (!url) return "";
    try {
      return new URL(cleanUrl(url), baseUrl || fallbackUrl).href;
    } catch {
      return "";
    }
  }

  function isLikelyVideoUrl(url) {
    return VIDEO_EXTENSION.test(url) || VIDEO_PROVIDER.test(url);
  }

  function inferTitleFromUrl(url) {
    if (!url) return "Untitled video";
    try {
      const parsed = new URL(url);
      const last = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
      return decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
    } catch {
      return "Untitled video";
    }
  }

  function parseAttributes(tag) {
    const attributes = {};
    const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match;
    while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = decodeHtml(match[3]);
    return attributes;
  }

  function extractVideos(text, baseUrl = "") {
    const found = new Map();
    const add = (url, label = "") => {
      const absolute = toAbsoluteUrl(url, baseUrl);
      if (!absolute || !isLikelyVideoUrl(absolute)) return;
      const title = decodeHtml(label).trim() || inferTitleFromUrl(absolute);
      const current = found.get(absolute);
      if (!current || (current.title === inferTitleFromUrl(absolute) && label)) {
        found.set(absolute, { url: absolute, title, sourceUrl: baseUrl || absolute });
      }
    };

    const source = String(text || "");
    const tagPattern = /<[^>]+>/g;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(source))) {
      const attributes = parseAttributes(tagMatch[0]);
      if (attributes["data-video-url"]) {
        add(attributes["data-video-url"], attributes["data-video-title"] || attributes.title || "");
      }
      Object.entries(attributes).forEach(([name, value]) => {
        if (/^(src|href|data-src|data-url|data-video-url|data-media-url)$/.test(name)) add(value);
      });
    }

    const decodedSource = decodeHtml(source);
    const urlPattern = /https?:\/\/[^\s"'<>\\)]+/gi;
    (decodedSource.match(urlPattern) || []).forEach((url) => add(cleanUrl(url)));
    return [...found.values()];
  }

  function toEmbedUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtube.com")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const id = parsed.searchParams.get("v") || (parts[0] === "embed" ? parts[1] : parts.at(-1));
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }
      if (parsed.hostname === "youtu.be") {
        const id = parsed.pathname.split("/").filter(Boolean)[0];
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }
      if (parsed.hostname.includes("vimeo.com")) {
        const id = parsed.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
        return id ? `https://player.vimeo.com/video/${id}` : "";
      }
      if (parsed.hostname.includes("wistia")) {
        const id = parsed.pathname.split("/").filter(Boolean).at(-1);
        return id ? `https://fast.wistia.net/embed/iframe/${id}` : "";
      }
    } catch {
      return "";
    }
    return "";
  }

  function playbackKind(url) {
    const embedUrl = toEmbedUrl(url);
    if (embedUrl) return { kind: "embed", embedUrl };
    if (VIDEO_EXTENSION.test(url || "")) return { kind: "video", embedUrl: "" };
    return { kind: "unsupported", embedUrl: "" };
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function estimateRemainingSeconds(elapsedSeconds, completed, total) {
    const elapsed = Number(elapsedSeconds);
    const done = Number(completed);
    const whole = Number(total);
    if (!(elapsed >= 1) || !(done > 0) || !(whole > done)) return null;
    return (elapsed * (whole - done)) / done;
  }

  function libraryMediaSummary(videos) {
    return (videos || []).reduce(
      (summary, video) => {
        summary.durationSeconds += Number(video?.durationSeconds) || 0;
        summary.bytes += Number(video?.offlineSize || video?.estimatedBytes) || 0;
        return summary;
      },
      { durationSeconds: 0, bytes: 0 }
    );
  }

  function formatDuration(value) {
    const totalMinutes = Math.max(1, Math.ceil(Number(value || 0) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function archiveFolderName(title, id) {
    const safeTitle = String(title || "Offline video")
      .replace(/[\u200b-\u200d\uFEFF\u200e\u200f\u202a-\u202e]/g, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72)
      .replace(/[.\s\-_]+$/g, "")
      .trim() || "Offline video";
    const safeId = String(id || "video").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "video";
    return `${safeTitle} - ${safeId}`;
  }

  function saveState(storage, key, state) {
    storage.setItem(key, JSON.stringify(state));
  }

  function moveVideosToCollection(videos, selectedIds, collectionId) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
    let moved = 0;
    videos.forEach((video) => {
      if (!selected.has(video.id)) return;
      video.collectionId = collectionId || "";
      moved += 1;
    });
    return moved;
  }

  function removeCollection(collections, videos, collectionId) {
    let unfiledCount = 0;
    videos.forEach((video) => {
      if (video.collectionId !== collectionId) return;
      video.collectionId = "";
      unfiledCount += 1;
    });
    return {
      collections: collections.filter((collection) => collection.id !== collectionId),
      unfiledCount,
    };
  }

  function hlsAttribute(line, name) {
    const quoted = line.match(new RegExp(`${name}="([^"]*)"`, "i"));
    if (quoted) return quoted[1];
    const bare = line.match(new RegExp(`${name}=([^,]*)`, "i"));
    return bare ? bare[1] : "";
  }

  function parseHlsPlaylist(text, playlistUrl) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let audioPlaylistUrl = "";
    let variantUrl = "";
    let initUrl = "";
    const segments = [];
    let pendingDuration = 0;
    let cursor = 0;
    let sawStreamInf = false;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/i.test(line)) {
        const uri = hlsAttribute(line, "URI");
        if (!uri) return;
        const resolved = toAbsoluteUrl(uri, playlistUrl);
        if (/DEFAULT=YES/i.test(line) || !audioPlaylistUrl) audioPlaylistUrl = resolved;
        return;
      }
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        sawStreamInf = true;
        return;
      }
      if (line.startsWith("#EXT-X-MAP:")) {
        const uri = hlsAttribute(line, "URI");
        if (uri) initUrl = toAbsoluteUrl(uri, playlistUrl);
        return;
      }
      if (line.startsWith("#EXTINF:")) {
        pendingDuration = Number.parseFloat(line.slice("#EXTINF:".length)) || 0;
        return;
      }
      if (line.startsWith("#")) return;
      if (sawStreamInf && !variantUrl) {
        variantUrl = toAbsoluteUrl(line, playlistUrl);
        sawStreamInf = false;
        return;
      }
      if (pendingDuration <= 0) return;
      segments.push({
        url: toAbsoluteUrl(line, playlistUrl),
        duration: pendingDuration,
        start: cursor,
      });
      cursor += pendingDuration;
      pendingDuration = 0;
    });

    return { audioPlaylistUrl, variantUrl, initUrl, segments };
  }

  function loadState(storage, key) {
    try {
      const stored = JSON.parse(storage.getItem(key));
      if (stored && Array.isArray(stored.videos)) {
        return {
          ...stored,
          collections: Array.isArray(stored.collections) ? stored.collections : [],
          scrapeHistory: Array.isArray(stored.scrapeHistory) ? stored.scrapeHistory : [],
        };
      }
    } catch {
      storage.removeItem(key);
    }
    return { selectedId: null, videos: [], collections: [], scrapeHistory: [] };
  }

  function parseOfflineArchiveRequirements(masterText, subPlaylists = {}) {
    if (!masterText || !String(masterText).trim().startsWith("#EXTM3U")) {
      return {
        format: "file",
        playlists: [],
        videoSegments: ["video.mp4"],
        audioSegments: [],
        totalDuration: 0,
      };
    }

    const lines = String(masterText).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const audioPlaylistUris = [];
    const variantUris = [];
    let sawStreamInf = false;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/i.test(line)) {
        const uri = hlsAttribute(line, "URI");
        if (uri) audioPlaylistUris.push(uri);
        return;
      }
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        sawStreamInf = true;
        return;
      }
      if (line.startsWith("#")) return;
      if (sawStreamInf) {
        variantUris.push(line);
        sawStreamInf = false;
        return;
      }
    });

    if (!variantUris.length && !audioPlaylistUris.length) {
      variantUris.push("playlist.m3u8");
      subPlaylists["playlist.m3u8"] = masterText;
    }

    const playlists = ["master.m3u8"];
    const videoSegments = [];
    const audioSegments = [];
    let totalDuration = 0;

    function parseMediaPlaylist(playlistPath, text, isAudio) {
      if (!playlists.includes(playlistPath)) playlists.push(playlistPath);
      const dir = playlistPath.includes("/") ? playlistPath.slice(0, playlistPath.lastIndexOf("/")) : "";
      const resolvePath = (uri) => (dir ? `${dir}/${uri}` : uri);

      const pLines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let pendingDuration = 0;

      pLines.forEach((line) => {
        if (line.startsWith("#EXT-X-MAP:")) {
          const uri = hlsAttribute(line, "URI");
          if (uri) {
            const path = resolvePath(uri);
            if (isAudio) {
              if (!audioSegments.includes(path)) audioSegments.push(path);
            } else if (!videoSegments.includes(path)) {
              videoSegments.push(path);
            }
          }
          return;
        }
        if (line.startsWith("#EXTINF:")) {
          pendingDuration = Number.parseFloat(line.slice("#EXTINF:".length)) || 0;
          return;
        }
        if (line.startsWith("#")) return;
        if (pendingDuration > 0) {
          const path = resolvePath(line);
          if (isAudio) {
            if (!audioSegments.includes(path)) audioSegments.push(path);
          } else {
            if (!videoSegments.includes(path)) videoSegments.push(path);
            totalDuration += pendingDuration;
          }
          pendingDuration = 0;
        }
      });
    }

    variantUris.forEach((vPath) => {
      const text = subPlaylists[vPath] || "";
      parseMediaPlaylist(vPath, text, false);
    });

    audioPlaylistUris.forEach((aPath) => {
      const text = subPlaylists[aPath] || "";
      parseMediaPlaylist(aPath, text, true);
    });

    return {
      format: "hls",
      playlists,
      videoSegments,
      audioSegments,
      totalDuration: Math.round(totalDuration),
    };
  }

  function isLikelyValidMediaChunk(bytes) {
    if (!bytes || bytes.length < 8) return false;
    const sample = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 64))).toLowerCase();
    if (sample.includes("<!doctype") || sample.includes("<html") || sample.includes("error") || sample.includes("{\"")) {
      return false;
    }
    if (bytes[0] === 0x47) return true;
    const box = String.fromCharCode(...bytes.subarray(4, 8)).toLowerCase();
    const validBoxes = ["ftyp", "moof", "mdat", "styp", "free", "skip", "wide"];
    if (validBoxes.includes(box)) return true;
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return true;
    return bytes.some((b) => b === 0 || b > 127);
  }

  async function verifyArchive(requirements, fileChecker) {
    const missing = [];
    const corrupt = [];
    let totalBytes = 0;
    let videoFound = 0;
    let audioFound = 0;
    const validFiles = [];

    for (const path of requirements.playlists) {
      const info = await fileChecker(path);
      if (!info.exists) {
        missing.push(path);
      } else if (info.size <= 0) {
        corrupt.push(path);
      } else {
        validFiles.push(path);
        totalBytes += info.size;
      }
    }

    for (const path of requirements.videoSegments) {
      const info = await fileChecker(path, { sampleBytes: 32 });
      if (!info.exists) {
        missing.push(path);
      } else if (info.size <= 0 || (info.sample && !isLikelyValidMediaChunk(info.sample))) {
        corrupt.push(path);
      } else {
        videoFound += 1;
        validFiles.push(path);
        totalBytes += info.size;
      }
    }

    for (const path of requirements.audioSegments) {
      const info = await fileChecker(path, { sampleBytes: 32 });
      if (!info.exists) {
        missing.push(path);
      } else if (info.size <= 0 || (info.sample && !isLikelyValidMediaChunk(info.sample))) {
        corrupt.push(path);
      } else {
        audioFound += 1;
        validFiles.push(path);
        totalBytes += info.size;
      }
    }

    const expectedVideo = requirements.videoSegments.length;
    const expectedAudio = requirements.audioSegments.length;
    const totalExpected = expectedVideo + expectedAudio + requirements.playlists.length;
    const healthy = missing.length === 0 && corrupt.length === 0 && totalExpected > 0;
    const playable = healthy && (videoFound > 0 || requirements.format === "file");

    let message = "";
    if (healthy) {
      const parts = [];
      if (expectedVideo > 0) parts.push(`${videoFound} video`);
      if (expectedAudio > 0) parts.push(`${audioFound} audio`);
      const pieces = parts.length ? parts.join(" + ") + " segments" : "files";
      message = `Verified: all ${pieces} intact (${formatBytes(totalBytes)}). Playable.`;
    } else {
      const issues = [];
      if (missing.length) issues.push(`${missing.length} missing`);
      if (corrupt.length) issues.push(`${corrupt.length} corrupted`);
      message = `Incomplete: ${issues.join(", ")} (${videoFound}/${expectedVideo} video, ${audioFound}/${expectedAudio} audio).`;
    }

    return {
      healthy,
      playable,
      totalBytes,
      validFiles,
      videoSegments: { expected: expectedVideo, found: videoFound },
      audioSegments: { expected: expectedAudio, found: audioFound },
      missingFiles: missing,
      corruptedFiles: corrupt,
      message,
    };
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

  function groupFolderEntries(entries) {
    const hlsPackages = [];
    const packageByPrefix = new Map();
    const manifestPattern = /^(master|index)\.m3u8$/i;
    const list = entries || [];

    const ensurePackage = (rootPrefix, manifestName) => {
      let pkg = packageByPrefix.get(rootPrefix);
      if (!pkg) {
        pkg = { rootPrefix, manifestName, entries: [], metadataEntry: null };
        packageByPrefix.set(rootPrefix, pkg);
        hlsPackages.push(pkg);
      } else if (manifestPattern.test(manifestName)) {
        pkg.manifestName = manifestName;
      }
      return pkg;
    };

    list.forEach((e) => {
      const name = e.name || "";
      if (!manifestPattern.test(name)) return;
      const rel = e.relPath || name;
      const parts = rel.split("/").filter(Boolean);
      parts.pop();
      ensurePackage(parts.join("/"), name);
    });

    list.forEach((e) => {
      const name = (e.name || "").toLowerCase();
      if (!name.endsWith(".m3u8") || manifestPattern.test(e.name || "")) return;
      const rel = e.relPath || e.name;
      const parts = rel.split("/").filter(Boolean);
      parts.pop();
      const rootPrefix = parts.join("/");
      if (
        rootPrefix.endsWith("/audio") ||
        rootPrefix.endsWith("/video") ||
        rootPrefix.endsWith("/segments") ||
        rootPrefix === "audio" ||
        rootPrefix === "video" ||
        rootPrefix === "segments" ||
        packageByPrefix.has(rootPrefix) ||
        packageByPrefix.has("") ||
        [...packageByPrefix.keys()].some((prefix) => prefix && rootPrefix.startsWith(`${prefix}/`))
      ) {
        return;
      }
      const target = rootPrefix ? `${rootPrefix.toLowerCase()}/` : "";
      const hasSegmentsOrTracks = list.some((item) => {
        const itemRel = (item.relPath || item.name || "").toLowerCase();
        return (
          itemRel.startsWith(target) &&
          (itemRel.includes("/audio/") || itemRel.includes("/video/") || itemRel.includes("/segments/") || itemRel.endsWith(".m4s"))
        );
      });
      if (hasSegmentsOrTracks) ensurePackage(rootPrefix, e.name);
    });

    hlsPackages.sort((a, b) => b.rootPrefix.length - a.rootPrefix.length);

    const standaloneEntries = [];

    (entries || []).forEach((e) => {
      const rel = e.relPath || e.name || "";
      let matchedPackage = null;
      for (const pkg of hlsPackages) {
        if (pkg.rootPrefix === "" || rel === pkg.rootPrefix || rel.startsWith(`${pkg.rootPrefix}/`)) {
          matchedPackage = pkg;
          break;
        }
      }

      if (matchedPackage) {
        if ((e.name || "").toLowerCase() === "metadata.json") {
          matchedPackage.metadataEntry = e;
        }
        matchedPackage.entries.push(e);
      } else {
        const lowerName = (e.name || "").toLowerCase();
        const lowerRel = rel.toLowerCase();
        const isInternal =
          lowerName === "playlist.m3u8" ||
          lowerName === "master.m3u8" ||
          lowerName === "index.m3u8" ||
          lowerName === "metadata.json" ||
          lowerRel.includes("/segments/") ||
          lowerRel.includes("/audio/") ||
          lowerRel.includes("/video/") ||
          /^\d{5,}\.(mp4|m4s|ts)$/i.test(lowerName);

        if (!isInternal && isLikelyVideoUrl(e.name)) {
          standaloneEntries.push(e);
        }
      }
    });

    return { hlsPackages, standaloneEntries };
  }

  return {
    cleanUrl,
    archiveFolderName,
    decodeHtml,
    extractVideos,
    estimateRemainingSeconds,
    formatBytes,
    formatDuration,
    groupFolderEntries,
    libraryMediaSummary,
    inferTitleFromUrl,
    isLikelyValidMediaChunk,
    isLikelyVideoUrl,
    loadState,
    parseHlsPlaylist,
    parseOfflineArchiveRequirements,
    moveVideosToCollection,
    playbackKind,
    proofreadText,
    removeCollection,
    saveState,
    toAbsoluteUrl,
    toEmbedUrl,
    verifyArchive,
  };
});
