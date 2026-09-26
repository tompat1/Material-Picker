const STORAGE_KEY = "material-picker:v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const core = window.MaterialPickerCore;
const { archiveFolderName, estimateRemainingSeconds, formatBytes, formatDuration, libraryMediaSummary } = core;

const els = {
  addBlankButton: document.querySelector("#addBlankButton"),
  bulkDownloadProgress: document.querySelector("#bulkDownloadProgress"),
  bulkDownloadReport: document.querySelector("#bulkDownloadReport"),
  bulkOfflineStatus: document.querySelector("#bulkOfflineStatus"),
  bulkOfflineProgress: document.querySelector("#bulkOfflineProgress"),
  bulkOfflineProgressLabel: document.querySelector("#bulkOfflineProgressLabel"),
  checkLibraryButton: document.querySelector("#checkLibraryButton"),
  chooseLibraryFolderButton: document.querySelector("#chooseLibraryFolderButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  clearAllButton: document.querySelector("#clearAllButton"),
  deleteCollectionButton: document.querySelector("#deleteCollectionButton"),
  downloadTranscriptButton: document.querySelector("#downloadTranscriptButton"),
  embedPlayer: document.querySelector("#embedPlayer"),
  emptyPlayer: document.querySelector("#emptyPlayer"),
  folderScanForm: document.querySelector("#folderScanForm"),
  folderPath: document.querySelector("#folderPath"),
  browseFolderButton: document.querySelector("#browseFolderButton"),
  scanFolderButton: document.querySelector("#scanFolderButton"),
  folderCreateCollection: document.querySelector("#folderCreateCollection"),
  localFolderInput: document.querySelector("#localFolderInput"),
  htmlPaste: document.querySelector("#htmlPaste"),
  historyCount: document.querySelector("#historyCount"),
  libraryTotals: document.querySelector("#libraryTotals"),
  historyList: document.querySelector("#historyList"),
  latestOfflineSource: document.querySelector("#latestOfflineSource"),
  latestScannedFolder: document.querySelector("#latestScannedFolder"),
  useOfflineSourceButton: document.querySelector("#useOfflineSourceButton"),
  useScannedFolderButton: document.querySelector("#useScannedFolderButton"),
  importForm: document.querySelector("#importForm"),
  collectionCount: document.querySelector("#collectionCount"),
  collectionForm: document.querySelector("#collectionForm"),
  collectionList: document.querySelector("#collectionList"),
  collectionName: document.querySelector("#collectionName"),
  libraryOfflinePermission: document.querySelector("#libraryOfflinePermission"),
  libraryDestinationStatus: document.querySelector("#libraryDestinationStatus"),
  markAllOfflineButton: document.querySelector("#markAllOfflineButton"),
  verifyOfflineButton: document.querySelector("#verifyOfflineButton"),
  moveCollectionSelect: document.querySelector("#moveCollectionSelect"),
  moveSelectedButton: document.querySelector("#moveSelectedButton"),
  openSourceButton: document.querySelector("#openSourceButton"),
  openVideoButton: document.querySelector("#openVideoButton"),
  parsePasteButton: document.querySelector("#parsePasteButton"),
  playerShell: document.querySelector(".player-shell"),
  playerLoadingOverlay: document.querySelector("#playerLoadingOverlay"),
  playerLoadingText: document.querySelector("#playerLoadingText"),
  proofreadButton: document.querySelector("#proofreadButton"),
  proofreadStripTimestamps: document.querySelector("#proofreadStripTimestamps"),
  proofreadGroupSpeakers: document.querySelector("#proofreadGroupSpeakers"),
  playerStatus: document.querySelector("#playerStatus"),
  retryPlaybackButton: document.querySelector("#retryPlaybackButton"),
  renameCollectionButton: document.querySelector("#renameCollectionButton"),
  searchLibrary: document.querySelector("#searchLibrary"),
  saveSelectedOfflineButton: document.querySelector("#saveSelectedOfflineButton"),
  screenMeta: document.querySelector("#screenMeta"),
  sourceFrame: document.querySelector("#sourceFrame"),
  sourceDisclosure: document.querySelector("#sourceDisclosure"),
  sourceLang: document.querySelector("#sourceLang"),
  sourceUrl: document.querySelector("#sourceUrl"),
  selectVisibleButton: document.querySelector("#selectVisibleButton"),
  selectedCount: document.querySelector("#selectedCount"),
  startTranscriptButton: document.querySelector("#startTranscriptButton"),
  statusLine: document.querySelector("#statusLine"),
  stopTranscriptButton: document.querySelector("#stopTranscriptButton"),
  targetLang: document.querySelector("#targetLang"),
  translateButton: document.querySelector("#translateButton"),
  translatedText: document.querySelector("#translatedText"),
  transcriptText: document.querySelector("#transcriptText"),
  transcriptStatus: document.querySelector("#transcriptStatus"),
  videoCount: document.querySelector("#videoCount"),
  videoCountLabel: document.querySelector("#videoCountLabel"),
  videoForm: document.querySelector("#videoForm"),
  videoLanguage: document.querySelector("#videoLanguage"),
  videoList: document.querySelector("#videoList"),
  videoNotes: document.querySelector("#videoNotes"),
  videoPlayer: document.querySelector("#videoPlayer"),
  videoSource: document.querySelector("#videoSource"),
  videoSpeaker: document.querySelector("#videoSpeaker"),
  videoTags: document.querySelector("#videoTags"),
  videoTitle: document.querySelector("#videoTitle"),
  videoUrl: document.querySelector("#videoUrl"),
};

let recognition = null;
let hlsPlayer = null;
let offlineStoragePath = "";
let offlineExportDirectoryHandle = null;
let bulkOfflineRunning = false;
let bulkOfflineMessage = "";
let bulkOfflineCurrentId = "";
let bulkOfflineIndex = 0;
let bulkOfflineTotal = 0;
let bulkOfflineStartedAt = 0;
let bulkOfflineEstimatedBytes = 0;
let bulkOfflineCompletedBytes = 0;
let bulkOfflineEstimateByFiles = false;
let bulkOfflineReport = null;
let libraryMeasureRunning = false;
let verificationRunning = false;
let state = loadState();
let activeCollectionId = "all";
let folderBrowseRunning = false;
const selectedVideoIds = new Set();
const offlinePackageFiles = new Map();
const sourcePreviewCache = new Map();
let sourcePreviewUrl = "";
let sourcePreviewRequestId = 0;

class PackageHlsLoader {
  constructor(config) {
    this.config = config;
    const BaseLoader = window.Hls?.DefaultConfig?.loader;
    this.defaultLoader = BaseLoader ? new BaseLoader(config) : null;
    this.stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };
  }

  destroy() {
    this.defaultLoader?.destroy?.();
  }

  abort() {
    this.defaultLoader?.abort?.();
  }

  load(context, config, callbacks) {
    const url = context?.url || "";
    const match = url.match(/\/hls-package\/([^/]+)\/(.+)$/);
    if (!match) {
      if (this.defaultLoader) {
        this.defaultLoader.load(context, config, callbacks);
      } else if (callbacks?.onError) {
        callbacks.onError({ code: 404, text: "Loader unavailable" }, context);
      }
      return;
    }

    const packageId = match[1];
    let rawPath = decodeURIComponent(match[2]).split("?")[0].split("#")[0].replace(/^\/+/, "");
    const pathParts = [];
    rawPath.split("/").forEach((p) => {
      if (p === "..") pathParts.pop();
      else if (p && p !== ".") pathParts.push(p);
    });
    const requestedPath = pathParts.join("/");
    const fileMap = offlinePackageFiles.get(packageId);

    if (!fileMap) {
      if (callbacks?.onError) {
        callbacks.onError({ code: 404, text: "Re-select the folder to play this offline video." }, context);
      }
      return;
    }

    let target = fileMap.get(requestedPath) || fileMap.get(requestedPath.toLowerCase());
    if (!target) {
      const reqBase = requestedPath.split("/").pop().toLowerCase();
      for (const [key, val] of fileMap.entries()) {
        const lKey = key.toLowerCase();
        const lReq = requestedPath.toLowerCase();
        if (lKey === lReq || lKey.endsWith("/" + lReq) || lReq.endsWith("/" + lKey) || lKey.split("/").pop() === reqBase) {
          target = val;
          break;
        }
      }
    }

    if (!target) {
      console.warn("File not found in package:", requestedPath, "Available entries:", Array.from(fileMap.keys()).slice(0, 15));
      if (callbacks?.onError) {
        callbacks.onError({ code: 404, text: `File “${requestedPath}” not found in package` }, context);
      }
      return;
    }

    const resolveFile = () => {
      if (target instanceof File) return Promise.resolve(target);
      if (target.file instanceof File) return Promise.resolve(target.file);
      if (typeof target.getFile === "function") return target.getFile();
      if (typeof target.handle?.getFile === "function") return target.handle.getFile();
      return Promise.reject(new Error(`File handle not readable for ${requestedPath}`));
    };

    const isPlaylist =
      context.type === "manifest" ||
      context.type === "level" ||
      context.type === "audioTrack" ||
      context.type === "subtitleTrack" ||
      context.responseType === "text" ||
      requestedPath.endsWith(".m3u8") ||
      requestedPath.endsWith(".vtt");

    const trequest = performance.now();
    this.stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: trequest, first: trequest, end: 0 },
      parsing: { start: trequest, end: trequest },
      buffering: { start: 0, first: 0, end: 0 },
    };

    resolveFile()
      .then((file) => {
        if (!file) throw new Error(`File is unavailable: ${requestedPath}`);
        const tfirst = performance.now();
        this.stats.loading.first = tfirst;
        const readPromise = isPlaylist
          ? file.text().then((text) => requestedPath.endsWith(".m3u8") ? core.sanitizeOfflineHlsManifest(text) : text)
          : file.arrayBuffer();
        return readPromise.then((data) => {
          const tload = performance.now();
          this.stats.loading.end = tload;
          this.stats.tload = tload;
          this.stats.loaded = file.size;
          this.stats.total = file.size;
          this.stats.bwEstimate = file.size > 0 ? (file.size * 8000) / Math.max(1, tload - trequest) : 0;

          try {
            callbacks.onSuccess({ url: context.url, data, code: 200 }, this.stats, context);
          } catch (callErr) {
            console.error("Hls.js onSuccess callback error:", callErr);
          }
        });
      })
      .catch((err) => {
        console.error("PackageHlsLoader failed to read file:", requestedPath, err);
        if (callbacks?.onError) {
          callbacks.onError({ code: 404, text: err.message }, context);
        }
      });
  }
}

init();

function init() {
  bindEvents();
  render();
  state.videos.forEach((video) => {
    if (!["downloading", "exporting"].includes(video.offlineDownloadStatus)) return;
    video.offlineDownloadStatus = "interrupted";
    video.offlineError = "The download stopped. Continue to pick up the pieces already saved.";
    selectedVideoIds.add(video.id);
  });
  saveState();
  void restoreDownloadFolder().then(() => loadFolderScript(selectedVideo()));
  void reconcileOfflineLibrary();
  void repairLegacyPageRecords({ automatic: true });
}

function bindEvents() {
  els.folderScanForm?.addEventListener("submit", handleFolderScan);
  els.browseFolderButton?.addEventListener("click", handleBrowseFolder);
  els.localFolderInput?.addEventListener("change", handleLocalFolderInput);
  els.importForm.addEventListener("submit", handleImport);
  els.parsePasteButton.addEventListener("click", handlePasteExtract);
  els.addBlankButton.addEventListener("click", () => {
    addVideo({ title: "Untitled video" });
    setStatus("Created a blank video record.");
  });
  els.clearAllButton.addEventListener("click", clearAll);
  els.checkLibraryButton.addEventListener("click", checkLibraryPlayback);
  els.chooseLibraryFolderButton.addEventListener("click", chooseOfflineFolder);
  els.collectionForm.addEventListener("submit", createCollection);
  els.clearSelectionButton.addEventListener("click", clearVideoSelection);
  els.clearHistoryButton.addEventListener("click", clearScrapeHistory);
  els.useOfflineSourceButton.addEventListener("click", useLatestOfflineSource);
  els.useScannedFolderButton.addEventListener("click", useLatestScannedFolder);
  els.deleteCollectionButton.addEventListener("click", deleteActiveCollection);
  els.openSourceButton.addEventListener("click", openSource);
  els.openVideoButton.addEventListener("click", openVideoSource);
  els.libraryOfflinePermission.addEventListener("change", renderLibraryOfflineManager);
  els.retryPlaybackButton.addEventListener("click", retryPlayback);
  els.renameCollectionButton.addEventListener("click", renameActiveCollection);
  els.searchLibrary.addEventListener("input", () => {
    renderLibrary();
    renderCollectionManager();
  });
  els.selectVisibleButton.addEventListener("click", selectVisibleVideos);
  els.markAllOfflineButton.addEventListener("click", toggleMarkAllOffline);
  els.verifyOfflineButton?.addEventListener("click", handleVerifyOfflineButtonClick);
  els.saveSelectedOfflineButton.addEventListener("click", saveSelectedOfflineVideos);
  els.moveSelectedButton.addEventListener("click", moveSelectedVideos);
  els.videoForm.addEventListener("submit", (event) => event.preventDefault());
  els.videoForm.addEventListener("input", updateSelectedFromForm);
  els.videoForm.addEventListener("change", updateSelectedFromForm);
  els.transcriptText.addEventListener("input", updateTranscriptFields);
  els.translatedText.addEventListener("input", updateTranscriptFields);
  els.startTranscriptButton.addEventListener("click", startTranscription);
  els.stopTranscriptButton.addEventListener("click", stopTranscription);
  els.translateButton.addEventListener("click", translateTranscript);
  els.proofreadButton.addEventListener("click", proofreadTranscript);
  els.downloadTranscriptButton.addEventListener("click", downloadTranscript);
  els.sourceDisclosure?.addEventListener("toggle", () => {
    if (els.sourceDisclosure.open) void loadSourcePreview();
  });
  els.videoPlayer?.addEventListener("playing", hidePlayerLoading);
  els.videoPlayer?.addEventListener("canplay", hidePlayerLoading);
  els.videoPlayer?.addEventListener("loadeddata", hidePlayerLoading);
}

function isLocalServer() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

