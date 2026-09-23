(function attachMaterialPickerCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MaterialPickerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMaterialPickerCore() {
  const VIDEO_EXTENSION = /\.(mp4|webm|ogv|ogg|mov|m4v|m3u8)([?#].*)?$/i;
  const VIDEO_PROVIDER = /youtube\.com|youtu\.be|vimeo\.com|wistia\.com|wistia\.net|brightcove|jwplayer/i;

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

  function formatDuration(value) {
    const totalMinutes = Math.max(1, Math.ceil(Number(value || 0) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
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

  return {
    cleanUrl,
    decodeHtml,
    extractVideos,
    formatBytes,
    formatDuration,
    inferTitleFromUrl,
    isLikelyVideoUrl,
    loadState,
    moveVideosToCollection,
    playbackKind,
    removeCollection,
    saveState,
    toAbsoluteUrl,
    toEmbedUrl,
  };
});
