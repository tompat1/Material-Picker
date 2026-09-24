const STORAGE_KEY = "material-picker:v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const core = window.MaterialPickerCore;
const { archiveFolderName, estimateRemainingSeconds, formatBytes, formatDuration, libraryMediaSummary } = core;

const els = {
  addBlankButton: document.querySelector("#addBlankButton"),
  bulkDownloadProgress: document.querySelector("#bulkDownloadProgress"),
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
  moveCollectionSelect: document.querySelector("#moveCollectionSelect"),
  moveSelectedButton: document.querySelector("#moveSelectedButton"),
  openSourceButton: document.querySelector("#openSourceButton"),
  openVideoButton: document.querySelector("#openVideoButton"),
  parsePasteButton: document.querySelector("#parsePasteButton"),
  playerShell: document.querySelector(".player-shell"),
  proofreadButton: document.querySelector("#proofreadButton"),
  playerStatus: document.querySelector("#playerStatus"),
  retryPlaybackButton: document.querySelector("#retryPlaybackButton"),
  renameCollectionButton: document.querySelector("#renameCollectionButton"),
  searchLibrary: document.querySelector("#searchLibrary"),
  saveSelectedOfflineButton: document.querySelector("#saveSelectedOfflineButton"),
  sourceFrame: document.querySelector("#sourceFrame"),
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
let state = loadState();
let activeCollectionId = "all";
const selectedVideoIds = new Set();

init();

function init() {
  bindEvents();
  render();
  state.videos.forEach((video) => {
    if (!["downloading", "exporting"].includes(video.offlineDownloadStatus)) return;
    video.offlineDownloadStatus = "interrupted";
    video.offlineError = "The download stopped. Download it again to continue from the pieces already saved.";
  });
  saveState();
  void restoreDownloadFolder();
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
  els.retryPlaybackButton.addEventListener("click", renderPlayer);
  els.renameCollectionButton.addEventListener("click", renameActiveCollection);
  els.searchLibrary.addEventListener("input", () => {
    renderLibrary();
    renderCollectionManager();
  });
  els.selectVisibleButton.addEventListener("click", selectVisibleVideos);
  els.markAllOfflineButton.addEventListener("click", toggleMarkAllOffline);
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
}

async function handleBrowseFolder() {
  try {
    const response = await fetch("/api/choose-folder", { signal: AbortSignal.timeout(120000) });
    if (response.ok) {
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (data?.supported && data.chosenPath) {
        els.folderPath.value = data.chosenPath;
        setStatus(`Selected folder: ${data.chosenPath}. Click Scan to import.`);
        return;
      }
      if (data?.supported && data.cancelled) {
        return;
      }
    }
  } catch {
    // If server helper is not available, fallback to browser directory input
  }

  if (els.localFolderInput) {
    els.localFolderInput.click();
  }
}

async function handleFolderScan(event) {
  event.preventDefault();
  const folderPath = els.folderPath.value.trim();
  if (!folderPath) {
    setStatus("Enter or browse for a local folder path first.");
    return;
  }

  state.lastScannedFolder = folderPath;
  saveState();
  renderRecentSources();
  setStatus(`Scanning folder “${folderPath}” and all nested subfolders...`);
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
      setStatus(`Scanned “${folderName}” (including subfolders), but found no supported video files.`);
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

    videos.forEach((item) => {
      const existing = state.videos.find((v) => v.url === item.url);
      if (existing) {
        if (collectionId && !existing.collectionId) {
          existing.collectionId = collectionId;
        }
        return;
      }

      const tagsList = [];
      if (item.subfolder) {
        tagsList.push(...item.subfolder.split("/").map((s) => s.trim()).filter(Boolean));
      } else {
        tagsList.push("local");
      }

      const nextVideo = {
        id: crypto.randomUUID(),
        title: item.title,
        speaker: "",
        url: item.url,
        sourceUrl: item.relativePath || folderPath,
        language: "English",
        tags: tagsList.join(", "),
        notes: `File: ${item.relativePath || item.name} (${formatBytes(item.size)})`,
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
    });

    if (firstAddedId) {
      state.selectedId = firstAddedId;
    }

    saveState();
    render();

    const distinctSubfolders = new Set(videos.map((v) => v.subfolder).filter(Boolean));
    const subfolderInfo = distinctSubfolders.size > 0 ? ` across ${distinctSubfolders.size} subfolders` : "";

    setStatus(
      `Scraped ${addedCount} video ${addedCount === 1 ? "file" : "files"}${subfolderInfo} into “${folderName}”. Ready to play!`
    );
    if (addedCount) showDesk(addedCount === 1 ? "screen" : "reels");
  } catch (error) {
    setStatus(`Folder scan error: ${error.message}`);
  } finally {
    if (els.scanFolderButton) els.scanFolderButton.disabled = false;
  }
}

function handleLocalFolderInput(event) {
  const fileList = event.target.files;
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  const videoFiles = files.filter((file) => core.isLikelyVideoUrl(file.name));

  if (videoFiles.length === 0) {
    setStatus("Selected folder contains no supported video files.");
    return;
  }

  const samplePath = videoFiles[0].webkitRelativePath || "";
  const rootFolderName = samplePath.split("/")[0] || "Imported Folder";

  if (els.folderPath && !els.folderPath.value) {
    els.folderPath.value = rootFolderName;
  }

  let collectionId = "";
  if (els.folderCreateCollection?.checked) {
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

  videoFiles.forEach((file) => {
    const relPath = file.webkitRelativePath || file.name;
    const pathParts = relPath.split("/");
    const subfolders = pathParts.slice(1, -1);
    const title = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
    const objectUrl = URL.createObjectURL(file);

    const tagsList = [];
    if (subfolders.length > 0) {
      tagsList.push(...subfolders);
    } else {
      tagsList.push("local");
    }

    const nextVideo = {
      id: crypto.randomUUID(),
      title: title || file.name,
      speaker: "",
      url: objectUrl,
      sourceUrl: relPath,
      language: "English",
      tags: tagsList.join(", "),
      notes: `File: ${relPath} (${formatBytes(file.size)})`,
      transcript: "",
      translation: "",
      collectionId: collectionId || (activeCollectionId !== "all" && activeCollectionId !== "unfiled" ? activeCollectionId : ""),
      playbackStatus: "ready",
      playbackMessage: "Local browser file ready for playback",
      checkedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    state.videos.unshift(nextVideo);
    if (!firstAddedId) firstAddedId = nextVideo.id;
    addedCount += 1;
  });

  if (firstAddedId) {
    state.selectedId = firstAddedId;
  }

  saveState();
  render();

  setStatus(`Imported ${addedCount} video ${addedCount === 1 ? "file" : "files"} from “${rootFolderName}”. Ready to play!`);
  if (addedCount) showDesk(addedCount === 1 ? "screen" : "reels");
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

function addExtractedVideos(items, sourceUrl = "") {
  const ids = [];
  items.forEach((item) => {
    if (state.videos.some((video) => video.url === item.url)) return;
    ids.push(
      addVideo(
        {
          title: item.title,
          url: item.url,
          sourceUrl: item.sourceUrl || sourceUrl,
          language: "English",
          tags: inferTags(item.url),
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
}

function updateTranscriptFields() {
  const video = selectedVideo();
  if (!video) return;
  video.transcript = els.transcriptText.value;
  video.translation = els.translatedText.value;
  saveState();
  renderLibrary();
}

function selectVideo(id) {
  state.selectedId = id;
  saveState();
  render();
  showDesk("screen");
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
  const videos = state.videos;
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

let libraryMeasureRunning = false;

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
        : hasDiskCopy(video)
          ? "offline"
          : video.playbackStatus || "unchecked";
    const labels = { blocked: "Blocked", checking: "Checking", ready: "Ready", saving: "Saving", offline: "Offline", unknown: "Manual check", unchecked: "Unchecked" };
    badge.textContent = labels[status] || labels.unchecked;
    badge.dataset.status = status;
    badge.title = video.playbackMessage || "Not checked yet";
    const downloadProgress = card.querySelector(".card-download-progress");
    if (["downloading", "exporting"].includes(video.offlineDownloadStatus)) {
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
  els.markAllOfflineButton.disabled = !eligibleVisible.length || bulkOfflineRunning;
  els.markAllOfflineButton.querySelector("span:last-child").textContent = allVisibleMarked ? "Unmark all" : "Mark all";
  els.libraryOfflinePermission.disabled = !pending.length || bulkOfflineRunning;
  if (offlineExportDirectoryHandle) els.libraryOfflinePermission.disabled = !actionable || bulkOfflineRunning;
  els.saveSelectedOfflineButton.disabled =
    !actionable || !els.libraryOfflinePermission.checked || bulkOfflineRunning;
  els.saveSelectedOfflineButton.querySelector("span:last-child").textContent =
    offlineExportDirectoryHandle && pending.length === 0 ? "Copy marked to folder" : "Download marked";
  renderOfflineDestination();
  els.bulkDownloadProgress.hidden = !bulkOfflineRunning;
  if (bulkOfflineRunning) {
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
  if (speed > 0) details.push(`${formatBytes(speed)}/s`);
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
  els.openSourceButton.disabled = !video?.sourceUrl;
  if (video?.sourceUrl) setSourceFrame(video.sourceUrl, false);
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
  const playbackUrl = hasOfflineCopy ? video.offlineUrl : video.url;
  const embedUrl = hasOfflineCopy ? "" : toEmbedUrl(playbackUrl);
  if (embedUrl) {
    els.embedPlayer.onload = () => markSelectedPlaybackReady(video.id, "The provider player loaded successfully.");
    els.embedPlayer.src = embedUrl;
    els.playerShell.dataset.mode = "embed";
    setPlayerStatus("Loading the provider's secure embedded player. Use Open original if access requires sign-in.");
    return;
  }

  els.playerShell.dataset.mode = "video";
  if (/\.m3u8([?#].*)?$/i.test(playbackUrl)) {
    const isLocalHls = hasOfflineCopy || playbackUrl.startsWith("/offline-media/") || playbackUrl.startsWith("/local-media/");
    loadHlsVideo(playbackUrl, isLocalHls);
    return;
  }

  els.videoPlayer.onloadedmetadata = () => setPlayerStatus(hasOfflineCopy ? "Offline copy ready." : "Video ready.");
  els.videoPlayer.onerror = () =>
    setPlayerStatus("This media server blocked browser playback. Try Open original or verify that the link is still public.");
  els.videoPlayer.src = playbackUrl;
  setPlayerStatus(hasOfflineCopy ? "Loading the saved disk copy..." : "Loading direct video...");
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

function loadHlsVideo(url, isOffline = false) {
  const isLocalStream = url.startsWith("/offline-media/") || url.startsWith("/local-media/");
  if ((isOffline || isLocalStream) && window.Hls?.isSupported()) {
    let recoveredMediaError = false;
    hlsPlayer = new window.Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
    });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(els.videoPlayer);
    hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
      const msg = url.includes("/local-media/")
        ? "Local HLS video ready to play with audio/video segments."
        : "Offline copy ready to play from disk.";
      setPlayerStatus(msg);
      if (state.selectedId) markSelectedPlaybackReady(state.selectedId, msg);
    });
    hlsPlayer.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
        recoveredMediaError = true;
        setPlayerStatus("Recovering the saved video playback...");
        hlsPlayer.recoverMediaError();
        return;
      }
      const reason = data.details || data.type || "local stream error";
      setPlayerStatus(`The stream could not be played (${reason}). Retry it or check folder.`);
    });
    setPlayerStatus(url.includes("/local-media/") ? "Loading local HLS stream with separate audio/video segments..." : "Loading the saved HLS copy from disk...");
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

  if (window.Hls?.isSupported()) {
    hlsPlayer = new window.Hls({ enableWorker: true, lowLatencyMode: false });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(els.videoPlayer);
    hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () =>
      setPlayerStatus(isOffline ? "Offline HLS copy ready." : "HLS stream ready with the compatibility player.")
    );
    hlsPlayer.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      const reason = data.details || data.type || "stream error";
      setPlayerStatus(`HLS playback failed (${reason}). The host may require CORS access or the stream may have expired.`);
    });
    setPlayerStatus(isOffline ? "Loading the saved HLS copy from disk..." : "Loading HLS with the compatibility player...");
    return;
  }

  setPlayerStatus("This browser cannot play HLS streams. Open the original source in a compatible browser.");
}

function destroyHlsPlayer() {
  if (!hlsPlayer) return;
  hlsPlayer.destroy();
  hlsPlayer = null;
}

function setPlayerStatus(message) {
  els.playerStatus.textContent = message;
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
      } else if (video.offlineUrl) {
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
  renderLibraryOfflineManager();
  if (failures.length) {
    const saved = videos.length - failures.length;
    setStatus(`Saved ${saved} of ${videos.length} marked videos. ${failures.length} could not be saved; select one to see its error.`);
  } else {
    setStatus(`Saved all ${videos.length} marked videos to disk for offline playback.`);
  }
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
  renderOfflineDestination();
  renderLibraryOfflineManager();
  renderRecentSources();
}

async function ensureDownloadFolder() {
  if (offlineExportDirectoryHandle) return true;
  const stored = await storedDownloadFolder().catch(() => null);
  if (stored?.requestPermission) {
    if ((await stored.requestPermission({ mode: "readwrite" })) === "granted") {
      offlineExportDirectoryHandle = stored;
      state.lastOfflineFolderName = stored.name || state.lastOfflineFolderName || "";
      saveState();
      renderRecentSources();
      renderOfflineDestination();
      return true;
    }
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

async function writeDownloadPlan(video, plan) {
  const destination = await offlineExportDirectoryHandle.getDirectoryHandle(archiveFolderName(video.title, video.id), {
    create: true,
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
    await writePlannedFile(destination, file, noteProgress);
    video.offlineFilesDone += 1;
    video.offlineResumePaths = [...new Set([...(video.offlineResumePaths || []), file.path])];
    saveState();
    renderLibrary();
    renderLibraryOfflineManager();
  }

  video.offlineDownloadStatus = "completed";
  video.offlineExportedTo = offlineExportDirectoryHandle.name;
  video.offlineExportedAt = new Date().toISOString();
  video.offlineSize = video.offlineBytesDownloaded;
  delete video.offlineResumePaths;
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

async function writePlannedFile(root, file, onBytes) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await writePlannedFileOnce(root, file, onBytes);
    } catch (error) {
      lastError = error;
      if (attempt === 4 || !isTransientDownloadError(error)) break;
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
  const destination = await offlineExportDirectoryHandle.getDirectoryHandle(
    archiveFolderName(video.title, copyId),
    { create: true }
  );
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
  video.offlineDownloadStatus = "completed";
  video.offlineExportedTo = offlineExportDirectoryHandle.name;
  video.offlineExportedAt = new Date().toISOString();
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
  setStatus(`Copied “${video.title || "Untitled video"}” to “${offlineExportDirectoryHandle.name}”.`);
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
  return /vimeo\.com|\.(?:m3u8|mp4|webm|ogv|ogg|mov|m4v)(?:[?#].*)?$/i.test(String(url || ""));
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

function setSourceFrame(url, updateInput = true) {
  if (!url) return;
  els.sourceFrame.src = url;
  if (updateInput) els.sourceUrl.value = url;
  const disclosure = document.querySelector("#sourceDisclosure");
  if (disclosure) disclosure.open = true;
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

  try {
    if (els.videoPlayer.paused) {
      await els.videoPlayer.play();
    }
  } catch (error) {
    console.warn("Automatic video playback could not be started:", error);
  }

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
      setTranscriptStatus(`Loaded ${data.cueCount} timed caption cues (${data.label || data.language}).`);
      setStatus("The provider caption track was saved as this video's transcript.");
      return;
    } catch (error) {
      setTranscriptStatus(`${error.message} Transcribing using video audio tracks instead.`, "working");
    }
  }

  await startAudioTrackTranscription(video);
}

function collectAudioSamples(inputData, sampleRate) {
  if (!audioTrackTranscribing || els.videoPlayer.paused) return;
  const downsampled = downsampleTo16k(inputData, sampleRate);
  accumulatedSamples.push(downsampled);
  accumulatedLength += downsampled.length;
  if (accumulatedLength >= TRANSCRIBE_CHUNK_SAMPLES && !isTranscribingChunk) {
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
  return video?.url || "";
}

async function startAudioTrackTranscription() {
  haltAudioCapture();
  const playbackUrl = currentPlaybackUrl();
  if (/\.m3u8(?:[?#].*)?$/i.test(playbackUrl)) {
    await transcribeHlsAudio(playbackUrl);
    return;
  }
  await startElementTapTranscription();
}

async function transcribeHlsAudio(playbackUrl) {
  const token = ++hlsTranscriptionToken;
  hlsAbort = new AbortController();
  audioTrackTranscribing = true;
  setTranscriptButtons(true);
  setTranscriptStatus("Reading the saved audio track from the stream.", "working");
  setStatus("Transcribing the stream's audio segments. Playback can stay paused.");

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

    while (stillTranscribingHls(token) && index < plan.segments.length) {
      const audioWindow = takeHlsWindow(plan.segments, index, 12);
      index += audioWindow.length;
      const start = audioWindow[0].start;
      const end = audioWindow[audioWindow.length - 1].start + audioWindow[audioWindow.length - 1].duration;
      setTranscriptStatus(`Reading audio ${formatTime(start)}–${formatTime(end)}.`, "working");
      const samples = await decodeHlsAudioWindow(audioContext, plan.initUrl, audioWindow, hlsAbort.signal);
      if (!stillTranscribingHls(token)) return;
      await submitTranscriptSamples(samples, start, end, hlsAbort.signal);
    }
    finishHlsTranscription(token);
  } catch (error) {
    if (!stillTranscribingHls(token) || error.name === "AbortError") return;
    audioTrackTranscribing = false;
    setTranscriptButtons(false);
    setTranscriptStatus(`Transcription failed: ${error.message}`, "error");
    setStatus(`Transcription failed: ${error.message}`);
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
    const decoded = await context.decodeAudioData(combined.slice(0));
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
  const length = audioBuffer.length;
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
      saveState();
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
        saveState();
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
    const shouldContinue = audioTrackTranscribing && accumulatedLength >= TRANSCRIBE_CHUNK_SAMPLES;
    const shouldFlushTail = !audioTrackTranscribing && accumulatedLength > TRANSCRIBE_SAMPLE_RATE / 2;
    if (shouldContinue || shouldFlushTail) processPendingAudioChunk();
  }
}

function stopTranscription() {
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
    setTranscriptStatus("Audio track transcript saved for this video.", "ready");
  } else if (els.transcriptStatus.dataset.tone !== "error") {
    setTranscriptStatus("Transcription stopped.", "ready");
  }
}

function setTranscriptButtons(isRecording, isProcessing = false) {
  els.startTranscriptButton.disabled = isRecording || isProcessing || !selectedVideo();
  els.stopTranscriptButton.disabled = !isRecording || isProcessing;
}

function setTranscriptStatus(message, tone = "ready") {
  els.transcriptStatus.textContent = message;
  els.transcriptStatus.dataset.tone = tone;
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
    setStatus("Source and target languages match, so the original transcript was copied.");
    setTranscriptStatus("Source and target languages match; the transcript was copied.");
    return;
  }

  els.translateButton.disabled = true;
  setTranscriptStatus("Translating the transcript...", "working");
  try {
    const translator = await createBrowserTranslator(sourceLanguage, targetLanguage);
    if (translator) {
      els.translatedText.value = await translator.translate(text);
      updateTranscriptFields();
      setTranscriptStatus("Translation complete using the browser's on-device translator.");
      setStatus("Translated with the browser Translator API.");
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
    if (video) {
      video.translation = data.translation;
      saveState();
    }
    setTranscriptStatus(`Translation complete using ${data.service || "the server translator"}.`);
    setStatus(`Translated to ${targetLanguage.toUpperCase()}.`);
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

  els.proofreadButton.disabled = true;
  setTranscriptStatus("Proofreading text: formatting sentences, fixing punctuation & cleaning fillers...", "working");
  try {
    const response = await fetch("/api/proofread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: original,
        language: els.targetLang.value || els.sourceLang.value || "en",
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Proofreading request failed.");

    els.translatedText.value = data.proofread;
    updateTranscriptFields();
    const video = selectedVideo();
    if (video) {
      video.translation = data.proofread;
      saveState();
    }
    setTranscriptStatus("Proofreading complete: cleaned disfluencies, fixed punctuation & casing.", "ready");
    setStatus("Proofread text with punctuation, casing, filler removal, and clean paragraphs.");
  } catch (error) {
    const fallback = localProofread(original);
    els.translatedText.value = fallback;
    updateTranscriptFields();
    const video = selectedVideo();
    if (video) {
      video.translation = fallback;
      saveState();
    }
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

function localProofread(text) {
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

function setStatus(message) {
  els.statusLine.textContent = message;
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