async function processImportedFolderEntries(entries, rootFolderName, defaultCollectionId = "") {
  if (!entries || entries.length === 0) {
    setStatus("Selected folder contains no supported video files.");
    return 0;
  }

  if (els.folderPath) {
    els.folderPath.value = rootFolderName;
  }

  const { hlsPackages, standaloneEntries } = core.groupFolderEntries(entries);

  let collectionId = defaultCollectionId;
  if (els.folderCreateCollection?.checked && rootFolderName) {
    let existing = state.collections.find(
      (c) => c.name.toLowerCase() === rootFolderName.toLowerCase()
    );
    if (!existing) {
      existing = {
        id: crypto.randomUUID(),
        name: rootFolderName,
        createdAt: new Date().toISOString(),
      };
      state.collections.push(existing);
    }
    collectionId = existing.id;
    activeCollectionId = collectionId;
  }

  let addedCount = 0;
  let firstAddedId = null;

  // Process HLS packages
  for (const pkg of hlsPackages) {
    const packageId = "pkg-" + crypto.randomUUID();
    const fileMap = new Map();
    let totalBytes = 0;

    pkg.entries.forEach((e) => {
      const rel = e.relPath || e.name;
      const innerPath = pkg.rootPrefix
        ? rel.startsWith(pkg.rootPrefix + "/")
          ? rel.slice(pkg.rootPrefix.length + 1)
          : rel
        : rel;
      fileMap.set(innerPath, e);
      fileMap.set(innerPath.toLowerCase(), e);
      fileMap.set(e.name, e);
      fileMap.set(e.name.toLowerCase(), e);
      totalBytes += Number(e.file?.size || e.size || 0);
    });
    offlinePackageFiles.set(packageId, fileMap);

    let meta = null;
    if (pkg.metadataEntry) {
      try {
        const metaFile = pkg.metadataEntry.file || (await pkg.metadataEntry.handle?.getFile());
        if (metaFile) meta = JSON.parse(await metaFile.text());
      } catch {}
    }

    const folderTitle = pkg.rootPrefix
      ? pkg.rootPrefix.split("/").pop().replace(/[-_]+/g, " ").trim()
      : rootFolderName !== "videos" && rootFolderName !== "data"
      ? rootFolderName.replace(/[-_]+/g, " ").trim()
      : "";
    const split = core.splitTitleAndSpeaker(meta?.title || folderTitle || "Offline HLS Video");
    const packageUrl = `/hls-package/${packageId}/${pkg.manifestName}`;
    const tagsList = meta?.tags
      ? (Array.isArray(meta.tags) ? meta.tags : String(meta.tags).split(",")).map((tag) => String(tag).trim()).filter(Boolean)
      : pkg.rootPrefix ? pkg.rootPrefix.split("/").filter(Boolean) : ["local", "hls"];

    const nextVideo = {
      id: meta?.id || crypto.randomUUID(),
      title: split.title,
      speaker: meta?.speaker || split.speaker || "",
      url: packageUrl,
      sourceUrl: meta?.sourceUrl || (pkg.rootPrefix ? `${pkg.rootPrefix}/${pkg.manifestName}` : pkg.manifestName),
      language: meta?.language || "",
      tags: tagsList.join(", "),
      notes: meta?.notes || `HLS Package: ${pkg.rootPrefix || rootFolderName} (${formatBytes(meta?.size || totalBytes)})`,
      durationSeconds: Number(meta?.durationSeconds) || 0,
      transcript: meta?.transcript || "",
      translation: meta?.translation || "",
      transcriptLanguage: meta?.transcriptLanguage || "",
      transcriptSource: meta?.transcriptSource || "",
      collectionId: collectionId || (activeCollectionId !== "all" && activeCollectionId !== "unfiled" ? activeCollectionId : ""),
      playbackStatus: "ready",
      playbackMessage: "Offline HLS package ready with audio/video segments",
      checkedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      format: "hls",
      packageId,
      offlineUrl: packageUrl,
      offlineFormat: "hls",
      offlineSize: meta?.size || totalBytes,
      offlineSavedAt: meta?.savedAt || meta?.downloadedAt || new Date().toISOString(),
      offlineProvider: meta?.provider || "vimeo",
      mediaMeasured: true,
      estimatedBytes: meta?.size || totalBytes,
    };

    state.videos.unshift(nextVideo);
    if (!firstAddedId) firstAddedId = nextVideo.id;
    addedCount += 1;
  }

  // Process standalone video entries
  for (const item of standaloneEntries) {
    let { file } = item;
    if (!file && item.handle?.getFile) {
      try { file = await item.handle.getFile(); } catch {}
    }
    if (!file) continue;
    const { name, relPath } = item;
    const title = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
    const objectUrl = URL.createObjectURL(file);
    const pathParts = (relPath || "").split("/");
    const subfolders = pathParts.slice(0, -1);
    const tagsList = subfolders.length > 0 ? subfolders : ["local"];

    const nextVideo = {
      id: crypto.randomUUID(),
      title: title || name,
      speaker: "",
      url: objectUrl,
      sourceUrl: relPath || name,
      language: "English",
      tags: tagsList.join(", "),
      notes: `File: ${relPath || name} (${formatBytes(file.size)})`,
      transcript: "",
      translation: "",
      collectionId: collectionId || (activeCollectionId !== "all" && activeCollectionId !== "unfiled" ? activeCollectionId : ""),
      playbackStatus: "ready",
      playbackMessage: "Local media file ready for playback",
      checkedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    state.videos.unshift(nextVideo);
    if (!firstAddedId) firstAddedId = nextVideo.id;
    addedCount += 1;
  }

  if (firstAddedId) {
    state.selectedId = firstAddedId;
  }

  saveState();
  render();

  setStatus(
    `Imported ${addedCount} video ${addedCount === 1 ? "item" : "items"} from “${rootFolderName}”. Ready to play!`
  );
  if (addedCount) showDesk(addedCount === 1 ? "screen" : "reels");
  return addedCount;
}

function addLocalVideoFiles(videoFiles, rootFolderName, defaultCollectionId = "") {
  return processImportedFolderEntries(videoFiles, rootFolderName, defaultCollectionId);
}

async function importFromDirectoryHandle(dirHandle) {
  const rootFolderName = dirHandle.name || "Imported Folder";
  if (els.folderPath) els.folderPath.value = rootFolderName;
  setStatus(`Scanning “${rootFolderName}” and all subfolders for videos...`, true);
  if (els.scanFolderButton) els.scanFolderButton.disabled = true;

  try {
    const entries = [];

    const walk = async (handle, pathParts = []) => {
      try {
        for await (const entry of handle.values()) {
          try {
            if (entries.length && entries.length % 400 === 0) {
              setStatus(`Scanning “${rootFolderName}”… ${entries.length} files`, true);
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
            if (entry.kind === "file") {
              const lowerName = entry.name.toLowerCase();
              if (
                core.isLikelyVideoUrl(entry.name) ||
                lowerName.endsWith(".m3u8") ||
                lowerName.endsWith(".m4s") ||
                lowerName.endsWith(".ts") ||
                lowerName === "metadata.json"
              ) {
                let file = null;
                if (lowerName === "metadata.json") {
                  try { file = await entry.getFile(); } catch {}
                }
                entries.push({
                  file,
                  handle: entry,
                  name: entry.name,
                  subfolders: pathParts,
                  relPath: [...pathParts, entry.name].join("/"),
                });
              }
            } else if (entry.kind === "directory" && !entry.name.startsWith(".") && entry.name !== "node_modules") {
              await walk(entry, [...pathParts, entry.name]);
            }
          } catch (entryErr) {
            console.warn("Skipping file entry:", entry.name, entryErr);
          }
        }
      } catch (dirErr) {
        console.warn("Skipping directory:", pathParts.join("/"), dirErr);
      }
    }

    await walk(dirHandle, []);
    await processImportedFolderEntries(entries, rootFolderName);
  } catch (error) {
    setStatus(`Folder import error: ${error.message}`, false);
  } finally {
    if (els.scanFolderButton) els.scanFolderButton.disabled = false;
  }
}

async function handleBrowseFolder() {
  if (folderBrowseRunning) {
    setStatus("The folder picker is already open. Finish that prompt to continue.", true);
    return;
  }

  folderBrowseRunning = true;
  if (els.browseFolderButton) els.browseFolderButton.disabled = true;

  try {
    // On web deployments (Cloudflare Workers / non-localhost), use browser directory picker directly:
    if (!isLocalServer()) {
      if (typeof window.showDirectoryPicker === "function") {
        try {
          const dirHandle = await window.showDirectoryPicker();
          await importFromDirectoryHandle(dirHandle);
          return;
        } catch (err) {
          if (err.name === "AbortError") return; // user cancelled dialog
          if (err.name === "NotAllowedError" && /picker already active/i.test(err.message || "")) return;
          console.warn("showDirectoryPicker error, falling back to input:", err);
        }
      }
      // Safari / Firefox / fallback file input on web:
      if (els.localFolderInput) {
        els.localFolderInput.click();
      }
      return;
    }

    // Running on local server (localhost):
    try {
      const response = await fetch("/api/choose-folder", { signal: AbortSignal.timeout(120000) });
      if (response.ok) {
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}
        if (data?.supported && data.chosenPath) {
          els.folderPath.value = data.chosenPath;
          setStatus(`Selected folder: “${data.chosenPath}”. Scanning for videos...`, true);
          await scanFolderPath(data.chosenPath);
          return;
        }
        if (data?.supported && data.cancelled) {
          return;
        }
      }
    } catch {
      // If server helper is not available, fallback
    }

    if (typeof window.showDirectoryPicker === "function") {
      try {
        const dirHandle = await window.showDirectoryPicker();
        await importFromDirectoryHandle(dirHandle);
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // user cancelled dialog
        if (err.name === "NotAllowedError" && /picker already active/i.test(err.message || "")) return;
      }
    }

    if (els.localFolderInput) {
      els.localFolderInput.click();
    }
  } finally {
    folderBrowseRunning = false;
    if (els.browseFolderButton) els.browseFolderButton.disabled = false;
  }
}

async function handleFolderScan(event) {
  if (event?.preventDefault) event.preventDefault();
  const folderPath = els.folderPath.value.trim();

  if (!isLocalServer()) {
    setStatus("Select the local folder from your computer to scan videos...", false);
    handleBrowseFolder();
    return;
  }

  if (!folderPath) {
    setStatus("Enter or browse for a local folder path first.", false);
    return;
  }

  await scanFolderPath(folderPath);
}

async function scanFolderPath(folderPath) {
  state.lastScannedFolder = folderPath;
  saveState();
  renderRecentSources();
  setStatus(`Scanning folder “${folderPath}” and all nested subfolders...`, true);
  if (els.scanFolderButton) els.scanFolderButton.disabled = true;

  try {
    const response = await fetch(`/api/scan-folder?path=${encodeURIComponent(folderPath)}`, {
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    let result = null;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned ${response.status} (non-JSON). Make sure the local server is running with 'npm start' or 'npm run dev'.`
      );
    }
    if (!response.ok) {
      throw new Error(result?.error || `Server responded with ${response.status}`);
    }

    const { folderName, videos = [], totalCount = 0 } = result;
    if (totalCount === 0 || videos.length === 0) {
      setStatus(`Scanned “${folderName}” (including subfolders), but found no supported video files.`, false);
      return;
    }

    let collectionId = "";
    if (els.folderCreateCollection?.checked) {
      let existing = state.collections.find(
        (c) => c.name.toLowerCase() === folderName.toLowerCase()
      );
      if (!existing) {
        existing = {
          id: crypto.randomUUID(),
          name: folderName,
          createdAt: new Date().toISOString(),
        };
        state.collections.push(existing);
      }
      collectionId = existing.id;
      activeCollectionId = collectionId;
    }

    let addedCount = 0;
    let firstAddedId = null;
    let firstMatchedId = null;

    videos.forEach((item) => {
      const existing = state.videos.find((v) => v.url === item.url || (item.id && v.id === item.id));
      if (existing) {
        if (!firstMatchedId) firstMatchedId = existing.id;
        if (collectionId && !existing.collectionId) {
          existing.collectionId = collectionId;
        }
        if (item.format) existing.format = item.format;
        if (item.offlineUrl) existing.offlineUrl = item.offlineUrl;
        if (item.offlineFormat) existing.offlineFormat = item.offlineFormat;
        if (item.offlineSize) existing.offlineSize = item.offlineSize;
        if (item.sourceUrl && !existing.sourceUrl) existing.sourceUrl = item.sourceUrl;
        fillBlankMetadata(existing, item);
        return;
      }

      const tagsList = [];
      if (item.subfolder) {
        tagsList.push(...item.subfolder.split("/").map((s) => s.trim()).filter(Boolean));
      } else {
        tagsList.push("local");
      }

      const split = core.splitTitleAndSpeaker(item.title);
      const nextVideo = {
        id: item.id || crypto.randomUUID(),
        title: split.title,
        speaker: item.speaker || split.speaker || "",
        url: item.url,
        sourceUrl: item.sourceUrl || item.relativePath || folderPath,
        language: item.language || "",
        tags: item.tags || tagsList.join(", "),
        notes: item.notes || `File: ${item.relativePath || item.name} (${formatBytes(item.size)})`,
        durationSeconds: Number(item.durationSeconds) || 0,
        transcript: item.transcript || "",
        translation: item.translation || "",
        transcriptLanguage: item.transcriptLanguage || "",
        transcriptSource: item.transcriptSource || "",
        collectionId: collectionId || (activeCollectionId !== "all" && activeCollectionId !== "unfiled" ? activeCollectionId : ""),
        playbackStatus: "ready",
        playbackMessage: item.format === "hls" ? "Local HLS package ready for playback" : "Local media file ready for playback",
        checkedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        format: item.format || (item.url?.endsWith(".m3u8") ? "hls" : undefined),
        offlineUrl: item.offlineUrl || item.url,
        offlineFormat: item.offlineFormat || item.format,
        offlineSize: item.offlineSize || item.size,
        offlineSavedAt: item.offlineSavedAt,
        offlineProvider: item.offlineProvider,
      };

      state.videos.unshift(nextVideo);
      if (!firstAddedId) firstAddedId = nextVideo.id;
      addedCount += 1;
    });

    const targetId = firstAddedId || firstMatchedId;
    if (targetId) {
      state.selectedId = targetId;
    }

    saveState();
    render();

    const distinctSubfolders = new Set(videos.map((v) => v.subfolder).filter(Boolean));
    const subfolderInfo = distinctSubfolders.size > 0 ? ` across ${distinctSubfolders.size} subfolders` : "";

    const countMsg = addedCount > 0
      ? `Scraped ${addedCount} new video ${addedCount === 1 ? "file" : "files"}${subfolderInfo} into “${folderName}”. Ready to play!`
      : `Refreshed ${videos.length} video ${videos.length === 1 ? "file" : "files"}${subfolderInfo} in “${folderName}”. Selected and ready to play!`;

    setStatus(countMsg, false);
    showDesk("screen");
  } catch (error) {
    setStatus(`Folder scan error: ${error.message}`, false);
  } finally {
    if (els.scanFolderButton) els.scanFolderButton.disabled = false;
  }
}

async function handleLocalFolderInput(event) {
  const fileList = event.target.files;
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  const entries = files
    .filter((file) => {
      const lower = file.name.toLowerCase();
      return (
        core.isLikelyVideoUrl(file.name) ||
        lower.endsWith(".m3u8") ||
        lower.endsWith(".m4s") ||
        lower.endsWith(".ts") ||
        lower === "metadata.json"
      );
    })
    .map((file) => {
      const relPath = file.webkitRelativePath || file.name;
      const pathParts = relPath.split("/");
      const subfolders = pathParts.slice(1, -1);
      return { file, name: file.name, subfolders, relPath };
    });

  const samplePath = (fileList[0] && fileList[0].webkitRelativePath) || "";
  const rootFolderName = samplePath.split("/")[0] || "Imported Folder";

  await processImportedFolderEntries(entries, rootFolderName);
  event.target.value = "";
}

async function handleImport(event) {
  event.preventDefault();
  const url = els.sourceUrl.value.trim();
  if (!url) {
    setStatus("Add a page URL first.");
    return;
  }

  setSourceFrame(url);
  setStatus("Scanning the page for video material...");

  try {
    const page = await fetchPageForImport(url);
    cacheSourcePreview(url, page.html, page.finalUrl || url);
    const items = extractVideos(page.html, page.finalUrl || url);
    const imported = addExtractedVideos(items, url);
    recordScrape(url, {
      status: "completed",
      foundCount: items.length,
      addedCount: imported.added,
      method: page.method,
    });
    if (imported.added) presentImportedVideos(imported.ids);
    else {
      setStatus(
        items.length
          ? "Those videos are already in the library. Mark the ones you want, choose a folder, and download them."
          : "The page loaded, but no video links were found. Paste page HTML or embed code into the extractor."
      );
    }
  } catch (error) {
    recordScrape(url, {
      status: "blocked",
      foundCount: 0,
      addedCount: 0,
      method: "page scan",
      message: error.message,
    });
    setStatus(`The page could not be scanned: ${error.message}. Paste the page HTML or video links below.`);
  }
}

async function fetchPageForImport(url) {
  try {
    const response = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`The page returned ${response.status}.`);
    return { html: await response.text(), finalUrl: response.url || url, method: "browser scan" };
  } catch {
    let relayResponse;
    try {
      relayResponse = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new Error("The site blocks a direct scan, and the scan relay did not respond.");
    }
    let relayData = null;
    try {
      relayData = await relayResponse.json();
    } catch {
      relayData = null;
    }
    if (!relayResponse.ok || typeof relayData?.html !== "string") {
      throw new Error(
        relayData?.error || "The site blocks a direct scan, and the scan relay is not available."
      );
    }
    return { html: relayData.html, finalUrl: relayData.finalUrl || url, method: "secure relay" };
  }
}

function handlePasteExtract() {
  const text = els.htmlPaste.value.trim();
  const sourceUrl = els.sourceUrl.value.trim();
  if (!text) {
    setStatus("Paste HTML, embed code, or video links first.");
    return;
  }
  const items = extractVideos(text, sourceUrl);
  const imported = addExtractedVideos(items, sourceUrl);
  if (sourceUrl) {
    recordScrape(sourceUrl, {
      status: "completed",
      foundCount: items.length,
      addedCount: imported.added,
      method: "pasted source",
    });
  }
  if (imported.added) presentImportedVideos(imported.ids);
  else {
    setStatus(
      items.length
        ? "Those videos are already in the library. Mark the ones you want, choose a folder, and download them."
        : "No supported video links were found. Try pasting the page source or direct embed code."
    );
  }
}

function extractVideos(text, baseUrl = "") {
  return core.extractVideos(text, baseUrl);
}

function fillBlankMetadata(video, item) {
  const split = core.splitTitleAndSpeaker(item?.title || "");
  if (!video.speaker) video.speaker = item?.speaker || split.speaker || "";
  if (!video.language && item?.language) video.language = item.language;
  if (!video.tags && item?.tags) video.tags = Array.isArray(item.tags) ? item.tags.join(", ") : item.tags;
  if (!video.notes && item?.notes) video.notes = item.notes;
  if (!video.transcript && item?.transcript) video.transcript = item.transcript;
  if (!video.translation && item?.translation) video.translation = item.translation;
  if (!video.transcriptLanguage && item?.transcriptLanguage) video.transcriptLanguage = item.transcriptLanguage;
  if (!video.transcriptSource && item?.transcriptSource) video.transcriptSource = item.transcriptSource;
  if (!Number(video.durationSeconds) && Number(item?.durationSeconds) > 0) video.durationSeconds = Number(item.durationSeconds);
  if (split.speaker && video.title === item?.title) video.title = split.title;
}

function addExtractedVideos(items, sourceUrl = "") {
  const ids = [];
  items.forEach((item) => {
    if (state.videos.some((video) => video.url === item.url)) return;
    ids.push(
      addVideo(
        {
          title: core.splitTitleAndSpeaker(item.title).title,
          speaker: item.speaker || core.splitTitleAndSpeaker(item.title).speaker,
          url: item.url,
          sourceUrl: item.sourceUrl || sourceUrl,
          language: item.language || "",
          tags: item.tags || inferTags(item.url),
          notes: item.notes || "",
          durationSeconds: Number(item.durationSeconds) || 0,
        },
        { reveal: false }
      )
    );
  });
  return { added: ids.length, ids };
}

function presentImportedVideos(ids) {
  ids.forEach((id) => selectedVideoIds.add(id));
  activeCollectionId = "all";
  showDesk("reels");
  render();
  const count = ids.length;
  const folder = offlineExportDirectoryHandle?.name;
  setStatus(
    folder
      ? `Marked ${count} video${count === 1 ? "" : "s"} from this scan. Confirm permission, then download them to “${folder}”. Uncheck any you want to skip.`
      : `Marked ${count} video${count === 1 ? "" : "s"} from this scan. Choose a folder on this computer, confirm permission, then download them. Uncheck any you want to skip.`
  );
  document.querySelector(".library-offline-bar")?.scrollIntoView({ block: "nearest" });
}

function addVideo(video, options = {}) {
  const next = {
    id: crypto.randomUUID(),
    title: video.title || inferTitleFromUrl(video.url || video.sourceUrl || ""),
    speaker: video.speaker || "",
    url: video.url || "",
    sourceUrl: video.sourceUrl || "",
    language: video.language || "",
    tags: video.tags || "",
    notes: video.notes || "",
    transcript: video.transcript || "",
    translation: video.translation || "",
    collectionId:
      video.collectionId || (activeCollectionId !== "all" && activeCollectionId !== "unfiled" ? activeCollectionId : ""),
    playbackStatus: video.playbackStatus || "unchecked",
    playbackMessage: video.playbackMessage || "Not checked yet",
    checkedAt: video.checkedAt || "",
    createdAt: new Date().toISOString(),
  };
  state.videos.unshift(next);
  state.selectedId = next.id;
  saveState();
  render();
  if (options.reveal !== false) showDesk("screen");
  return next.id;
}

function updateSelectedFromForm() {
  const video = selectedVideo();
  if (!video) return;
  const previousUrl = video.url;
  const previousSource = video.sourceUrl;
  Object.assign(video, {
    title: els.videoTitle.value,
    speaker: els.videoSpeaker.value,
    url: els.videoUrl.value,
    sourceUrl: els.videoSource.value,
    language: els.videoLanguage.value,
    tags: els.videoTags.value,
    notes: els.videoNotes.value,
  });
  const urlChanged = previousUrl !== video.url;
  if (urlChanged) {
    video.playbackStatus = "unchecked";
    video.playbackMessage = "URL changed; check playback again";
    video.checkedAt = "";
    if (video.offlineUrl) video.offlineStale = true;
    delete video.durationSeconds;
    delete video.estimatedBytes;
    delete video.mediaMeasured;
  }
  saveState();
  renderLibrary();
  if (urlChanged) renderPlayer();
  if (previousSource !== video.sourceUrl) setSourceFrame(video.sourceUrl, false);
  setStatus("Saved.");
  scheduleFolderMetadataSave(video, { announce: true });
}

function updateTranscriptFields() {
  const video = selectedVideo();
  if (!video) return;
  video.transcript = els.transcriptText.value;
  video.translation = els.translatedText.value;
  saveState();
  renderLibrary();
  scheduleFolderMetadataSave(video);
}

function selectVideo(id) {
  const current = selectedVideo();
  if (current && current.id !== id) void flushFolderMetadata(current);
  state.selectedId = id;
  saveState();
  render();
  showDesk("screen");
  void loadFolderScript(selectedVideo());
}

function showDesk(name) {
  const tabName = name === "reels" ? "library" : name;
  const tab = document.querySelector(`#desk-${tabName}`);
  if (!tab || !window.matchMedia("(max-width: 1180px)").matches) return;
  tab.checked = true;
}

function clearAll() {
  if (!state.videos.length) return;
  const shouldClear = confirm("Clear all saved videos and transcripts from this browser?");
  if (!shouldClear) return;
  state = {
    selectedId: null,
    videos: [],
    collections: state.collections || [],
    scrapeHistory: state.scrapeHistory || [],
    lastOfflineFolderName: state.lastOfflineFolderName || "",
    lastScannedFolder: state.lastScannedFolder || "",
  };
  selectedVideoIds.clear();
  saveState();
  render();
  setStatus("All saved material was cleared from this browser.");
}

function render() {
  renderVideoCount();
  renderLibrary();
  renderCollectionManager();
  renderScrapeHistory();
  renderRecentSources();
  renderForm();
  renderPlayer();
  renderLibraryOfflineManager();
  renderTranscript();
}

function recordScrape(url, details) {
  const entry = {
    id: crypto.randomUUID(),
    url,
    scrapedAt: new Date().toISOString(),
    status: details.status || "completed",
    method: details.method || "page scan",
    foundCount: details.foundCount || 0,
    addedCount: details.addedCount || 0,
    message: details.message || "",
  };
  state.scrapeHistory = [entry, ...(state.scrapeHistory || [])].slice(0, 100);
  saveState();
  renderScrapeHistory();
}

function renderRecentSources() {
  const offlineFolder = state.lastOfflineFolderName || "";
  const scannedFolder = state.lastScannedFolder || "";
  els.latestOfflineSource.textContent = offlineFolder || "None yet";
  els.latestOfflineSource.title = offlineFolder;
  els.useOfflineSourceButton.disabled = !offlineFolder;
  els.latestScannedFolder.textContent = scannedFolder || "None yet";
  els.latestScannedFolder.title = scannedFolder;
  els.useScannedFolderButton.disabled = !scannedFolder;
}

async function useLatestOfflineSource() {
  if (!state.lastOfflineFolderName) return;
  const ready = await ensureDownloadFolder();
  if (!ready) return;
  setStatus(`Downloads will be saved in “${offlineExportDirectoryHandle.name}”.`);
  renderOfflineDestination();
  renderLibraryOfflineManager();
}

function useLatestScannedFolder() {
  if (!state.lastScannedFolder || !els.folderPath) return;
  els.folderPath.value = state.lastScannedFolder;
  els.folderPath.focus();
  setStatus(`Folder restored. Select Scan to import “${state.lastScannedFolder}” again.`);
}

function renderScrapeHistory() {
  const history = state.scrapeHistory || [];
  els.historyCount.textContent = history.length;
  els.historyList.innerHTML = "";
  els.clearHistoryButton.disabled = !history.length;

  if (!history.length) {
    els.historyList.innerHTML = '<p class="hint empty-note">Scanned pages show up here.</p>';
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.dataset.status = entry.status;
    const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(entry.scrapedAt)
    );
    const result = entry.status === "blocked" ? "scan blocked" : `${entry.foundCount} found, ${entry.addedCount} added`;
    item.innerHTML = `
      <a class="history-url" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a>
      <span class="history-meta">${escapeHtml(when)} · ${escapeHtml(entry.method)} · ${escapeHtml(result)}</span>
      <button class="ghost-button history-use" type="button">Use</button>
    `;
    item.querySelector(".history-use").addEventListener("click", () => {
      els.sourceUrl.value = entry.url;
      setSourceFrame(entry.url, false);
      els.sourceUrl.focus();
      setStatus("History link restored. Select Scan to scrape it again.");
    });
    els.historyList.append(item);
  });
}

function clearScrapeHistory() {
  if (!(state.scrapeHistory || []).length) return;
  if (!confirm("Clear the saved scrape history from this browser?")) return;
  state.scrapeHistory = [];
  saveState();
  renderScrapeHistory();
  setStatus("Scrape history cleared.");
}

function renderVideoCount() {
  els.videoCount.textContent = state.videos.length;
  if (els.videoCountLabel) els.videoCountLabel.textContent = state.videos.length === 1 ? "reel" : "reels";
}

function videoRuntimeLabel(video) {
  const seconds = Number(video?.durationSeconds) || 0;
  return seconds > 0 ? formatDuration(seconds) : "";
}

function videoSizeLabel(video) {
  const bytes = Number(video?.offlineSize || video?.estimatedBytes) || 0;
  return bytes > 0 ? formatBytes(bytes) : "";
}

function renderLibraryTotals() {
  if (!els.libraryTotals) return;
  const { videos } = state;
  if (!videos.length) {
    els.libraryTotals.textContent = "";
    return;
  }
  const summary = libraryMediaSummary(videos);
  const parts = [];
  if (summary.durationSeconds > 0) parts.push(formatDuration(summary.durationSeconds));
  if (summary.bytes > 0) parts.push(formatBytes(summary.bytes));
  const waiting = videos.some((video) => !video.mediaMeasured && canSaveOfflineUrl(video.url));
  if (!parts.length && waiting) {
    els.libraryTotals.textContent = "Measuring run time and file size…";
    return;
  }
  els.libraryTotals.textContent = parts.join(" · ");
}

function rememberMediaMeasure(video, plan) {
  if (Number(plan?.durationSeconds) > 0) video.durationSeconds = plan.durationSeconds;
  if (Number(plan?.estimatedBytes) > 0) video.estimatedBytes = plan.estimatedBytes;
  video.mediaMeasured = true;
}

async function measureLibraryMedia() {
  if (libraryMeasureRunning) return;
  const pending = state.videos.filter((video) => !video.mediaMeasured && canSaveOfflineUrl(video.url));
  if (!pending.length) return;
  libraryMeasureRunning = true;
  renderLibraryTotals();
  try {
    for (const video of pending) {
      if (!state.videos.includes(video) || video.mediaMeasured) continue;
      try {
        rememberMediaMeasure(video, await loadDownloadPlan(video));
      } catch {
        video.mediaMeasured = true;
      }
      saveState();
      renderLibrary();
    }
  } finally {
    libraryMeasureRunning = false;
    if (state.videos.some((video) => !video.mediaMeasured && canSaveOfflineUrl(video.url))) {
      void measureLibraryMedia();
    }
  }
}

function renderLibrary() {
  const filtered = visibleVideos();

  els.videoList.innerHTML = "";
  if (!filtered.length) {
    const searching = Boolean(els.searchLibrary.value.trim());
    let message = "This folder has no matching videos.";
    if (searching) message = "No videos match this search.";
    else if (activeCollectionId === "all") message = "The library is empty. Scan a folder or a page to add videos.";
    else if (activeCollectionId === "unfiled") message = "No unfiled videos.";
    els.videoList.innerHTML = `<div class="empty-reels"><p>${message}</p></div>`;
    renderVideoCount();
    renderLibraryTotals();
    void measureLibraryMedia();
    return;
  }

  const template = document.querySelector("#videoCardTemplate");
  filtered.forEach((video) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.videoId = video.id;
    card.classList.toggle("active", video.id === state.selectedId);
    card.classList.toggle("selected", selectedVideoIds.has(video.id));

    const collection = state.collections.find((item) => item.id === video.collectionId);
    const details = [video.speaker || video.language || "No speaker yet", video.tags || "untagged"];
    if (collection) details.push(collection.name);
    const runtime = videoRuntimeLabel(video);
    const size = videoSizeLabel(video);
    if (runtime) details.push(runtime);
    if (size) details.push(size);

    const main = card.querySelector(".card-main");
    main.innerHTML = `
      <strong>${escapeHtml(video.title || "Untitled video")}</strong>
      <span>${escapeHtml(details.join(" · "))}</span>
    `;
    main.addEventListener("click", () => selectVideo(video.id));

    const checkbox = card.querySelector(".video-select-input");
    checkbox.checked = selectedVideoIds.has(video.id);
    checkbox.setAttribute("aria-label", `Mark ${video.title || "Untitled video"} for offline copy`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedVideoIds.add(video.id);
      else selectedVideoIds.delete(video.id);
      card.classList.toggle("selected", checkbox.checked);
      renderCollectionManager();
      renderLibraryOfflineManager();
    });

    const badge = card.querySelector(".playback-badge");
    const status =
      ["downloading", "exporting"].includes(video.offlineDownloadStatus)
        ? "saving"
        : video.offlineVerification?.healthy
          ? "verified"
          : video.offlineVerification && !video.offlineVerification.healthy
            ? "incomplete"
            : video.offlineDownloadStatus === "failed" && !hasDiskCopy(video)
              ? "failed"
              : canResumeDownload(video)
                ? "paused"
                : hasDiskCopy(video)
                  ? "offline"
                  : video.playbackStatus || "unchecked";
    const labels = {
      blocked: "Blocked",
      checking: "Checking",
      ready: "Ready",
      saving: "Saving",
      paused: "Paused",
      failed: "Failed",
      offline: "Offline",
      verified: "Verified",
      incomplete: "Incomplete",
      unknown: "Manual check",
      unchecked: "Unchecked",
    };
    badge.textContent = labels[status] || labels.unchecked;
    badge.dataset.status = status;
    badge.title = video.offlineVerification?.message
      ? video.offlineVerification.message
      : video.offlineError
        ? `Offline error: ${video.offlineError}`
        : canResumeDownload(video)
          ? "Paused. Continue to pick up the saved pieces."
          : video.playbackMessage || "Not checked yet";
    const downloadProgress = card.querySelector(".card-download-progress");
    if (["downloading", "exporting", "interrupted", "failed"].includes(video.offlineDownloadStatus) && offlineProgressFraction(video) !== null) {
      const progress = offlineProgressFraction(video);
      const progressElement = downloadProgress.querySelector("progress");
      downloadProgress.hidden = false;
      if (progress === null) progressElement.removeAttribute("value");
      else progressElement.value = progress * 100;
      downloadProgress.querySelector("span").textContent = offlineProgressLabel(video);
    }
    els.videoList.append(card);
  });
  renderVideoCount();
  renderLibraryTotals();
  void measureLibraryMedia();
}

function visibleVideos() {
  const query = els.searchLibrary.value.trim().toLowerCase();
  return state.videos.filter((video) => {
    const matchesSearch = [video.title, video.speaker, video.tags, video.notes, video.url]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesCollection =
      activeCollectionId === "all" ||
      (activeCollectionId === "unfiled" ? !video.collectionId : video.collectionId === activeCollectionId);
    return matchesSearch && matchesCollection;
  });
}

function renderLibraryOfflineManager() {
  const visible = visibleVideos();
  const marked = state.videos.filter((video) => selectedVideoIds.has(video.id));
  const pending = marked.filter((video) => canSaveOfflineUrl(video.url) && !hasDiskCopy(video));
  const exportable = offlineExportDirectoryHandle
    ? marked.filter((video) => video.offlineUrl && !video.offlineStale && !video.offlineExportedTo)
    : [];
  const actionable = new Set([...pending, ...exportable].map((video) => video.id)).size;
  const eligibleVisible = visible.filter((video) => canSaveOfflineUrl(video.url));
  const allVisibleMarked =
    eligibleVisible.length > 0 && eligibleVisible.every((video) => selectedVideoIds.has(video.id));
  els.markAllOfflineButton.disabled = !eligibleVisible.length || bulkOfflineRunning || verificationRunning;
  els.markAllOfflineButton.querySelector("span:last-child").textContent = allVisibleMarked ? "Unmark all" : "Mark all";
  if (els.verifyOfflineButton) {
    els.verifyOfflineButton.disabled = bulkOfflineRunning || verificationRunning;
  }
  els.libraryOfflinePermission.disabled = !pending.length || bulkOfflineRunning || verificationRunning;
  if (offlineExportDirectoryHandle) els.libraryOfflinePermission.disabled = !actionable || bulkOfflineRunning || verificationRunning;
  els.saveSelectedOfflineButton.disabled =
    !actionable || !els.libraryOfflinePermission.checked || bulkOfflineRunning || verificationRunning;
  const paused = pending.filter((video) => canResumeDownload(video));
  els.saveSelectedOfflineButton.querySelector("span:last-child").textContent = paused.length
    ? "Continue"
    : offlineExportDirectoryHandle && pending.length === 0
      ? "Copy marked to folder"
      : "Download marked";
  renderOfflineDestination();
  renderBulkOfflineReport();
  els.bulkDownloadProgress.hidden = !bulkOfflineRunning && !paused.length;
  if (bulkOfflineRunning) {
    bulkOfflineReport = null;
    renderBulkOfflineReport();
    els.bulkOfflineStatus.textContent = bulkOfflineMessage || "Saving marked videos to disk...";
    const current = state.videos.find((video) => video.id === bulkOfflineCurrentId);
    const fraction = current ? offlineProgressFraction(current) : null;
    const aggregate = bulkOfflineTotal
      ? (bulkOfflineIndex + (fraction === null ? 0 : fraction)) / bulkOfflineTotal
      : 0;
    els.bulkOfflineProgress.value = Math.min(100, aggregate * 100);
    const totalRemaining = bulkDownloadRemainingSeconds(current);
    const wholeDownload = bulkOfflineTotal > 1 && totalRemaining
      ? ` · about ${formatDuration(totalRemaining)} left for the whole download`
      : "";
    els.bulkOfflineProgressLabel.textContent = current
      ? `Video ${bulkOfflineIndex + 1} of ${bulkOfflineTotal} · ${offlineProgressLabel(current)}${wholeDownload}`
      : bulkOfflineMessage || "Preparing downloads...";
  } else if (paused.length) {
    const savedParts = paused.reduce((total, video) => total + Number(video.offlineFilesDone || 0), 0);
    const allParts = paused.reduce((total, video) => total + Number(video.offlineFilesTotal || 0), 0);
    const fraction = allParts ? savedParts / allParts : 0;
    els.bulkOfflineProgress.value = Math.min(100, fraction * 100);
    els.bulkOfflineProgressLabel.textContent = allParts
      ? `${savedParts} of ${allParts} parts saved`
      : "Saved pieces are still in the folder";
    els.bulkOfflineStatus.textContent = `Download paused. ${savedParts ? `${savedParts} parts are already saved. ` : ""}Continue to pick up the rest.`;
  } else if (marked.length) {
    const saved = marked.filter((video) => video.offlineUrl && !video.offlineStale).length;
    const place = offlineExportDirectoryHandle?.name
      ? `“${offlineExportDirectoryHandle.name}”`
      : "a folder you choose";
    els.bulkOfflineStatus.textContent = pending.length
      ? `${marked.length} marked · ${pending.length} ready to download to ${place}.`
      : `${marked.length} marked · ${saved} already on disk.`;
  } else {
    els.bulkOfflineStatus.textContent = "Mark videos below to save them to disk.";
  }
}

function renderBulkOfflineReport() {
  if (!els.bulkDownloadReport) return;
  els.bulkDownloadReport.replaceChildren();
  if (!bulkOfflineReport || bulkOfflineRunning) {
    els.bulkDownloadReport.hidden = true;
    return;
  }

  const heading = document.createElement("strong");
  const failureCount = bulkOfflineReport.failures.length;
  heading.textContent = `${bulkOfflineReport.saved} of ${bulkOfflineReport.total} saved. ${failureCount} ${
    failureCount === 1 ? "video needs" : "videos need"
  } retry.`;

  const list = document.createElement("ul");
  bulkOfflineReport.failures.forEach((failure) => {
    const item = document.createElement("li");
    const title = document.createElement("span");
    const message = document.createElement("span");
    title.className = "bulk-report-title";
    message.className = "bulk-report-message";
    title.textContent = failure.title;
    message.textContent = failure.message;
    item.append(title, message);
    list.append(item);
  });

  els.bulkDownloadReport.append(heading, list);
  els.bulkDownloadReport.hidden = false;
}

function bulkDownloadRemainingSeconds(current) {
  const elapsedSeconds = bulkOfflineStartedAt ? (performance.now() - bulkOfflineStartedAt) / 1000 : 0;
  const done = bulkOfflineEstimateByFiles
    ? bulkOfflineCompletedBytes + Number(current?.offlineFilesDone || 0)
    : bulkOfflineCompletedBytes + Number(current?.offlineBytesDownloaded || 0);
  return estimateRemainingSeconds(elapsedSeconds, done, bulkOfflineEstimatedBytes);
}

function offlineProgressFraction(video) {
  const totalBytes = Number(video?.offlineTotalBytes || 0);
  if (totalBytes > 0) return Math.min(1, Number(video.offlineBytesDownloaded || 0) / totalBytes);
  const filesTotal = Number(video?.offlineFilesTotal || 0);
  if (filesTotal > 0) return Math.min(1, Number(video.offlineFilesDone || 0) / filesTotal);
  return null;
}

function offlineProgressLabel(video) {
  const bytes = formatBytes(video?.offlineBytesDownloaded || 0);
  const filesTotal = Number(video?.offlineFilesTotal || 0);
  const details = [
    filesTotal
      ? `${Number(video.offlineFilesDone || 0)} of ${filesTotal} parts · ${bytes}`
      : `${bytes} ${video?.offlineDownloadStatus === "exporting" ? "copied" : "saved"}`,
  ];
  const speed = Number(video?.offlineSpeedBytesPerSecond || 0);
  const eta = Number(video?.offlineEtaSeconds);
  if (video?.offlineStalled) details.push("paused · continues when the connection returns");
  else if (speed > 0) details.push(`${formatBytes(speed)}/s`);
  if (Number.isFinite(eta) && eta > 0) details.push(`about ${formatDuration(eta)} left`);
  return details.join(" · ");
}

function toggleMarkAllOffline() {
  const visible = visibleVideos().filter((video) => canSaveOfflineUrl(video.url));
  const shouldUnmark = visible.length > 0 && visible.every((video) => selectedVideoIds.has(video.id));
  visible.forEach((video) => {
    if (shouldUnmark) selectedVideoIds.delete(video.id);
    else selectedVideoIds.add(video.id);
  });
  renderLibrary();
  renderCollectionManager();
  renderLibraryOfflineManager();
}

function renderCollectionManager() {
  const collections = state.collections || [];
  els.collectionCount.textContent = collections.length;
  els.selectedCount.textContent = selectedVideoIds.size;
  els.collectionList.innerHTML = "";

  const views = [
    { id: "all", name: "All videos", count: state.videos.length },
    { id: "unfiled", name: "Unfiled", count: state.videos.filter((video) => !video.collectionId).length },
    ...collections.map((collection) => ({
      ...collection,
      count: state.videos.filter((video) => video.collectionId === collection.id).length,
    })),
  ];

  views.forEach((view) => {
    const button = document.createElement("button");
    button.className = "collection-item";
    button.type = "button";
    if (view.id === activeCollectionId) button.setAttribute("aria-current", "true");
    button.innerHTML = `<strong>${escapeHtml(view.name)}</strong><span>${view.count}</span>`;
    button.addEventListener("click", () => {
      activeCollectionId = view.id;
      renderLibrary();
      renderCollectionManager();
    });
    els.collectionList.append(button);
  });

  const isCustomCollection = collections.some((collection) => collection.id === activeCollectionId);
  els.renameCollectionButton.disabled = !isCustomCollection;
  els.deleteCollectionButton.disabled = !isCustomCollection;
  els.clearSelectionButton.disabled = !selectedVideoIds.size;
  els.moveSelectedButton.disabled = !selectedVideoIds.size;
  els.selectVisibleButton.disabled = !visibleVideos().length;

  const selectedTarget = els.moveCollectionSelect.value;
  els.moveCollectionSelect.innerHTML = '<option value="">Unfiled</option>';
  collections.forEach((collection) => {
    const option = document.createElement("option");
    option.value = collection.id;
    option.textContent = collection.name;
    els.moveCollectionSelect.append(option);
  });
  if ([...els.moveCollectionSelect.options].some((option) => option.value === selectedTarget)) {
    els.moveCollectionSelect.value = selectedTarget;
  }
}

function createCollection(event) {
  event.preventDefault();
  const name = els.collectionName.value.trim();
  if (!name) {
    setStatus("Name the folder before creating it.");
    return;
  }
  if (state.collections.some((collection) => collection.name.toLowerCase() === name.toLowerCase())) {
    setStatus("A folder with that name already exists.");
    return;
  }
  const collection = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
  state.collections.push(collection);
  activeCollectionId = collection.id;
  els.collectionName.value = "";
  saveState();
  renderLibrary();
  renderCollectionManager();
  setStatus(`Created the “${name}” folder.`);
}

function renameActiveCollection() {
  const collection = state.collections.find((item) => item.id === activeCollectionId);
  if (!collection) return;
  const nextName = prompt("Rename folder", collection.name)?.trim();
  if (!nextName || nextName === collection.name) return;
  if (state.collections.some((item) => item.id !== collection.id && item.name.toLowerCase() === nextName.toLowerCase())) {
    setStatus("A folder with that name already exists.");
    return;
  }
  collection.name = nextName;
  saveState();
  renderLibrary();
  renderCollectionManager();
  setStatus(`Renamed the folder to “${nextName}”.`);
}

function deleteActiveCollection() {
  const collection = state.collections.find((item) => item.id === activeCollectionId);
  if (!collection) return;
  const videoCount = state.videos.filter((video) => video.collectionId === collection.id).length;
  if (!confirm(`Delete the “${collection.name}” folder? Its ${videoCount} video${videoCount === 1 ? "" : "s"} will move to Unfiled.`)) return;
  const result = core.removeCollection(state.collections, state.videos, collection.id);
  state.collections = result.collections;
  activeCollectionId = "unfiled";
  saveState();
  renderLibrary();
  renderCollectionManager();
  setStatus(`Deleted the “${collection.name}” folder. Its videos are now Unfiled.`);
}

function selectVisibleVideos() {
  visibleVideos().forEach((video) => selectedVideoIds.add(video.id));
  renderLibrary();
  renderCollectionManager();
  renderLibraryOfflineManager();
}

function clearVideoSelection() {
  selectedVideoIds.clear();
  renderLibrary();
  renderCollectionManager();
  renderLibraryOfflineManager();
}

function moveSelectedVideos() {
  if (!selectedVideoIds.size) return;
  const collectionId = els.moveCollectionSelect.value;
  const collection = state.collections.find((item) => item.id === collectionId);
  const moved = core.moveVideosToCollection(state.videos, selectedVideoIds, collectionId);
  selectedVideoIds.clear();
  saveState();
  renderLibrary();
  renderCollectionManager();
  renderLibraryOfflineManager();
  setStatus(`Moved ${moved} video${moved === 1 ? "" : "s"} to ${collection?.name || "Unfiled"}.`);
}

function renderScreenMeta(video) {
  if (!els.screenMeta) return;
  const rows = [];
  if (Number(video?.durationSeconds) > 0) rows.push(["Duration", formatDuration(video.durationSeconds)]);
  const size = Number(video?.offlineSize || video?.estimatedBytes || 0);
  if (size > 0) rows.push(["Size", formatBytes(size)]);
  if (video?.offlineProvider) rows.push(["Provider", video.offlineProvider]);
  if (video?.offlineFormat || video?.format) rows.push(["Format", video.offlineFormat || video.format]);
  if (video?.offlineSavedAt) {
    const when = new Date(video.offlineSavedAt);
    if (!Number.isNaN(when.getTime())) rows.push(["Saved", when.toLocaleString()]);
  }
  els.screenMeta.hidden = !rows.length;
  els.screenMeta.innerHTML = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function renderForm() {
  const video = selectedVideo();
  const fields = [
    els.videoTitle,
    els.videoSpeaker,
    els.videoUrl,
    els.videoSource,
    els.videoLanguage,
    els.videoTags,
    els.videoNotes,
  ];
  fields.forEach((field) => {
    field.disabled = !video;
  });

  els.videoTitle.value = video?.title || "";
  els.videoSpeaker.value = video?.speaker || "";
  els.videoUrl.value = video?.url || "";
  els.videoSource.value = video?.sourceUrl || "";
  els.videoLanguage.value = video?.language || "";
  els.videoTags.value = video?.tags || "";
  els.videoNotes.value = video?.notes || "";
  renderScreenMeta(video);
  els.openSourceButton.disabled = !video?.sourceUrl;
  setSourceFrame(video?.sourceUrl || "", false);
}

async function resolveVideoStream(video) {
  if (!video?.url) return null;
  if (video.offlineUrl && !video.offlineStale) return video.offlineUrl;
  if (video.streamUrl) return video.streamUrl;
  if (/\.m3u8(?:[?#].*)?$/i.test(video.url) || /\.(?:mp4|webm|ogv|ogg|mov|m4v)(?:[?#].*)?$/i.test(video.url)) {
    video.streamUrl = video.url;
    return video.url;
  }
  try {
    const res = await fetch(`/api/stream?url=${encodeURIComponent(video.url)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      video.streamUrl = data.url;
      video.streamType = data.type;
      video.streamProvider = data.provider;
      return data.url;
    }
  } catch (err) {
    console.warn("Could not resolve video stream:", err);
  }
  return null;
}

async function ensurePlayerPlaying() {
  if (els.playerShell.dataset.mode === "video") {
    try {
      if (els.videoPlayer.paused) {
        await els.videoPlayer.play();
      }
    } catch (error) {
      console.warn("Automatic video playback could not be started:", error);
    }
  } else if (els.playerShell.dataset.mode === "embed") {
    try {
      els.embedPlayer.contentWindow?.postMessage(JSON.stringify({ method: "play" }), "*");
      els.embedPlayer.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo" }), "*");
    } catch (error) {
      console.warn("Automatic embed playback could not be started:", error);
    }
  }
}

function renderPlayer() {
  const video = selectedVideo();
  destroyHlsPlayer();
  els.videoPlayer.pause();
  els.videoPlayer.onloadedmetadata = null;
  els.videoPlayer.onerror = null;
  els.videoPlayer.removeAttribute("src");
  els.embedPlayer.removeAttribute("src");
  els.openVideoButton.disabled = !video?.url;
  els.retryPlaybackButton.disabled = !video?.url;

  if (!video?.url) {
    els.playerShell.dataset.mode = "empty";
    const emptyTitle = els.emptyPlayer.querySelector("strong");
    const emptyCopy = els.emptyPlayer.querySelector("span");
    if (video) {
      if (emptyTitle) emptyTitle.textContent = "No picture yet";
      if (emptyCopy) emptyCopy.textContent = "Add a video URL to put this reel on the screen.";
      setPlayerStatus("This reel has no video URL yet.");
    } else {
      if (emptyTitle) emptyTitle.textContent = "Screen is dark";
      if (emptyCopy) emptyCopy.textContent = "Select a reel, or scan a folder to load one.";
      setPlayerStatus("Select a saved video to begin.");
    }
    return;
  }

  const hasOfflineCopy = Boolean(video.offlineUrl && !video.offlineStale);
  if (hasOfflineCopy) {
    els.playerShell.dataset.mode = "video";
    if (video.format === "hls" || video.offlineFormat === "hls" || /\.m3u8([?#].*)?$/i.test(video.offlineUrl)) {
      if (video.offlineUrl.includes("/hls-package/")) {
        const match = video.offlineUrl.match(/\/hls-package\/([^/]+)\//);
        const packageId = match ? match[1] : "";
        if (packageId && !offlinePackageFiles.has(packageId)) {
          setPlayerStatus("Offline package files were cleared by page reload. Click Browse to select your video folder again.");
          const emptyTitle = els.emptyPlayer.querySelector("strong");
          const emptyCopy = els.emptyPlayer.querySelector("span");
          if (emptyTitle) emptyTitle.textContent = "Folder re-connect required";
          if (emptyCopy) emptyCopy.textContent = "Click Browse under Intake to re-open this folder for playback.";
          els.playerShell.dataset.mode = "empty";
          hidePlayerLoading();
          return;
        }
      }
      loadHlsVideo(video.offlineUrl, true);
    } else {
      els.videoPlayer.onloadedmetadata = () => setPlayerStatus("Offline copy ready.");
      els.videoPlayer.onerror = () => setPlayerStatus("The browser could not load this saved video copy.");
      els.videoPlayer.src = video.offlineUrl;
      setPlayerStatus("Loading the saved disk copy...");
    }
    return;
  }

  if (video.streamUrl) {
    els.playerShell.dataset.mode = "video";
    if (/\.m3u8([?#].*)?$/i.test(video.streamUrl)) {
      loadHlsVideo(video.streamUrl, false);
    } else {
      els.videoPlayer.onloadedmetadata = () => setPlayerStatus("Video ready.");
      els.videoPlayer.onerror = () => setPlayerStatus("This media server blocked browser playback.");
      els.videoPlayer.src = video.streamUrl;
      setPlayerStatus("Loading direct video...");
    }
    return;
  }

  if (/vimeo\.com/i.test(video.url)) {
    const videoId = video.id;
    const embedUrl = toEmbedUrl(video.url);
    setPlayerStatus("Connecting to video stream...");
    resolveVideoStream(video).then((streamUrl) => {
      if (state.selectedId !== videoId) return;
      if (streamUrl) {
        els.playerShell.dataset.mode = "video";
        loadHlsVideo(streamUrl, false);
      } else if (embedUrl) {
        els.embedPlayer.onload = () => markSelectedPlaybackReady(videoId, "The provider player loaded successfully.");
        els.embedPlayer.src = embedUrl;
        els.playerShell.dataset.mode = "embed";
        setPlayerStatus("Loading the provider's embedded player.");
      }
    });
    return;
  }

  const embedUrl = toEmbedUrl(video.url);
  if (embedUrl) {
    els.embedPlayer.onload = () => markSelectedPlaybackReady(video.id, "The provider player loaded successfully.");
    els.embedPlayer.src = embedUrl;
    els.playerShell.dataset.mode = "embed";
    setPlayerStatus("Loading the provider's secure embedded player. Use Open original if access requires sign-in.");
    return;
  }

  els.playerShell.dataset.mode = "video";
  if (video.format === "hls" || /\.m3u8([?#].*)?$/i.test(video.url)) {
    loadHlsVideo(video.url, false);
    return;
  }

  els.videoPlayer.onloadedmetadata = () => setPlayerStatus("Video ready.");
  els.videoPlayer.onerror = () =>
    setPlayerStatus("This media server blocked browser playback. Try Open original or verify that the link is still public.");
  els.videoPlayer.src = video.url;
  setPlayerStatus("Loading direct video...");
}

function markSelectedPlaybackReady(videoId, message) {
  const video = state.videos.find((item) => item.id === videoId);
  if (!video || state.selectedId !== videoId) return;
  video.playbackStatus = "ready";
  video.playbackMessage = message;
  video.checkedAt = new Date().toISOString();
  saveState();
  renderLibrary();
  setPlayerStatus(message);
}

async function retryPlayback() {
  const video = selectedVideo();
  if (!video) return;
  if (video.offlineExportedTo && offlineExportDirectoryHandle) {
    const directory = await openSavedVideoFolder(video);
    if (directory && (await connectSavedArchive(video, directory))) {
      saveState();
      renderPlayer();
      return;
    }
  }
  delete video.streamUrl;
  delete video.streamType;
  delete video.streamProvider;
  saveState();
  renderPlayer();
}

function loadHlsVideo(url, isOffline = false) {
  const packageMatch = String(url || "").match(/\/hls-package\/([^/]+)\//);
  if (packageMatch && !offlinePackageFiles.has(packageMatch[1])) {
    els.playerShell.dataset.mode = "empty";
    const emptyTitle = els.emptyPlayer.querySelector("strong");
    const emptyCopy = els.emptyPlayer.querySelector("span");
    if (emptyTitle) emptyTitle.textContent = "Folder re-connect required";
    if (emptyCopy) emptyCopy.textContent = "Scan the saved folder again to put these videos back in the library.";
    setPlayerStatus("This offline video is not loaded. Scan its folder again.");
    hidePlayerLoading();
    return;
  }
  if (window.Hls?.isSupported()) {
    let recoveredMediaError = false;
    destroyHlsPlayer();
    const hlsConfig = {
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
    };
    if (url.includes("/hls-package/")) {
      hlsConfig.loader = PackageHlsLoader;
    }
    hlsPlayer = new window.Hls(hlsConfig);
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(els.videoPlayer);
    hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
      const msg = isOffline
        ? "Offline copy ready to play from disk."
        : url.includes("/hls-package/")
        ? "Offline HLS package ready with audio/video segments."
        : url.includes("/local-media/")
        ? "Local HLS video ready to play with audio/video segments."
        : "Video stream ready to play.";
      setPlayerStatus(msg);
      if (state.selectedId) markSelectedPlaybackReady(state.selectedId, msg);
    });
    hlsPlayer.on(window.Hls.Events.ERROR, (_, data) => {
      hidePlayerLoading();
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
        recoveredMediaError = true;
        setPlayerStatus("Recovering the video stream playback...");
        hlsPlayer.recoverMediaError();
        return;
      }
      const reason = data.details || data.type || "stream error";
      setPlayerStatus(`The stream could not be played (${reason}). Retry it or check connection.`);
    });
    setPlayerStatus(
      isOffline
        ? "Loading the saved HLS copy from disk..."
        : url.includes("/local-media/")
        ? "Loading local HLS stream with separate audio/video segments..."
        : "Loading video stream..."
    );
    return;
  }

  const nativeHls = els.videoPlayer.canPlayType("application/vnd.apple.mpegurl");
  if (nativeHls) {
    els.videoPlayer.onloadedmetadata = () =>
      setPlayerStatus(isOffline ? "Offline HLS copy ready." : "HLS stream ready with native browser playback.");
    els.videoPlayer.onerror = () =>
      setPlayerStatus(
        isOffline
          ? "The browser could not read this saved HLS copy. Retry it or create a new offline copy."
          : "The HLS host blocked playback or the stream has expired."
      );
    els.videoPlayer.src = url;
    setPlayerStatus(isOffline ? "Loading the saved HLS copy from disk..." : "Loading HLS with native playback...");
    return;
  }

  setPlayerStatus("This browser cannot play HLS streams. Open the original source in a compatible browser.");
}

function destroyHlsPlayer() {
  if (!hlsPlayer) return;
  hlsPlayer.destroy();
  hlsPlayer = null;
  hidePlayerLoading();
}

function showPlayerLoading(text = "Connecting to stream...") {
  if (!els.playerLoadingOverlay) return;
  if (els.playerLoadingText) els.playerLoadingText.textContent = text;
  els.playerLoadingOverlay.hidden = false;
}

function hidePlayerLoading() {
  if (!els.playerLoadingOverlay) return;
  els.playerLoadingOverlay.hidden = true;
}

function setPlayerStatus(message) {
  if (els.playerStatus) els.playerStatus.textContent = message;
  const isConnectingOrLoading = /(?:Loading|Connecting|Recovering|Preparing)/i.test(message);
  const isDarkOrReadyOrBlocked = /(?:Screen is dark|ready|blocked|could not|cannot play|expired|error)/i.test(message);
  if (isConnectingOrLoading && !isDarkOrReadyOrBlocked) {
    showPlayerLoading(message);
  } else {
    hidePlayerLoading();
  }
}

function openVideoSource() {
  const video = selectedVideo();
  if (!video?.url) return;
  window.open(video.url, "_blank", "noopener,noreferrer");
}

async function reconcileOfflineLibrary() {
  try {
    const response = await fetch("/api/offline/library", { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Offline library returned ${response.status}.`);
    offlineStoragePath = data.storagePath || "";
    const copies = new Map((data.videos || []).map((copy) => [copy.id, copy]));
    const copiesBySource = new Map((data.videos || []).map((copy) => [copy.sourceUrl, copy]));
    state.videos.forEach((video) => {
      const copy = copies.get(video.id) || copiesBySource.get(video.url);
      if (copy) {
        video.offlineCopyId = copy.id;
        video.offlineUrl = copy.offlineUrl;
        video.offlineSize = copy.size;
        video.offlineSavedAt = copy.savedAt;
        video.offlineFormat = copy.format;
        video.offlineProvider = copy.provider;
        video.offlineStale = copy.sourceUrl !== video.url;
        video.offlineDownloadStatus = "completed";
      } else if (String(video.offlineUrl || "").startsWith("/offline-media/")) {
        delete video.offlineUrl;
        delete video.offlineCopyId;
        delete video.offlineSize;
        delete video.offlineSavedAt;
        delete video.offlineFormat;
        delete video.offlineProvider;
        delete video.offlineStale;
      }
    });
    saveState();
    renderLibrary();
    renderLibraryOfflineManager();
    renderPlayer();
  } catch (error) {
    setStatus(`Offline storage is unavailable: ${error.message}`);
  }
}

function hasDiskCopy(video) {
  return Boolean((video?.offlineUrl && !video.offlineStale) || video?.offlineExportedTo);
}

async function saveSelectedOfflineVideos() {
  const videos = state.videos.filter(
    (video) => selectedVideoIds.has(video.id) && canSaveOfflineUrl(video.url) && !hasDiskCopy(video)
  );
  if (!videos.length || !els.libraryOfflinePermission.checked || bulkOfflineRunning) return;
  if (!(await ensureDownloadFolder())) {
    setStatus("Create a new folder, such as Movies/Material Picker, and choose that. Chrome blocks folders that contain system files.");
    return;
  }
  bulkOfflineRunning = true;
  bulkOfflineTotal = videos.length;
  bulkOfflineIndex = 0;
  bulkOfflineCurrentId = "";
  bulkOfflineStartedAt = performance.now();
  bulkOfflineCompletedBytes = 0;
  bulkOfflineEstimatedBytes = 0;
  bulkOfflineEstimateByFiles = false;
  bulkOfflineReport = null;
  const failures = [];
  const jobs = [];
  for (let index = 0; index < videos.length; index += 1) {
    bulkOfflineMessage = `Estimating download ${index + 1} of ${videos.length}...`;
    renderLibraryOfflineManager();
    try {
      jobs.push({ video: videos[index], plan: await loadDownloadPlan(videos[index]) });
    } catch (error) {
      jobs.push({ video: videos[index], planError: error });
    }
  }
  const byteEstimates = jobs.map((job) => Number(job.plan?.estimatedBytes || 0));
  bulkOfflineEstimateByFiles = byteEstimates.some((value) => value <= 0);
  bulkOfflineEstimatedBytes = bulkOfflineEstimateByFiles
    ? jobs.reduce((total, job) => total + (job.plan?.files?.length || 1), 0)
    : byteEstimates.reduce((total, value) => total + value, 0);
  const sizeNote = bulkOfflineEstimateByFiles ? "" : ` About ${formatBytes(bulkOfflineEstimatedBytes)} in total.`;
  setStatus(`Starting the download.${sizeNote} The remaining time appears once the first data arrives.`);
  renderLibraryOfflineManager();

  for (let index = 0; index < jobs.length; index += 1) {
    const { video, plan } = jobs[index];
    bulkOfflineIndex = index;
    bulkOfflineCurrentId = video.id;
    bulkOfflineMessage = `Saving ${index + 1} of ${videos.length}: ${video.title || "Untitled video"}`;
    renderLibraryOfflineManager();
    try {
      if (jobs[index].planError) throw jobs[index].planError;
      await saveOrExportOfflineVideo(video, plan);
      bulkOfflineCompletedBytes += bulkOfflineEstimateByFiles
        ? plan?.files?.length || 1
        : Number(video.offlineBytesDownloaded || plan?.estimatedBytes || 0);
    } catch (error) {
      failures.push({ video, error });
      markOfflineFailure(video, error);
    }
  }

  bulkOfflineRunning = false;
  bulkOfflineMessage = "";
  bulkOfflineCurrentId = "";
  bulkOfflineIndex = 0;
  bulkOfflineTotal = 0;
  bulkOfflineStartedAt = 0;
  bulkOfflineEstimatedBytes = 0;
  bulkOfflineCompletedBytes = 0;
  els.libraryOfflinePermission.checked = false;
  renderLibrary();
  if (failures.length) {
    const saved = videos.length - failures.length;
    bulkOfflineReport = {
      saved,
      total: videos.length,
      failures: failures.map((f) => ({
        title: f.video.title || "Untitled",
        message: f.error.message || "The video could not be saved.",
      })),
    };
    setStatus(`Saved ${saved} of ${videos.length} marked videos. ${failures.length} could not be saved. See the offline copies report.`);
  } else {
    bulkOfflineReport = null;
    setStatus(`Saved all ${videos.length} marked videos to disk for offline playback.`);
  }
  renderLibraryOfflineManager();
}

function openFolderDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("material-picker-folder", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberDownloadFolder(handle) {
  const db = await openFolderDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "download");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function storedDownloadFolder() {
  const db = await openFolderDatabase();
  const handle = await new Promise((resolve, reject) => {
    const request = db.transaction("handles", "readonly").objectStore("handles").get("download");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function restoreDownloadFolder() {
  const stored = await storedDownloadFolder().catch(() => null);
  if (!stored?.queryPermission) return;
  if ((await stored.queryPermission({ mode: "readwrite" })) !== "granted") return;
  offlineExportDirectoryHandle = stored;
  if (!state.lastOfflineFolderName) state.lastOfflineFolderName = stored.name || "";
  await reconnectSavedArchives();
  renderOfflineDestination();
  renderLibraryOfflineManager();
  renderRecentSources();
}

function savedPackageId(video) {
  const safeId = String(video?.id || crypto.randomUUID()).replace(/[^a-z0-9_-]/gi, "-");
  return `saved-${safeId}`;
}

function rememberPackageEntry(fileMap, relativePath, entry) {
  const normalized = relativePath.replace(/^\/+/, "");
  fileMap.set(normalized, entry);
  fileMap.set(normalized.toLowerCase(), entry);
  const filename = normalized.split("/").pop();
  if (filename && !fileMap.has(filename)) fileMap.set(filename, entry);
  if (filename && !fileMap.has(filename.toLowerCase())) fileMap.set(filename.toLowerCase(), entry);
}

async function collectSavedArchiveFiles(directory, prefix = "", fileMap = new Map()) {
  for await (const entry of directory.values()) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await collectSavedArchiveFiles(entry, relativePath, fileMap);
    } else if (entry.kind === "file") {
      rememberPackageEntry(fileMap, relativePath, entry);
    }
  }
  return fileMap;
}

async function connectSavedArchive(video, directory) {
  if (!video || !directory?.values) return false;
  const fileMap = await collectSavedArchiveFiles(directory);
  const manifestName = ["master.m3u8", "playlist.m3u8", "index.m3u8"].find((name) => fileMap.has(name));

  if (manifestName) {
    const packageId = savedPackageId(video);
    offlinePackageFiles.set(packageId, fileMap);
    video.packageId = packageId;
    video.offlineUrl = `/hls-package/${packageId}/${manifestName}`;
    video.offlineFormat = "hls";
  } else {
    const directEntry = [...fileMap.entries()].find(([name]) =>
      /^video\.(?:mp4|webm|ogv|ogg|mov|m4v|mkv|avi|flv|wmv|ts|3gp)$/i.test(name)
    );
    if (!directEntry) return false;
    const file = await directEntry[1].getFile();
    if (String(video.offlineUrl || "").startsWith("blob:")) URL.revokeObjectURL(video.offlineUrl);
    video.offlineUrl = URL.createObjectURL(file);
    video.offlineFormat = directEntry[0].split(".").pop().toLowerCase();
  }

  video.offlineStale = false;
  video.offlineDownloadStatus = "completed";
  video.playbackStatus = "ready";
  video.playbackMessage = "Offline copy ready to play from disk";
  return true;
}

async function reconnectSavedArchives() {
  if (!offlineExportDirectoryHandle) return 0;
  let connected = 0;
  for (const video of state.videos) {
    if (!video.offlineExportedTo && !video.offlineArchiveFolder) continue;
    const directory = await openSavedVideoFolder(video);
    if (directory && (await connectSavedArchive(video, directory))) connected += 1;
  }
  if (connected) {
    saveState();
    renderLibrary();
    renderPlayer();
  }
  return connected;
}

async function ensureDownloadFolder() {
  if (offlineExportDirectoryHandle) return true;
  const stored = await storedDownloadFolder().catch(() => null);
  if (stored?.requestPermission && (await stored.requestPermission({ mode: "readwrite" })) === "granted") {
    offlineExportDirectoryHandle = stored;
    state.lastOfflineFolderName = stored.name || state.lastOfflineFolderName || "";
    saveState();
    renderRecentSources();
    renderOfflineDestination();
    return true;
  }
  return chooseOfflineFolder();
}

async function chooseOfflineFolder() {
  if (!("showDirectoryPicker" in window)) {
    setStatus("This browser cannot pick a folder. Downloads stay in Material Picker storage on the computer running the app.");
    renderOfflineDestination();
    return false;
  }
  try {
    offlineExportDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite", startIn: "downloads" });
    state.lastOfflineFolderName = offlineExportDirectoryHandle.name;
    saveState();
    renderRecentSources();
    await rememberDownloadFolder(offlineExportDirectoryHandle);
    setStatus(`Downloads will be saved in “${offlineExportDirectoryHandle.name}”.`);
    renderOfflineDestination();
    renderLibraryOfflineManager();
    return true;
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Create a new folder, such as Movies/Material Picker, and choose that. Chrome blocks folders that contain system files.");
    } else {
      setStatus(`The download folder could not be opened: ${error.message}`);
    }
    return false;
  }
}

function renderOfflineDestination() {
  const supported = "showDirectoryPicker" in window;
  const operationRunning = state.videos.some((video) =>
    ["downloading", "exporting"].includes(video.offlineDownloadStatus)
  );
  const label = offlineExportDirectoryHandle
    ? `Chosen folder: ${offlineExportDirectoryHandle.name}`
    : supported
      ? "Choose a folder on this computer"
      : "Material Picker storage (this browser cannot choose a folder)";
  els.libraryDestinationStatus.textContent = label;
  const buttonLabel = offlineExportDirectoryHandle ? "Change folder" : "Choose folder";
  els.chooseLibraryFolderButton.textContent = buttonLabel;
  els.chooseLibraryFolderButton.disabled = !supported || bulkOfflineRunning || operationRunning;
}

function offlineMetadataRecord(video, extra = {}) {
  return {
    id: video.id,
    title: video.title || "",
    speaker: video.speaker || "",
    language: video.language || "",
    tags: video.tags || "",
    notes: video.notes || "",
    transcript: video.transcript || "",
    translation: video.translation || "",
    transcriptLanguage: video.transcriptLanguage || "",
    transcriptSource: video.transcriptSource || "",
    sourceUrl: video.sourceUrl || (String(video.url || "").startsWith("/") ? "" : video.url || ""),
    durationSeconds: Number(video.durationSeconds) || 0,
    format: extra.format || video.offlineFormat || "",
    provider: extra.provider || video.offlineProvider || "",
    size: Number(extra.size ?? video.offlineSize ?? video.estimatedBytes) || 0,
    savedAt: extra.savedAt || video.offlineSavedAt || new Date().toISOString(),
  };
}

function offlineMetadataText(video, extra = {}) {
  return JSON.stringify(offlineMetadataRecord(video, extra), null, 2);
}

const folderMetadataTimers = new Map();

function scheduleFolderMetadataSave(video, options = {}) {
  if (!video?.id || ["downloading", "exporting"].includes(video.offlineDownloadStatus)) return;
  const pending = folderMetadataTimers.get(video.id);
  if (pending) clearTimeout(pending);
  folderMetadataTimers.set(
    video.id,
    setTimeout(() => {
      folderMetadataTimers.delete(video.id);
      void persistFolderMetadata(video, options);
    }, 700)
  );
}

function localMediaDirectory(video) {
  const url = String(video?.offlineUrl || video?.url || "");
  const match = url.match(/^\/local-media\/([^/]+)\//);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

async function postFolderMetadata(directory, metadata) {
  try {
    const response = await fetch("/api/folder-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory, metadata }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function flushFolderMetadata(video) {
  if (!video?.id) return Promise.resolve(false);
  const pending = folderMetadataTimers.get(video.id);
  if (pending) clearTimeout(pending);
  folderMetadataTimers.delete(video.id);
  return persistFolderMetadata(video);
}

async function readFolderMetadata(video) {
  const directory = localMediaDirectory(video);
  if (directory) {
    try {
      const response = await fetch(`/local-media/${encodeURIComponent(directory)}/metadata.json`, { cache: "no-store" });
      if (response.ok) return await response.json();
    } catch {
      // The folder may only be reachable through the browser folder handle.
    }
  }
  const handle = await openSavedVideoFolder(video);
  if (!handle?.getFileHandle) return null;
  try {
    const fileHandle = await handle.getFileHandle("metadata.json");
    return JSON.parse(await (await fileHandle.getFile()).text());
  } catch {
    return null;
  }
}

async function loadFolderScript(video) {
  if (!video) return;
  const meta = await readFolderMetadata(video);
  if (!meta || selectedVideo()?.id !== video.id) return;
  let changed = false;
  if (meta.transcript && !video.transcript) {
    video.transcript = meta.transcript;
    changed = true;
  }
  if (meta.translation && !video.translation) {
    video.translation = meta.translation;
    changed = true;
  }
  if (meta.transcriptLanguage && !video.transcriptLanguage) video.transcriptLanguage = meta.transcriptLanguage;
  if (meta.transcriptSource && !video.transcriptSource) video.transcriptSource = meta.transcriptSource;
  if (!changed) return;
  saveState();
  renderTranscript();
  setTranscriptStatus(`Loaded the saved script from “${video.title || "this video"}”.`);
}

async function openSavedVideoFolder(video) {
  const parent = offlineExportDirectoryHandle;
  if (!parent?.getDirectoryHandle) return null;
  const names = [
    video.offlineArchiveFolder,
    archiveFolderName(video.title, video.id),
    video.offlineCopyId ? archiveFolderName(video.title, video.offlineCopyId) : "",
  ].filter(Boolean);
  for (const name of names) {
    try {
      const handle = await parent.getDirectoryHandle(name);
      video.offlineArchiveFolder = name;
      return handle;
    } catch {
      // Try the next name this video may have been saved under.
    }
  }
  return null;
}

async function persistFolderMetadata(video, options = {}) {
  if (!video || ["downloading", "exporting"].includes(video.offlineDownloadStatus)) return false;
  const metadata = offlineMetadataRecord(video);
  const directory = localMediaDirectory(video);
  if (directory && (await postFolderMetadata(directory, metadata))) {
    if (options.announce) setStatus("Saved with the video.");
    return true;
  }
  const handle = await openSavedVideoFolder(video);
  if (!handle) return false;
  await writeOfflineMetadata(handle, video);
  if (options.announce) setStatus("Saved with the video.");
  return true;
}

async function writeOfflineMetadata(destination, video, extra) {
  await writePlannedFile(destination, { path: "metadata.json", text: offlineMetadataText(video, extra) }, () => {});
}

async function writeDownloadPlan(video, plan) {
  const folderName = video.offlineArchiveFolder || archiveFolderName(video.title, video.id);
  video.offlineArchiveFolder = folderName;
  const destination = await offlineExportDirectoryHandle.getDirectoryHandle(folderName, {
    create: true,
  });
  await writeOfflineMetadata(destination, video, {
    format: plan.format,
    provider: plan.provider,
    size: Number(plan.estimatedBytes) || 0,
  });
  const resumed = new Set(video.offlineResumePaths || []);
  video.offlineDownloadStatus = "exporting";
  video.offlineFilesDone = 0;
  video.offlineFilesTotal = plan.files.length;
  video.offlineBytesDownloaded = 0;
  video.offlineTotalBytes = Number(plan.estimatedBytes || 0);
  video.offlineSpeedBytesPerSecond = 0;
  video.offlineEtaSeconds = null;
  video.offlineFormat = plan.format;
  video.offlineProvider = plan.provider;
  delete video.offlineError;
  const startedAt = performance.now();
  let lastRender = 0;
  let sessionBytes = 0;
  const noteProgress = (bytes, resumedPiece = false) => {
    video.offlineBytesDownloaded += bytes;
    if (!resumedPiece) sessionBytes += bytes;
    video.offlineStalled = false;
    const elapsedSeconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
    if (sessionBytes > 0) video.offlineSpeedBytesPerSecond = sessionBytes / elapsedSeconds;
    const remainingBytes = Number(video.offlineTotalBytes || 0) - video.offlineBytesDownloaded;
    video.offlineEtaSeconds =
      sessionBytes > 0 && remainingBytes > 0 ? remainingBytes / video.offlineSpeedBytesPerSecond : video.offlineEtaSeconds;
    if (performance.now() - lastRender > 250) {
      renderLibrary();
      renderLibraryOfflineManager();
      lastRender = performance.now();
    }
  };
  renderLibrary();
  renderLibraryOfflineManager();
  for (const file of plan.files) {
    if (resumed.has(file.path) && typeof file.text !== "string") {
      const existing = await plannedFileSize(destination, file.path);
      if (existing > 0) {
        noteProgress(existing, true);
        video.offlineFilesDone += 1;
        continue;
      }
    }
    await writePlannedFile(destination, file, noteProgress, () => {
      video.offlineStalled = true;
      video.offlineSpeedBytesPerSecond = 0;
      video.offlineEtaSeconds = null;
      renderLibrary();
      renderLibraryOfflineManager();
    });
    video.offlineFilesDone += 1;
    video.offlineResumePaths = [...new Set([...(video.offlineResumePaths || []), file.path])];
    saveState();
    renderLibrary();
    renderLibraryOfflineManager();
  }

  await writeOfflineMetadata(destination, video, {
    format: plan.format,
    provider: plan.provider,
    size: video.offlineBytesDownloaded,
    savedAt: new Date().toISOString(),
  });

  video.offlineDownloadStatus = "completed";
  video.offlineExportedTo = offlineExportDirectoryHandle.name;
  video.offlineExportedAt = new Date().toISOString();
  video.offlineSize = video.offlineBytesDownloaded;
  await connectSavedArchive(video, destination);
  delete video.offlineResumePaths;
  delete video.offlineStalled;
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
}

async function plannedFileSize(root, relativePath) {
  try {
    const parts = relativePath.split("/").filter(Boolean);
    const filename = parts.pop();
    let folder = root;
    for (const part of parts) folder = await folder.getDirectoryHandle(part);
    const handle = await folder.getFileHandle(filename);
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}

function isTransientDownloadError(error) {
  const message = String(error?.message || error);
  return (
    error?.name === "TypeError" ||
    error?.name === "TimeoutError" ||
    error?.name === "NetworkError" ||
    /failed to fetch|network|timed out|502|503|504|429/i.test(message)
  );
}

function waitForDownloadRetry(ms) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("online", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (navigator.onLine === false) window.addEventListener("online", finish, { once: true });
  });
}

function canResumeDownload(video) {
  if (hasDiskCopy(video)) return false;
  if (!["interrupted", "failed"].includes(video?.offlineDownloadStatus)) return false;
  return Boolean(video.offlineResumePaths?.length || Number(video.offlineFilesDone || 0));
}

async function writePlannedFile(root, file, onBytes, onStall) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await writePlannedFileOnce(root, file, onBytes);
    } catch (error) {
      lastError = error;
      if (attempt === 4 || !isTransientDownloadError(error)) break;
      if (onStall) onStall();
      await waitForDownloadRetry(Math.min(30000, 2000 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(
    `The connection dropped while saving ${file.path}. Download it again to continue from the pieces already saved. ${lastError?.message || ""}`.trim()
  );
}

async function writePlannedFileOnce(root, file, onBytes) {
  const parts = file.path.split("/").filter(Boolean);
  const filename = parts.pop();
  let folder = root;
  for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
  const handle = await folder.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    if (typeof file.text === "string") {
      await writable.write(file.text);
      await writable.close();
      onBytes(file.text.length);
      return file.text.length;
    }
    const response = await fetch(`/api/media-proxy?url=${encodeURIComponent(file.url)}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Could not download ${file.path} (${response.status}).`);
    }
    const reader = response.body.getReader();
    let copied = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      copied += value.byteLength;
      onBytes(value.byteLength);
    }
    await writable.close();
    return copied;
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

async function loadDownloadPlan(video) {
  const planResponse = await fetch(`/api/media-plan?url=${encodeURIComponent(video.url)}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (planResponse.status === 404) return null;
  const plan = await planResponse.json().catch(() => ({}));
  if (!planResponse.ok) throw new Error(plan.error || `The download could not be prepared (${planResponse.status}).`);
  rememberMediaMeasure(video, plan);
  return plan;
}

async function saveOrExportOfflineVideo(video, preparedPlan) {
  if (!(await ensureDownloadFolder())) {
    throw new Error("Create a new folder, such as Movies/Material Picker, and choose that. Chrome blocks folders that contain system files.");
  }
  const plan = preparedPlan === undefined ? await loadDownloadPlan(video) : preparedPlan;
  if (!plan) {
    if (!video.offlineUrl || video.offlineStale) await startOfflineDownload(video);
    if (offlineExportDirectoryHandle) await exportOfflineCopy(video);
    return;
  }
  await writeDownloadPlan(video, plan);
}

async function exportOfflineCopy(video) {
  const copyId = video.offlineCopyId || video.id;
  const response = await fetch(`/api/offline/files?id=${encodeURIComponent(copyId)}`, {
    signal: AbortSignal.timeout(15000),
  });
  const archive = await response.json();
  if (!response.ok) throw new Error(archive.error || `Offline file list returned ${response.status}.`);
  const folderName = video.offlineArchiveFolder || archiveFolderName(video.title, copyId);
  video.offlineArchiveFolder = folderName;
  const destination = await offlineExportDirectoryHandle.getDirectoryHandle(folderName, { create: true });
  video.offlineDownloadStatus = "exporting";
  video.offlineBytesDownloaded = 0;
  video.offlineTotalBytes = archive.size || 0;
  video.offlineFilesDone = 0;
  video.offlineFilesTotal = archive.files.length;
  video.offlineSpeedBytesPerSecond = 0;
  video.offlineEtaSeconds = null;
  const startedAt = performance.now();
  let copied = 0;
  let lastRender = 0;
  renderLibrary();
  renderLibraryOfflineManager();

  for (const file of archive.files) {
    const parts = file.path.split("/");
    const filename = parts.pop();
    let folder = destination;
    for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
    const fileResponse = await fetch(offlineMediaUrl(copyId, file.path));
    if (!fileResponse.ok || !fileResponse.body) throw new Error(`Could not copy ${file.path}.`);
    const fileHandle = await folder.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    const reader = fileResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        copied += value.byteLength;
        const elapsedSeconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
        video.offlineBytesDownloaded = copied;
        video.offlineSpeedBytesPerSecond = copied / elapsedSeconds;
        video.offlineEtaSeconds = video.offlineSpeedBytesPerSecond > 0
          ? Math.max(0, (archive.size - copied) / video.offlineSpeedBytesPerSecond)
          : null;
        if (performance.now() - lastRender > 250) {
        renderLibrary();
        renderLibraryOfflineManager();
        lastRender = performance.now();
        }
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    video.offlineFilesDone += 1;
  }
  await writeOfflineMetadata(destination, video, {
    size: copied,
    savedAt: new Date().toISOString(),
  });
  video.offlineDownloadStatus = "completed";
  video.offlineExportedTo = offlineExportDirectoryHandle.name;
  video.offlineExportedAt = new Date().toISOString();
  await connectSavedArchive(video, destination);
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
  setStatus(`Copied “${video.title || "Untitled video"}” to “${offlineExportDirectoryHandle.name}”.`);
}

async function handleVerifyOfflineButtonClick() {
  if (bulkOfflineRunning || verificationRunning) return;

  const hasFolderApi = "showDirectoryPicker" in window;
  if (hasFolderApi && !offlineExportDirectoryHandle) {
    const success = await ensureDownloadFolder();
    if (!success) {
      setStatus("Choose your download location to verify its offline files.");
      return;
    }
  }

  const marked = state.videos.filter((v) => selectedVideoIds.has(v.id));
  const candidateVideos = marked.length > 0 ? marked : state.videos;

  verificationRunning = true;
  renderLibraryOfflineManager();
  els.bulkDownloadProgress.hidden = false;
  els.bulkOfflineProgress.value = 0;
  els.bulkOfflineStatus.textContent = "Scanning offline resources in the library...";
  els.bulkOfflineProgressLabel.textContent = "Starting asset verification runner...";
  setStatus("Scanning offline copies to verify all video and audio assets are in place...");

  let verifiedCount = 0;
  let healthyCount = 0;
  let incompleteCount = 0;
  let totalSegments = 0;
  let totalBytes = 0;
  const issues = [];

  try {
    for (let i = 0; i < candidateVideos.length; i++) {
      const video = candidateVideos[i];
      const folderName = archiveFolderName(video.title, video.id);
      els.bulkOfflineStatus.textContent = `Verifying ${i + 1} of ${candidateVideos.length}: “${video.title || "Untitled"}”`;
      els.bulkOfflineProgress.value = (i / candidateVideos.length) * 100;
      els.bulkOfflineProgressLabel.textContent = `Scanning assets for ${video.title || "video"}...`;

      let folderHandle = null;
      if (offlineExportDirectoryHandle) {
        try {
          folderHandle = await offlineExportDirectoryHandle.getDirectoryHandle(folderName);
        } catch {}
      }

      if (video.packageId && offlinePackageFiles.has(video.packageId)) {
        const fileMap = offlinePackageFiles.get(video.packageId);
        const manifestFile = fileMap.get("master.m3u8") || fileMap.get("playlist.m3u8");
        let healthy = false;
        let missingFiles = [];
        let emptyFiles = [];
        let pkgBytes = 0;
        for (const [k, f] of fileMap.entries()) {
          if (!k.includes("/")) {
            pkgBytes += f.size || 0;
          }
          if (f.size <= 0) emptyFiles.push(k);
        }

        if (manifestFile) {
          try {
            const masterText = await manifestFile.text();
            const subPlaylists = {};
            for (const [k, f] of fileMap.entries()) {
              if (k.endsWith(".m3u8") && f !== manifestFile) {
                subPlaylists[k] = await f.text();
              }
            }
            const reqs = core.parseOfflineArchiveRequirements(masterText, subPlaylists);
            const verifyRes = await core.verifyArchive(reqs, async (p) => {
              const file = fileMap.get(p) || fileMap.get(p.toLowerCase());
              if (!file) return { exists: false, size: 0, sample: null };
              return { exists: true, size: file.size, sample: null };
            });
            healthy = verifyRes.healthy;
            missingFiles = verifyRes.missingFiles;
          } catch {
            healthy = false;
          }
        } else {
          healthy = fileMap.size > 0 && emptyFiles.length === 0;
        }

        const result = {
          healthy,
          playable: healthy,
          totalBytes: pkgBytes,
          validFiles: Array.from(fileMap.keys()),
          missingFiles,
          corruptedFiles: emptyFiles,
          videoSegments: { expected: fileMap.size, found: fileMap.size - missingFiles.length },
          audioSegments: { expected: 0, found: 0 },
          message: healthy
            ? `In-memory HLS package intact (${formatBytes(pkgBytes)}). Ready to play.`
            : `Incomplete package: missing ${missingFiles.length} file(s).`,
        };
        video.offlineVerified = true;
        video.offlineVerification = result;
        verifiedCount++;
        if (healthy) {
          healthyCount++;
          totalBytes += pkgBytes;
        } else {
          incompleteCount++;
          issues.push(`“${video.title}”: ${result.message}`);
        }
        renderLibrary();
        continue;
      }

      if (!folderHandle && video.offlineUrl) {
        try {
          let query = `id=${encodeURIComponent(video.offlineCopyId || video.id || "")}`;
          if (video.offlineUrl.startsWith("/local-media/")) {
            const rem = video.offlineUrl.slice("/local-media/".length);
            const sIdx = rem.indexOf("/");
            const baseDir = decodeURIComponent(sIdx >= 0 ? rem.slice(0, sIdx) : rem);
            query += `&path=${encodeURIComponent(baseDir)}`;
          }
          const res = await fetch(`/api/offline/files?${query}`);
          if (res.ok) {
            const data = await res.json();
            const healthy = data.healthy ?? (data.files?.length > 0 && (data.emptyFiles || []).length === 0);
            const result = {
              healthy,
              playable: data.playable ?? healthy,
              totalBytes: data.size || 0,
              validFiles: (data.files || []).map((f) => f.path),
              missingFiles: data.missingFiles || [],
              corruptedFiles: data.emptyFiles || [],
              videoSegments: { expected: data.expectedCount || data.files?.length || 0, found: data.foundCount || data.files?.length || 0 },
              audioSegments: { expected: 0, found: 0 },
              message: data.message || (healthy
                ? `Verified server copy: all ${data.files?.length || 0} files intact (${formatBytes(data.size || 0)}). Playable.`
                : `Incomplete server copy: ${data.missingFiles?.length || 0} missing segment(s).`),
            };
            video.offlineVerified = true;
            video.offlineVerification = result;
            verifiedCount++;
            if (healthy) {
              healthyCount++;
              totalBytes += data.size || 0;
            } else {
              incompleteCount++;
              issues.push(`“${video.title}”: ${result.message}`);
            }
            renderLibrary();
            continue;
          }
        } catch {}
      }

      if (!folderHandle) {
        if (hasDiskCopy(video) || video.offlineExportedTo) {
          video.offlineVerification = {
            healthy: false,
            playable: false,
            message: `Archive folder “${folderName}” was not found in “${offlineExportDirectoryHandle?.name || "chosen folder"}”.`,
            missingFiles: [folderName],
            corruptedFiles: [],
          };
          incompleteCount++;
          issues.push(`“${video.title}”: folder not found`);
        }
        continue;
      }

      verifiedCount++;

      const fileChecker = async (relativePath, { sampleBytes = 0 } = {}) => {
        try {
          const parts = relativePath.split("/").filter(Boolean);
          const filename = parts.pop();
          let dir = folderHandle;
          for (const part of parts) dir = await dir.getDirectoryHandle(part);
          const fileHandle = await dir.getFileHandle(filename);
          const file = await fileHandle.getFile();
          let sample = null;
          if (sampleBytes > 0 && file.size > 0) {
            const slice = file.slice(0, Math.min(file.size, sampleBytes));
            sample = new Uint8Array(await slice.arrayBuffer());
          }
          return { exists: true, size: file.size, sample };
        } catch {
          return { exists: false, size: 0, sample: null };
        }
      };

      let masterText = "";
      const masterCheck = await fileChecker("master.m3u8");
      if (masterCheck.exists && masterCheck.size > 0) {
        try {
          const fileHandle = await folderHandle.getFileHandle("master.m3u8");
          const file = await fileHandle.getFile();
          masterText = await file.text();
        } catch {}
      } else {
        const altCheck = await fileChecker("playlist.m3u8");
        if (altCheck.exists && altCheck.size > 0) {
          try {
            const fileHandle = await folderHandle.getFileHandle("playlist.m3u8");
            const file = await fileHandle.getFile();
            masterText = await file.text();
          } catch {}
        }
      }

      let result;
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
              const parts = subUri.split("/").filter(Boolean);
              const fn = parts.pop();
              let d = folderHandle;
              for (const p of parts) d = await d.getDirectoryHandle(p);
              const fh = await d.getFileHandle(fn);
              subPlaylists[subUri] = await (await fh.getFile()).text();
            } catch {}
          }
        }

        const requirements = core.parseOfflineArchiveRequirements(masterText, subPlaylists);
        result = await core.verifyArchive(requirements, fileChecker);
      } else {
        let foundVideoFile = "";
        for (const candidate of ["video.mp4", "video.webm", "video.mov", "video.mkv", "video.m4v"]) {
          const check = await fileChecker(candidate);
          if (check.exists && check.size > 0) {
            foundVideoFile = candidate;
            break;
          }
        }
        if (foundVideoFile) {
          const requirements = {
            format: "file",
            playlists: [],
            videoSegments: [foundVideoFile],
            audioSegments: [],
            totalDuration: 0,
          };
          result = await core.verifyArchive(requirements, fileChecker);
        } else {
          result = {
            healthy: false,
            playable: false,
            totalBytes: 0,
            validFiles: [],
            missingFiles: ["master.m3u8 / video.mp4"],
            corruptedFiles: [],
            message: "No playable master playlist or video file found in folder.",
          };
        }
      }

      video.offlineVerified = true;
      video.offlineVerification = result;
      if (result.healthy) {
        healthyCount++;
        totalSegments += (result.videoSegments?.found || 0) + (result.audioSegments?.found || 0);
        totalBytes += result.totalBytes || 0;
        video.offlineDownloadStatus = "completed";
        video.offlineExportedTo = offlineExportDirectoryHandle?.name || video.offlineExportedTo || "download";
        video.offlineSize = result.totalBytes;
        delete video.offlineError;
        delete video.offlineResumePaths;
      } else {
        incompleteCount++;
        video.offlineDownloadStatus = "interrupted";
        video.offlineError = result.message;
        video.offlineResumePaths = result.validFiles;
        issues.push(`“${video.title || "Untitled"}”: ${result.message}`);
        selectedVideoIds.add(video.id);
      }

      renderLibrary();
    }
  } finally {
    verificationRunning = false;
    renderLibrary();
    renderLibraryOfflineManager();
    els.bulkDownloadProgress.hidden = true;
  }

  saveState();

  if (verifiedCount === 0) {
    setStatus(`No offline video folders matching your library were found in “${offlineExportDirectoryHandle?.name || "your download folder"}”.`);
  } else if (incompleteCount === 0) {
    setStatus(`Asset verification passed: all ${healthyCount} offline video(s) are 100% complete and playable (${totalSegments} video & audio segments, ${formatBytes(totalBytes)}).`);
  } else {
    setStatus(`Verification found ${incompleteCount} incomplete video(s): ${issues.join("; ")}. Missing items are selected—click “Download marked” to resume.`);
  }
}

function offlineMediaUrl(copyId, relativePath) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/offline-media/${encodeURIComponent(copyId)}/${encodedPath}`;
}

async function startOfflineDownload(video) {
  video.offlineDownloadStatus = "downloading";
  video.offlineBytesDownloaded = 0;
  video.offlineSpeedBytesPerSecond = 0;
  video.offlineEtaSeconds = null;
  video.offlineStartedAt = new Date().toISOString();
  video.offlineFilesDone = 0;
  video.offlineFilesTotal = 0;
  delete video.offlineError;
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
  const response = await fetch("/api/offline/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId: video.id,
      title: video.title,
      url: video.url,
      rightsConfirmed: true,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const job = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Downloads to disk run in the local app. Start it with npm start, then choose a folder and download the marked videos."
        : job.error || `Offline save returned ${response.status}.`
    );
  }
  await pollOfflineJob(video.id);
}

function markOfflineFailure(video, error) {
  video.offlineDownloadStatus = "failed";
  video.offlineError = error.message;
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
}

async function pollOfflineJob(videoId) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const response = await fetch(`/api/offline/status?id=${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || `Download status returned ${response.status}.`);
    const video = state.videos.find((item) => item.id === videoId);
    if (!video) return;
    video.offlineDownloadStatus = job.status;
    video.offlineBytesDownloaded = job.bytesDownloaded || job.size || 0;
    video.offlineTotalBytes = job.totalBytes || 0;
    video.offlineSpeedBytesPerSecond = job.downloadSpeedBytesPerSecond || 0;
    video.offlineEtaSeconds = Number.isFinite(job.etaSeconds) ? job.etaSeconds : null;
    video.offlineStartedAt = job.startedAt || video.offlineStartedAt;
    video.offlineFilesDone = job.filesDone || 0;
    video.offlineFilesTotal = job.filesTotal || 0;
    if (job.status === "completed") {
      video.offlineUrl = job.offlineUrl;
      video.offlineCopyId = job.id;
      video.offlineSize = job.size;
      video.offlineSavedAt = job.savedAt;
      video.offlineFormat = job.format;
      video.offlineProvider = job.provider;
      video.offlineStale = false;
      saveState();
      renderLibrary();
      renderLibraryOfflineManager();
      renderPlayer();
      setStatus(`Saved “${video.title || "Untitled video"}” to disk for offline playback.`);
      return;
    }
    if (job.status === "failed") throw new Error(job.error || "The download failed.");
    saveState();
    renderLibrary();
    renderLibraryOfflineManager();
  }
}

function canSaveOfflineUrl(url) {
  const clean = String(url || "");
  if (clean.includes("/hls-package/") || clean.startsWith("/local-media/") || clean.startsWith("/offline-media/")) {
    return false;
  }
  return /vimeo\.com|\.(?:m3u8|mp4|webm|ogv|ogg|mov|m4v)(?:[?#].*)?$/i.test(clean);
}

async function checkLibraryPlayback() {
  if (!state.videos.length) {
    setStatus("Add videos before checking playback.");
    return;
  }

  await repairLegacyPageRecords({ automatic: false });
  if (!state.videos.length) {
    setStatus("No playable video links were found. Scan the source page again.");
    return;
  }

  els.checkLibraryButton.disabled = true;
  state.videos.forEach((video) => {
    video.playbackStatus = "checking";
    video.playbackMessage = "Checking playback...";
  });
  saveState();
  renderLibrary();
  setStatus(`Checking ${state.videos.length} saved video ${state.videos.length === 1 ? "link" : "links"}...`);

  await Promise.all(
    state.videos.map(async (video) => {
      const result = video.offlineUrl && !video.offlineStale
        ? { status: "ready", message: "The saved disk copy is available for offline playback." }
        : await verifyVideoPlayback(video.url);
      video.playbackStatus = result.status;
      video.playbackMessage = result.message;
      video.checkedAt = new Date().toISOString();
      saveState();
      renderLibrary();
    })
  );

  const counts = state.videos.reduce((result, video) => {
    result[video.playbackStatus] = (result[video.playbackStatus] || 0) + 1;
    return result;
  }, {});
  els.checkLibraryButton.disabled = false;
  setStatus(
    `Playback check complete: ${counts.ready || 0} ready, ${counts.blocked || 0} blocked, ${counts.unknown || 0} need a manual check.`
  );
}

async function repairLegacyPageRecords({ automatic }) {
  const legacyRecords = state.videos.filter(isLegacyPageRecord);
  if (!legacyRecords.length) return 0;

  if (!automatic) setStatus(`Repairing ${legacyRecords.length} saved page ${legacyRecords.length === 1 ? "link" : "links"}...`);
  let repaired = 0;
  const completedSources = new Set();

  for (const record of legacyRecords) {
    const sourceUrl = record.sourceUrl || record.url;
    const sourceKey = normalizeSourceUrl(sourceUrl);
    if (completedSources.has(sourceKey)) {
      state.videos = state.videos.filter((video) => video.id !== record.id);
      repaired += 1;
      continue;
    }

    try {
      const page = await fetchPageForImport(sourceUrl);
      const items = extractVideos(page.html, page.finalUrl || sourceUrl);
      if (!items.length) throw new Error("No playable video links were found on the source page.");
      const imported = addExtractedVideos(items, sourceUrl);
      state.videos = state.videos.filter((video) => video.id !== record.id);
      completedSources.add(sourceKey);
      repaired += 1;
      recordScrape(sourceUrl, {
        status: "completed",
        foundCount: items.length,
        addedCount: imported.added,
        method: `${page.method} repair`,
      });
    } catch (error) {
      record.playbackStatus = "unknown";
      record.playbackMessage = `Source page needs another scan: ${error.message}`;
    }
  }

  saveState();
  render();
  if (repaired) {
    setStatus(`Repaired ${repaired} source-page ${repaired === 1 ? "record" : "records"} and restored the real video links.`);
  } else if (!automatic) {
    setStatus("The saved page links could not be repaired automatically. Start the app with npm start and try again.");
  }
  return repaired;
}

function isLegacyPageRecord(video) {
  if (!video?.url || !/^https?:/i.test(video.url)) return false;
  if (core.playbackKind(video.url).kind !== "unsupported") return false;
  return Boolean(video.sourceUrl || /[?&](playlist|video)=/i.test(video.url));
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    ["utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"].forEach((key) =>
      url.searchParams.delete(key)
    );
    return url.href;
  } catch {
    return value;
  }
}

async function verifyVideoPlayback(url) {
  if (!url) {
    return { status: "unknown", message: "No video URL is saved yet. Add a direct video or provider link." };
  }
  const playback = core.playbackKind(url);
  if (playback.kind === "unsupported") {
    return { status: "blocked", message: "This URL is not a supported video or embed." };
  }

  if (playback.kind === "video") return probeDirectVideo(url);

  const endpoint = oEmbedEndpoint(url);
  if (!endpoint) {
    return { status: "unknown", message: "The embed is supported; open it in the player to confirm access." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (response.ok) return { status: "ready", message: "The provider confirmed this video is available to embed." };
    return { status: "blocked", message: `The video provider returned ${response.status}.` };
  } catch {
    return { status: "unknown", message: "The browser could not verify the provider; try the built-in player." };
  } finally {
    clearTimeout(timeout);
  }
}

function oEmbedEndpoint(url) {
  if (/vimeo\.com/i.test(url)) return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  if (/youtube\.com|youtu\.be/i.test(url)) {
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  }
  return "";
}

function probeDirectVideo(url) {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    const finish = (result) => {
      clearTimeout(timeout);
      probe.removeAttribute("src");
      probe.load();
      resolve(result);
    };
    const timeout = setTimeout(
      () => finish({ status: "unknown", message: "The media server did not answer the browser playback check." }),
      10000
    );
    probe.preload = "metadata";
    probe.onloadedmetadata = () => finish({ status: "ready", message: "The browser loaded this video's metadata." });
    probe.onerror = () => finish({ status: "blocked", message: "The browser could not load this video URL." });
    probe.src = url;
  });
}

function renderTranscript() {
  const video = selectedVideo();
  els.transcriptText.disabled = !video;
  els.translatedText.disabled = !video;
  els.startTranscriptButton.disabled = !video;
  els.stopTranscriptButton.disabled = true;
  els.translateButton.disabled = !video;
  els.proofreadButton.disabled = !video;
  els.downloadTranscriptButton.disabled = !video;
  els.transcriptText.value = video?.transcript || "";
  els.translatedText.value = video?.translation || "";
  if (!video) setTranscriptStatus("Select a saved video to load or create its transcript.");
  else if (video.transcript) {
    const source = video.transcriptSource === "provider-captions" ? "provider captions" : "saved transcript";
    setTranscriptStatus(`Loaded ${source} for “${video.title || "Untitled video"}”.`);
  } else {
    setTranscriptStatus(`Ready to transcribe “${video.title || "Untitled video"}”.`);
  }
}

function selectedVideo() {
  return state.videos.find((video) => video.id === state.selectedId) || null;
}

function sourcePreviewDocument({ title = "Source page", paragraphs = [], url = "", message = "" } = {}) {
  const body = message
    ? `<p class="notice">${escapeHtml(message)}</p>`
    : paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <style>
    :root { font-family: ui-serif, Georgia, serif; color: #28241f; background: #f4f0e7; }
    * { box-sizing: border-box; }
    body { max-width: 72ch; margin: 0 auto; padding: 24px; line-height: 1.6; }
    header { margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid #c9c0af; }
    h1 { margin: 0 0 6px; font-size: 1.35rem; line-height: 1.25; }
    small { display: block; overflow-wrap: anywhere; color: #756b5d; font: 0.72rem/1.45 ui-monospace, monospace; }
    p { margin: 0 0 1em; }
    .notice { color: #756b5d; font-style: italic; }
  </style>
</head>
<body>
  <header><h1>${escapeHtml(title)}</h1><small>${escapeHtml(url)}</small></header>
  <main>${body || '<p class="notice">No readable page text was found.</p>'}</main>
</body>
</html>`;
}

function buildSourcePreview(html, url) {
  const documentNode = new DOMParser().parseFromString(String(html || ""), "text/html");
  documentNode.querySelectorAll("script, style, link, iframe, object, embed, form, video, audio, source, img, svg, canvas, noscript").forEach((node) => node.remove());
  const title = documentNode.querySelector("h1")?.textContent?.trim() || documentNode.title?.trim() || "Source page";
  const paragraphs = [...documentNode.querySelectorAll("main p, article p, main li, article li, body p")]
    .map((node) => node.textContent.replace(/\s+/g, " ").trim())
    .filter((text, index, items) => text.length >= 24 && items.indexOf(text) === index)
    .slice(0, 36);
  return sourcePreviewDocument({ title, paragraphs, url });
}

function cacheSourcePreview(url, html, finalUrl = url) {
  if (!url || typeof html !== "string") return;
  sourcePreviewCache.set(url, buildSourcePreview(html, finalUrl));
  if (sourcePreviewUrl === url && els.sourceDisclosure?.open) {
    els.sourceFrame.srcdoc = sourcePreviewCache.get(url);
  }
}

async function loadSourcePreview() {
  const url = sourcePreviewUrl;
  if (!url || !els.sourceFrame) return;
  if (sourcePreviewCache.has(url)) {
    els.sourceFrame.srcdoc = sourcePreviewCache.get(url);
    return;
  }

  const requestId = ++sourcePreviewRequestId;
  els.sourceFrame.srcdoc = sourcePreviewDocument({
    title: "Source page",
    url,
    message: "Preparing a quiet preview...",
  });
  try {
    const response = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.html !== "string") {
      throw new Error(data.error || `Preview returned ${response.status}.`);
    }
    if (requestId !== sourcePreviewRequestId || url !== sourcePreviewUrl) return;
    cacheSourcePreview(url, data.html, data.finalUrl || url);
  } catch {
    if (requestId !== sourcePreviewRequestId || url !== sourcePreviewUrl) return;
    els.sourceFrame.srcdoc = sourcePreviewDocument({
      title: "Preview unavailable",
      url,
      message: "This page could not be reduced to a local preview. Use Open to view the original.",
    });
  }
}

function setSourceFrame(url, updateInput = true) {
  sourcePreviewRequestId += 1;
  sourcePreviewUrl = String(url || "").trim();
  els.sourceFrame?.removeAttribute("src");
  if (updateInput) els.sourceUrl.value = sourcePreviewUrl;
  if (!els.sourceFrame) return;
  els.sourceFrame.srcdoc = sourcePreviewUrl
    ? sourcePreviewDocument({ title: "Source page", url: sourcePreviewUrl, message: "Open the preview to load a quiet page snapshot." })
    : sourcePreviewDocument({ title: "No source page", message: "Add a source URL to preview its readable content." });
  if (sourcePreviewUrl && els.sourceDisclosure?.open) void loadSourcePreview();
}

function openSource() {
  const video = selectedVideo();
  if (!video?.sourceUrl) return;
  window.open(video.sourceUrl, "_blank", "noopener,noreferrer");
}

let audioContext = null;
let mediaElementSource = null;
let audioProcessor = null;
let audioTrackTranscribing = false;
let accumulatedSamples = [];
let accumulatedLength = 0;
let isTranscribingChunk = false;
let lastChunkTime = 0;

const TRANSCRIBE_SAMPLE_RATE = 16000;
const TRANSCRIBE_CHUNK_SAMPLES = TRANSCRIBE_SAMPLE_RATE * 12;
let silentStreak = 0;
let audioTap = null;
let transcriptionEndedHandler = null;
let hlsTranscriptionToken = 0;
let hlsAbort = null;

async function openAudioTap() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") await audioContext.resume();

  const capture = els.videoPlayer.captureStream?.() || els.videoPlayer.webkitCaptureStream?.();
  let tracks = capture?.getAudioTracks?.().filter((track) => track.readyState === "live") || [];
  if (!tracks.length && capture && !els.videoPlayer.paused) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    tracks = capture.getAudioTracks().filter((track) => track.readyState === "live");
  }
  if (tracks.length) {
    return {
      audioContext,
      source: audioContext.createMediaStreamSource(new MediaStream(tracks)),
      kind: "stream",
    };
  }

  if (!mediaElementSource) {
    mediaElementSource = audioContext.createMediaElementSource(els.videoPlayer);
    mediaElementSource.connect(audioContext.destination);
  }
  return { audioContext, source: mediaElementSource, kind: "element" };
}

async function createCaptureProcessor(context, onSamples) {
  try {
    if (!context.__pickerWorklet) {
      const code = `
        class PickerCaptureProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.pending = new Float32Array(4096);
            this.offset = 0;
          }
          process(inputs) {
            const channel = inputs[0] && inputs[0][0];
            if (!channel) return true;
            let read = 0;
            while (read < channel.length) {
              const take = Math.min(this.pending.length - this.offset, channel.length - read);
              this.pending.set(channel.subarray(read, read + take), this.offset);
              this.offset += take;
              read += take;
              if (this.offset === this.pending.length) {
                this.port.postMessage(this.pending);
                this.pending = new Float32Array(this.pending.length);
                this.offset = 0;
              }
            }
            return true;
          }
        }
        registerProcessor("picker-capture", PickerCaptureProcessor);
      `;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      context.__pickerWorklet = true;
    }
    const node = new AudioWorkletNode(context, "picker-capture");
    node.port.onmessage = (event) => onSamples(event.data, context.sampleRate);
    return node;
  } catch {
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => onSamples(event.inputBuffer.getChannelData(0), context.sampleRate);
    return processor;
  }
}

function disconnectAudioTap() {
  if (audioProcessor) {
    try {
      audioProcessor.disconnect();
    } catch {}
    if (audioProcessor.port) audioProcessor.port.onmessage = null;
    audioProcessor.onaudioprocess = null;
    audioProcessor = null;
  }
  if (audioTap?.kind === "stream") {
    try {
      audioTap.source.disconnect();
    } catch {}
  }
  audioTap = null;
}

function downsampleTo16k(inputBuffer, inputSampleRate) {
  if (inputSampleRate === 16000) return inputBuffer;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputBuffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputBuffer.length; i++) {
      accum += inputBuffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCMBase64(floatSamples) {
  const buffer = new ArrayBuffer(floatSamples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < floatSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function startTranscription() {
  const video = selectedVideo();
  if (!video) return;
  if (video.transcript && !confirm("Replace the existing transcript for this video?")) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
  if (audioContext?.state === "suspended") audioContext.resume();

  els.transcriptText.value = "";
  updateTranscriptFields();

  await ensurePlayerPlaying();

  if (/vimeo\.com/i.test(video.url)) {
    setTranscriptButtons(false, true);
    setTranscriptStatus("Loading the video's public caption track...", "working");
    try {
      const response = await fetch(
        `/api/transcript?url=${encodeURIComponent(video.url)}&language=${encodeURIComponent(els.sourceLang.value)}`,
        { signal: AbortSignal.timeout(30000) }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Transcript request returned ${response.status}.`);
      els.transcriptText.value = data.text;
      video.transcript = data.text;
      video.transcriptSource = data.source;
      video.transcriptLanguage = data.language;
      saveState();
      renderLibrary();
      setTranscriptButtons(false);
      const onDisk = await flushFolderMetadata(video);
      setTranscriptStatus(
        onDisk
          ? `Saved ${data.cueCount} caption cues in this video's folder.`
          : `Loaded ${data.cueCount} timed caption cues (${data.label || data.language}).`
      );
      setStatus(onDisk ? "The caption track was saved in this video's folder." : "The provider caption track was saved as this video's transcript.");
      await ensurePlayerPlaying();
      return;
    } catch (error) {
      setTranscriptStatus(`${error.message} Transcribing using video audio tracks instead.`, "working");
    }
  }

  let streamUrl = currentPlaybackUrl(video);
  if (!/\.m3u8(?:[?#].*)?$/i.test(streamUrl) && /vimeo\.com/i.test(video.url)) {
    setTranscriptStatus("Resolving audio stream...", "working");
    const resolved = await resolveVideoStream(video);
    if (resolved) {
      streamUrl = resolved;
      if (els.playerShell.dataset.mode !== "video" || !els.videoPlayer.src) {
        els.playerShell.dataset.mode = "video";
        loadHlsVideo(streamUrl, false);
      }
    } else if (els.playerShell.dataset.mode === "embed") {
      setTranscriptButtons(false);
      setTranscriptStatus("Could not resolve an audio stream for this video. A direct stream or caption track is required.", "error");
      return;
    }
  }

  await ensurePlayerPlaying();
  await startAudioTrackTranscription(video);
}

function collectAudioSamples(inputData, sampleRate) {
  if (!audioTrackTranscribing || els.videoPlayer.paused) return;
  const downsampled = downsampleTo16k(inputData, sampleRate);
  accumulatedSamples.push(downsampled);
  accumulatedLength += downsampled.length;
  const threshold = els.transcriptText.value.trim() ? TRANSCRIBE_CHUNK_SAMPLES : TRANSCRIBE_SAMPLE_RATE * 5;
  if (accumulatedLength >= threshold && !isTranscribingChunk) {
    processPendingAudioChunk();
  }
}

function haltAudioCapture() {
  audioTrackTranscribing = false;
  hlsTranscriptionToken += 1;
  if (hlsAbort) {
    hlsAbort.abort();
    hlsAbort = null;
  }
  if (transcriptionEndedHandler) {
    els.videoPlayer.removeEventListener("ended", transcriptionEndedHandler);
    transcriptionEndedHandler = null;
  }
  disconnectAudioTap();
  accumulatedSamples = [];
  accumulatedLength = 0;
}

function currentPlaybackUrl(video = selectedVideo()) {
  if (video?.offlineUrl && !video.offlineStale) return video.offlineUrl;
  if (video?.streamUrl) return video.streamUrl;
  return video?.url || "";
}

async function startAudioTrackTranscription(video = selectedVideo()) {
  haltAudioCapture();
  let playbackUrl = currentPlaybackUrl(video);
  if (!/\.m3u8(?:[?#].*)?$/i.test(playbackUrl) && video?.url && /vimeo\.com/i.test(video.url)) {
    setTranscriptStatus("Resolving audio stream...", "working");
    const stream = await resolveVideoStream(video);
    if (stream) {
      playbackUrl = stream;
      if (els.playerShell.dataset.mode !== "video" || !els.videoPlayer.src) {
        els.playerShell.dataset.mode = "video";
        loadHlsVideo(stream, false);
      }
    }
  }
  if (/\.m3u8(?:[?#].*)?$/i.test(playbackUrl)) {
    await transcribeHlsAudio(playbackUrl);
    return;
  }
  if (els.playerShell.dataset.mode === "embed") {
    setTranscriptButtons(false);
    setTranscriptStatus("Could not resolve an unencrypted audio stream for this video.", "error");
    return;
  }
  await startElementTapTranscription();
}

async function transcribeHlsAudio(playbackUrl) {
  const token = ++hlsTranscriptionToken;
  hlsAbort = new AbortController();
  audioTrackTranscribing = true;
  setTranscriptButtons(true);
  setTranscriptStatus("Reading audio track from the stream...", "working");
  setStatus("Transcribing the stream's audio segments. Keep the video playing.");
  await ensurePlayerPlaying();

  try {
    const plan = await loadHlsAudioPlan(playbackUrl, hlsAbort.signal);
    if (!stillTranscribingHls(token)) return;
    let index = hlsSegmentIndexAt(plan.segments, els.videoPlayer.currentTime || 0);
    if (index >= plan.segments.length) {
      finishHlsTranscription(token, "The playhead is already at the end of the audio track.");
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot decode the audio track.");
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") await audioContext.resume();

    let isFirst = true;
    while (stillTranscribingHls(token) && index < plan.segments.length) {
      const windowDuration = isFirst && !els.transcriptText.value.trim() ? 6 : 12;
      const audioWindow = takeHlsWindow(plan.segments, index, windowDuration);
      index += audioWindow.length;
      isFirst = false;
      const { start } = audioWindow[0];
      const end = audioWindow[audioWindow.length - 1].start + audioWindow[audioWindow.length - 1].duration;
      setTranscriptStatus(`Transcribing ${formatTime(start)}–${formatTime(end)}...`, "working");
      const samples = await decodeHlsAudioWindow(audioContext, plan.initUrl, audioWindow, hlsAbort.signal);
      if (!stillTranscribingHls(token)) return;
      await submitTranscriptSamples(samples, start, end, hlsAbort.signal);
    }
    finishHlsTranscription(token);
  } catch (error) {
    if (!stillTranscribingHls(token) || error.name === "AbortError") return;
    console.warn("HLS transcription failed, trying element tap:", error);
    setTranscriptStatus(`Stream audio decoding failed (${error.message}). Tapping video playback instead...`, "working");
    await startElementTapTranscription();
  }
}

function stillTranscribingHls(token) {
  return audioTrackTranscribing && token === hlsTranscriptionToken && !hlsAbort?.signal.aborted;
}

function finishHlsTranscription(token, emptyMessage = "") {
  if (token !== hlsTranscriptionToken) return;
  audioTrackTranscribing = false;
  setTranscriptButtons(false);
  if (els.transcriptText.value.trim()) {
    setTranscriptStatus("Audio track transcript saved for this video.", "ready");
    setStatus("Audio track transcript saved for this video.");
    return;
  }
  setTranscriptStatus(emptyMessage || "Reached the end of the audio track without recognized speech.", "ready");
}

async function loadHlsAudioPlan(playbackUrl, signal) {
  const playlistUrl = core.toAbsoluteUrl(playbackUrl, window.location.href) || playbackUrl;
  const first = core.parseHlsPlaylist(await fetchText(playlistUrl, signal), playlistUrl);
  if (first.segments.length) return first;
  const mediaUrl = first.audioPlaylistUrl || first.variantUrl;
  if (!mediaUrl || mediaUrl === playbackUrl) throw new Error("This stream has no audio playlist.");
  const media = core.parseHlsPlaylist(await fetchText(mediaUrl, signal), mediaUrl);
  if (!media.segments.length) throw new Error("The audio playlist has no segments.");
  return media;
}

async function fetchText(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not read the stream playlist (${response.status}).`);
  return response.text();
}

async function fetchArrayBuffer(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not read an audio segment (${response.status}).`);
  return response.arrayBuffer();
}

function hlsSegmentIndexAt(segments, time) {
  const index = segments.findIndex((segment) => segment.start + segment.duration > time + 0.05);
  return index === -1 ? segments.length : index;
}

function takeHlsWindow(segments, index, minSeconds) {
  const window = [];
  let duration = 0;
  while (index + window.length < segments.length && (window.length === 0 || duration < minSeconds)) {
    const segment = segments[index + window.length];
    window.push(segment);
    duration += segment.duration;
  }
  return window;
}

async function decodeHlsAudioWindow(context, initUrl, segments, signal) {
  const init = initUrl ? await fetchArrayBuffer(initUrl, signal) : null;
  const pieces = [];
  for (const segment of segments) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const body = await fetchArrayBuffer(segment.url, signal);
    const combined = init ? concatArrayBuffers([init, body]) : body;
    const decoded = await context.decodeAudioData(combined.slice());
    pieces.push(audioBufferTo16kMono(decoded));
  }
  return concatFloat32(pieces);
}

function concatArrayBuffers(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    bytes.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  });
  return bytes.buffer;
}

function concatFloat32(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  parts.forEach((part) => {
    merged.set(part, offset);
    offset += part.length;
  });
  return merged;
}

function audioBufferTo16kMono(audioBuffer) {
  const { length } = audioBuffer;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i];
  }
  if (channels > 1) {
    for (let i = 0; i < length; i += 1) mono[i] /= channels;
  }
  return downsampleTo16k(mono, audioBuffer.sampleRate);
}

async function submitTranscriptSamples(samples, chunkStartTime, chunkEndTime, signal) {
  if (!samples.length) return;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms < 0.005) {
    setTranscriptStatus(`No speech in ${formatTime(chunkStartTime)}–${formatTime(chunkEndTime)}.`, "working");
    return;
  }

  setTranscriptStatus(
    `Transcribing ${formatTime(chunkStartTime)}–${formatTime(chunkEndTime)}. The first run waits while the speech model loads.`,
    "working"
  );
  const request = linkedAbortSignal(signal, 180000);
  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcmBase64: floatTo16BitPCMBase64(samples),
        language: els.sourceLang.value,
        currentTime: chunkStartTime,
      }),
      signal: request.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Transcription returned ${response.status}.`);
    if (!data.text) {
      setTranscriptStatus(`No speech recognized in ${formatTime(chunkStartTime)}–${formatTime(chunkEndTime)}.`, "working");
      return;
    }
    const newText = `[${formatTime(chunkStartTime)}] ${data.text}`;
    els.transcriptText.value = els.transcriptText.value.trim()
      ? `${els.transcriptText.value.trim()}\n${newText}`
      : newText;
    updateTranscriptFields();
    const video = selectedVideo();
    if (video) {
      video.transcript = els.transcriptText.value;
      video.transcriptSource = video.transcriptSource || "audio";
      saveState();
      void flushFolderMetadata(video);
    }
    setTranscriptStatus(
      audioTrackTranscribing
        ? `Saved ${formatTime(chunkStartTime)}–${formatTime(chunkEndTime)}. Continuing through the audio track.`
        : "Audio track transcript saved for this video."
    );
  } finally {
    request.done();
  }
}

function linkedAbortSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParent = () => controller.abort();
  parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

async function startElementTapTranscription() {
  haltAudioCapture();

  let tap;
  try {
    tap = await openAudioTap();
  } catch (error) {
    setTranscriptButtons(false);
    setTranscriptStatus(`Could not read the video audio: ${error.message}`, "error");
    return;
  }
  if (!tap) {
    setTranscriptButtons(false);
    setTranscriptStatus("This browser cannot capture audio from the player.", "error");
    return;
  }
  if (els.videoPlayer.paused) {
    try {
      await els.videoPlayer.play();
    } catch {}
  }
  if (els.videoPlayer.paused) {
    if (tap.kind === "stream") {
      try {
        tap.source.disconnect();
      } catch {}
    }
    setTranscriptButtons(false);
    setTranscriptStatus("Press play. Transcription reads the audio while the video plays.", "error");
    return;
  }

  audioTap = tap;
  audioTrackTranscribing = true;
  accumulatedSamples = [];
  accumulatedLength = 0;
  silentStreak = 0;
  lastChunkTime = els.videoPlayer.currentTime || 0;

  audioProcessor = await createCaptureProcessor(tap.audioContext, collectAudioSamples);
  tap.source.connect(audioProcessor);
  const mute = tap.audioContext.createGain();
  mute.gain.value = 0;
  audioProcessor.connect(mute);
  mute.connect(tap.audioContext.destination);

  if (transcriptionEndedHandler) els.videoPlayer.removeEventListener("ended", transcriptionEndedHandler);
  transcriptionEndedHandler = () => stopTranscription();
  els.videoPlayer.addEventListener("ended", transcriptionEndedHandler);

  setTranscriptButtons(true);
  const currentTime = formatTime(els.videoPlayer.currentTime || 0);
  setTranscriptStatus(
    `Listening from ${currentTime}. The first line appears after a short stretch of speech. The speech model downloads on the first run.`,
    "working"
  );
  setStatus("Transcribing from the video audio. Keep the video playing.");
}

async function processPendingAudioChunk() {
  if (isTranscribingChunk || accumulatedLength === 0) return;
  isTranscribingChunk = true;

  const merged = new Float32Array(accumulatedLength);
  let offset = 0;
  for (const chunk of accumulatedSamples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  accumulatedSamples = [];
  accumulatedLength = 0;

  const chunkStartTime = lastChunkTime;
  const chunkEndTime = els.videoPlayer.currentTime || chunkStartTime + merged.length / TRANSCRIBE_SAMPLE_RATE;
  lastChunkTime = chunkEndTime;

  let sumSquares = 0;
  for (let i = 0; i < merged.length; i++) sumSquares += merged[i] * merged[i];
  const rms = Math.sqrt(sumSquares / merged.length);

  try {
    if (rms < 0.005) {
      silentStreak += 1;
      setTranscriptStatus(
        silentStreak >= 2
          ? "The video is playing, but its audio is not reaching the transcriber."
          : `Listening at ${formatTime(chunkEndTime)}. That stretch had no audible speech.`,
        silentStreak >= 2 ? "error" : "working"
      );
      return;
    }

    silentStreak = 0;
    setTranscriptStatus(
      `Transcribing ${formatTime(chunkStartTime)}–${formatTime(chunkEndTime)}. The first run waits while the speech model loads.`,
      "working"
    );
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcmBase64: floatTo16BitPCMBase64(merged),
        language: els.sourceLang.value,
        currentTime: chunkStartTime,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Transcription returned ${response.status}.`);
    if (data.text) {
      const newText = `[${formatTime(chunkStartTime)}] ${data.text}`;
      els.transcriptText.value = els.transcriptText.value.trim()
        ? `${els.transcriptText.value.trim()}\n${newText}`
        : newText;
      updateTranscriptFields();
      const video = selectedVideo();
      if (video) {
        video.transcript = els.transcriptText.value;
        video.transcriptSource = video.transcriptSource || "audio";
        saveState();
        void flushFolderMetadata(video);
      }
      setTranscriptStatus(
        audioTrackTranscribing
          ? `Listening at ${formatTime(chunkEndTime)}. New lines appear as speech continues.`
          : "Audio track transcript saved for this video."
      );
      return;
    }
    setTranscriptStatus(`Listening at ${formatTime(chunkEndTime)}. No speech recognized in that stretch yet.`, "working");
  } catch (error) {
    setTranscriptStatus(`Transcription failed: ${error.message}`, "error");
    setStatus(`Transcription failed: ${error.message}`);
  } finally {
    isTranscribingChunk = false;
    const chunkThreshold = els.transcriptText.value.trim() ? TRANSCRIBE_CHUNK_SAMPLES : TRANSCRIBE_SAMPLE_RATE * 5;
    const shouldContinue = audioTrackTranscribing && accumulatedLength >= chunkThreshold;
    const shouldFlushTail = !audioTrackTranscribing && accumulatedLength > TRANSCRIBE_SAMPLE_RATE / 2;
    if (shouldContinue || shouldFlushTail) processPendingAudioChunk();
  }
}

async function stopTranscription() {
  const shouldFlush = !isTranscribingChunk && accumulatedLength > TRANSCRIBE_SAMPLE_RATE / 2;
  audioTrackTranscribing = false;
  hlsTranscriptionToken += 1;
  if (hlsAbort) {
    hlsAbort.abort();
    hlsAbort = null;
  }
  if (transcriptionEndedHandler) {
    els.videoPlayer.removeEventListener("ended", transcriptionEndedHandler);
    transcriptionEndedHandler = null;
  }
  disconnectAudioTap();
  if (shouldFlush) processPendingAudioChunk();
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  setTranscriptButtons(false);
  if (isTranscribingChunk) {
    setTranscriptStatus("Finishing the current stretch of audio...", "working");
  } else if (els.transcriptText.value.trim()) {
    const video = selectedVideo();
    const onDisk = video ? await flushFolderMetadata(video) : false;
    setTranscriptStatus(onDisk ? "Transcript saved in this video's folder." : "Audio track transcript saved for this video.", "ready");
  } else if (els.transcriptStatus.dataset.tone !== "error") {
    setTranscriptStatus("Transcription stopped.", "ready");
  }
}

function setTranscriptButtons(isRecording, isProcessing = false) {
  const busy = isRecording || isProcessing;
  els.startTranscriptButton.disabled = busy || !selectedVideo();
  els.startTranscriptButton.classList.toggle("is-busy", busy);
  els.stopTranscriptButton.disabled = !isRecording || isProcessing;
}

function setTranscriptStatus(message, tone = "ready") {
  els.transcriptStatus.dataset.tone = tone;
  if (tone === "working") {
    els.transcriptStatus.innerHTML = `
      <span class="transcript-status-icon amber-throbber amber-throbber--xs" aria-hidden="true"></span>
      <span class="transcript-status-text">${escapeHtml(message)}</span>
    `;
  } else {
    els.transcriptStatus.textContent = message;
  }
}

async function translateTranscript() {
  const text = els.transcriptText.value.trim();
  if (!text) {
    setStatus("Add or transcribe text before translating.");
    setTranscriptStatus("Add or create a transcript before translating it.", "error");
    return;
  }

  const sourceLanguage = els.sourceLang.value;
  const targetLanguage = els.targetLang.value;
  if (sourceLanguage !== "auto" && sourceLanguage === targetLanguage) {
    els.translatedText.value = text;
    updateTranscriptFields();
    const onDisk = await flushFolderMetadata(selectedVideo());
    setStatus(onDisk ? "Transcript saved in this video's folder." : "Source and target languages match, so the original transcript was copied.");
    setTranscriptStatus(onDisk ? "Transcript saved in this video's folder." : "Source and target languages match; the transcript was copied.");
    return;
  }

  els.translateButton.disabled = true;
  setTranscriptStatus("Translating the transcript...", "working");
  try {
    const translator = await createBrowserTranslator(sourceLanguage, targetLanguage);
    if (translator) {
      els.translatedText.value = await translator.translate(text);
      updateTranscriptFields();
      const onDisk = await flushFolderMetadata(selectedVideo());
      setTranscriptStatus(onDisk ? "Translation saved in this video's folder." : "Translation complete using the browser's on-device translator.");
      setStatus(onDisk ? "Translation saved in this video's folder." : "Translated with the browser Translator API.");
      return;
    }

    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sourceLanguage, targetLanguage }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Translation request returned ${response.status}.`);
    els.translatedText.value = data.translation;
    updateTranscriptFields();
    const video = selectedVideo();
    const onDisk = video ? await flushFolderMetadata(video) : false;
    setTranscriptStatus(
      onDisk
        ? "Translation saved in this video's folder."
        : `Translation complete using ${data.service || "the server translator"}.`
    );
    setStatus(onDisk ? "Translation saved in this video's folder." : `Translated to ${targetLanguage.toUpperCase()}.`);
  } catch (error) {
    setTranscriptStatus(`Translation failed: ${error.message}`, "error");
    setStatus(`Translation failed: ${error.message}`);
  } finally {
    els.translateButton.disabled = !selectedVideo();
  }
}

async function createBrowserTranslator(sourceLanguage, targetLanguage) {
  if (window.Translator?.create) {
    return window.Translator.create({ sourceLanguage, targetLanguage });
  }
  if (window.translation?.createTranslator) {
    return window.translation.createTranslator({ sourceLanguage, targetLanguage });
  }
  return null;
}

async function proofreadTranscript() {
  const original = els.translatedText.value.trim() || els.transcriptText.value.trim();
  if (!original) {
    setStatus("Add transcript text before proofreading.");
    setTranscriptStatus("Add or transcribe text before proofreading.", "error");
    return;
  }

  const removeTimestamps = Boolean(els.proofreadStripTimestamps ? els.proofreadStripTimestamps.checked : true);
  const deduplicateSpeakers = Boolean(els.proofreadGroupSpeakers ? els.proofreadGroupSpeakers.checked : true);

  els.proofreadButton.disabled = true;
  setTranscriptStatus("Proofreading text: formatting sentences, fixing punctuation & cleaning fillers...", "working");
  try {
    const response = await fetch("/api/proofread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: original,
        language: els.targetLang.value || els.sourceLang.value || "en",
        removeTimestamps,
        deduplicateSpeakers,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Proofreading request failed.");

    els.translatedText.value = data.proofread;
    updateTranscriptFields();
    const video = selectedVideo();
    const onDisk = video ? await flushFolderMetadata(video) : false;
    setTranscriptStatus(
      onDisk ? "Proofread text saved in this video's folder." : "Proofreading complete: cleaned disfluencies, fixed punctuation & casing.",
      "ready"
    );
    setStatus(onDisk ? "Proofread text saved in this video's folder." : "Proofread text with punctuation, casing, filler removal, and clean paragraphs.");
  } catch (error) {
    const fallback = localProofread(original, { removeTimestamps, deduplicateSpeakers });
    els.translatedText.value = fallback;
    updateTranscriptFields();
    const video = selectedVideo();
    if (video) await flushFolderMetadata(video);
    setTranscriptStatus("Proofread locally with punctuation, casing, and spacing cleanup.", "ready");
    setStatus(`Proofread locally: ${error.message}`);
  } finally {
    els.proofreadButton.disabled = !selectedVideo();
  }
}


function downloadTranscript() {
  const video = selectedVideo();
  if (!video) return;
  const body = [
    `Title: ${video.title || "Untitled video"}`,
    `Speaker: ${video.speaker || ""}`,
    `Video URL: ${video.url || ""}`,
    `Source URL: ${video.sourceUrl || ""}`,
    `Language: ${video.language || ""}`,
    `Tags: ${video.tags || ""}`,
    "",
    "Notes",
    video.notes || "",
    "",
    "Transcript",
    video.transcript || "",
    "",
    "Translation / proofread version",
    video.translation || "",
  ].join("\n");
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(video.title || "transcript")}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus("Transcript exported as a text file.");
}

function appendTranscriptLine(current, line) {
  if (!line) return current;
  const time = formatTime(els.videoPlayer.currentTime || 0);
  return `${current ? `${current}\n` : ""}[${time}] ${line}`.trim();
}

function localProofread(text, options = {}) {
  if (typeof core?.proofreadText === "function") {
    return core.proofreadText(text, els.targetLang?.value || els.sourceLang?.value || "en", options);
  }
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?])([A-Za-z])/g, "$1 $2")
    .split(/(?<=[.!?]\s+)/)
    .map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1))
    .join("")
    .trim();
}

function isLikelyVideoUrl(url) {
  return core.isLikelyVideoUrl(url);
}

function toEmbedUrl(url) {
  return core.toEmbedUrl(url);
}

function toAbsoluteUrl(url, baseUrl) {
  return core.toAbsoluteUrl(url, baseUrl, window.location.href);
}

function cleanUrl(url) {
  return core.cleanUrl(url);
}

function inferTitleFromUrl(url) {
  return core.inferTitleFromUrl(url);
}

function inferTags(url) {
  const tags = [];
  if (/summit/i.test(url)) tags.push("summit");
  if (/youtube|youtu\.be/i.test(url)) tags.push("youtube");
  if (/vimeo/i.test(url)) tags.push("vimeo");
  if (/m3u8/i.test(url)) tags.push("stream");
  return tags.join(", ");
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function speechLocale(language) {
  const locales = {
    auto: "en-US",
    de: "de-DE",
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    pl: "pl-PL",
    pt: "pt-PT",
    sv: "sv-SE",
  };
  return locales[language] || "en-US";
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function setStatus(message, isRunning) {
  if (!els.statusLine) return;
  const running = isRunning !== undefined
    ? Boolean(isRunning)
    : /scanning|downloading|importing|transcribing|translating|verifying|loading|fetching|processing|checking|saving/i.test(message) &&
      !/completed|finished|done|failed|ready|select|cleared|restored/i.test(message);

  els.statusLine.classList.toggle("is-running", running);

  let textNode = els.statusLine.querySelector(".status-text");
  if (!textNode) {
    els.statusLine.innerHTML = `
      <span class="status-dot"></span>
      <span class="status-throbber amber-throbber amber-throbber--xs" aria-hidden="true"></span>
      <span class="status-text"></span>
    `;
    textNode = els.statusLine.querySelector(".status-text");
  }
  if (textNode) {
    textNode.textContent = message;
    els.statusLine.title = message;
  } else {
    els.statusLine.textContent = message;
    els.statusLine.title = message;
  }
}

function saveState() {
  core.saveState(localStorage, STORAGE_KEY, state);
}

function loadState() {
  return core.loadState(localStorage, STORAGE_KEY);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
