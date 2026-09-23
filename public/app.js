const STORAGE_KEY = "material-picker:v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const core = window.MaterialPickerCore;
const { archiveFolderName, formatBytes, formatDuration } = core;

const els = {
  addBlankButton: document.querySelector("#addBlankButton"),
  bulkDownloadProgress: document.querySelector("#bulkDownloadProgress"),
  bulkOfflineStatus: document.querySelector("#bulkOfflineStatus"),
  bulkOfflineProgress: document.querySelector("#bulkOfflineProgress"),
  bulkOfflineProgressLabel: document.querySelector("#bulkOfflineProgressLabel"),
  checkLibraryButton: document.querySelector("#checkLibraryButton"),
  chooseLibraryFolderButton: document.querySelector("#chooseLibraryFolderButton"),
  chooseOfflineFolderButton: document.querySelector("#chooseOfflineFolderButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  clearAllButton: document.querySelector("#clearAllButton"),
  deleteVideoButton: document.querySelector("#deleteVideoButton"),
  deleteCollectionButton: document.querySelector("#deleteCollectionButton"),
  downloadTranscriptButton: document.querySelector("#downloadTranscriptButton"),
  duplicateVideoButton: document.querySelector("#duplicateVideoButton"),
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
  historyList: document.querySelector("#historyList"),
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
  offlinePath: document.querySelector("#offlinePath"),
  offlineDestinationStatus: document.querySelector("#offlineDestinationStatus"),
  offlinePermission: document.querySelector("#offlinePermission"),
  offlineProgress: document.querySelector("#offlineProgress"),
  offlineStatus: document.querySelector("#offlineStatus"),
  openSourceButton: document.querySelector("#openSourceButton"),
  openVideoButton: document.querySelector("#openVideoButton"),
  parsePasteButton: document.querySelector("#parsePasteButton"),
  playerShell: document.querySelector(".player-shell"),
  proofreadButton: document.querySelector("#proofreadButton"),
  playerStatus: document.querySelector("#playerStatus"),
  retryPlaybackButton: document.querySelector("#retryPlaybackButton"),
  removeOfflineButton: document.querySelector("#removeOfflineButton"),
  renameCollectionButton: document.querySelector("#renameCollectionButton"),
  searchLibrary: document.querySelector("#searchLibrary"),
  saveSelectedOfflineButton: document.querySelector("#saveSelectedOfflineButton"),
  sourceFrame: document.querySelector("#sourceFrame"),
  sourceLang: document.querySelector("#sourceLang"),
  sourceUrl: document.querySelector("#sourceUrl"),
  selectVisibleButton: document.querySelector("#selectVisibleButton"),
  selectedCount: document.querySelector("#selectedCount"),
  saveOfflineButton: document.querySelector("#saveOfflineButton"),
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
let state = loadState();
let activeCollectionId = "all";
const selectedVideoIds = new Set();

init();

function init() {
  bindEvents();
  render();
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
  els.chooseOfflineFolderButton.addEventListener("click", chooseOfflineFolder);
  els.collectionForm.addEventListener("submit", createCollection);
  els.clearSelectionButton.addEventListener("click", clearVideoSelection);
  els.clearHistoryButton.addEventListener("click", clearScrapeHistory);
  els.deleteVideoButton.addEventListener("click", deleteSelected);
  els.deleteCollectionButton.addEventListener("click", deleteActiveCollection);
  els.duplicateVideoButton.addEventListener("click", duplicateSelected);
  els.openSourceButton.addEventListener("click", openSource);
  els.openVideoButton.addEventListener("click", openVideoSource);
  els.offlinePermission.addEventListener("change", renderOfflineManager);
  els.libraryOfflinePermission.addEventListener("change", renderLibraryOfflineManager);
  els.retryPlaybackButton.addEventListener("click", renderPlayer);
  els.renameCollectionButton.addEventListener("click", renameActiveCollection);
  els.searchLibrary.addEventListener("input", () => {
    renderLibrary();
    renderCollectionManager();
  });
  els.selectVisibleButton.addEventListener("click", selectVisibleVideos);
  els.markAllOfflineButton.addEventListener("click", toggleMarkAllOffline);
  els.saveOfflineButton.addEventListener("click", saveOfflineVideo);
  els.saveSelectedOfflineButton.addEventListener("click", saveSelectedOfflineVideos);
  els.removeOfflineButton.addEventListener("click", removeOfflineVideo);
  els.moveSelectedButton.addEventListener("click", moveSelectedVideos);
  els.videoForm.addEventListener("input", updateSelectedFromForm);
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
    const added = addExtractedVideos(items, url);
    recordScrape(url, {
      status: "completed",
      foundCount: items.length,
      addedCount: added,
      method: page.method,
    });
    setStatus(
      added
        ? `Imported ${added} video ${added === 1 ? "item" : "items"} from the page.`
        : "The page loaded, but no video links were found. Paste page HTML or embed code into the extractor."
    );
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
  } catch (browserError) {
    const relayResponse = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(25000),
    });
    let relayData;
    try {
      relayData = await relayResponse.json();
    } catch {
      throw new Error(`${browserError.message} Start the app with npm start to enable the secure scan relay.`);
    }
    if (!relayResponse.ok) throw new Error(relayData.error || `The scan relay returned ${relayResponse.status}.`);
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
  const added = addExtractedVideos(items, sourceUrl);
  if (sourceUrl) {
    recordScrape(sourceUrl, {
      status: "completed",
      foundCount: items.length,
      addedCount: added,
      method: "pasted source",
    });
  }
  setStatus(
    added
      ? `Extracted ${added} video ${added === 1 ? "item" : "items"} from the pasted material.`
      : "No supported video links were found. Try pasting the page source or direct embed code."
  );
}

function extractVideos(text, baseUrl = "") {
  return core.extractVideos(text, baseUrl);
}

function addExtractedVideos(items, sourceUrl = "") {
  let added = 0;
  items.forEach((item) => {
    if (state.videos.some((video) => video.url === item.url)) return;
    addVideo({
      title: item.title,
      url: item.url,
      sourceUrl: item.sourceUrl || sourceUrl,
      language: "English",
      tags: inferTags(item.url),
    });
    added += 1;
  });
  return added;
}

function addVideo(video) {
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
}

function updateSelectedFromForm() {
  const video = selectedVideo();
  if (!video) return;
  const previousUrl = video.url;
  Object.assign(video, {
    title: els.videoTitle.value,
    speaker: els.videoSpeaker.value,
    url: els.videoUrl.value,
    sourceUrl: els.videoSource.value,
    language: els.videoLanguage.value,
    tags: els.videoTags.value,
    notes: els.videoNotes.value,
  });
  if (previousUrl !== video.url) {
    video.playbackStatus = "unchecked";
    video.playbackMessage = "URL changed; check playback again";
    video.checkedAt = "";
    if (video.offlineUrl) video.offlineStale = true;
  }
  saveState();
  renderLibrary();
  renderPlayer();
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
}

function duplicateSelected() {
  const video = selectedVideo();
  if (!video) return;
  addVideo({
    ...video,
    title: `${video.title || "Untitled video"} copy`,
  });
  setStatus("Duplicated the selected video.");
}

function deleteSelected() {
  const video = selectedVideo();
  if (!video) return;
  const shouldDelete = confirm(`Delete "${video.title || "Untitled video"}"?`);
  if (!shouldDelete) return;
  state.videos = state.videos.filter((item) => item.id !== video.id);
  selectedVideoIds.delete(video.id);
  state.selectedId = state.videos[0]?.id || null;
  saveState();
  render();
  setStatus("Deleted the selected video.");
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
  renderForm();
  renderPlayer();
  renderOfflineManager();
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
        : video.offlineUrl && !video.offlineStale
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
  const pending = marked.filter(
    (video) => canSaveOfflineUrl(video.url) && (!video.offlineUrl || video.offlineStale)
  );
  const exportable = offlineExportDirectoryHandle
    ? marked.filter((video) => video.offlineUrl && !video.offlineStale)
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
    offlineExportDirectoryHandle && pending.length === 0 ? "Copy marked to folder" : "Save marked offline";
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
    els.bulkOfflineProgressLabel.textContent = current
      ? `Video ${bulkOfflineIndex + 1} of ${bulkOfflineTotal} · ${offlineProgressLabel(current)}`
      : "Preparing downloads...";
  } else if (marked.length) {
    const saved = marked.filter((video) => video.offlineUrl && !video.offlineStale).length;
    els.bulkOfflineStatus.textContent = `${marked.length} marked · ${saved} already offline · ${pending.length} ready to save`;
  } else {
    els.bulkOfflineStatus.textContent = "Mark videos below to save them to disk.";
  }
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
  els.deleteVideoButton.disabled = !video;
  els.duplicateVideoButton.disabled = !video;
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
    setPlayerStatus("Select a saved video to begin.");
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

function renderOfflineManager() {
  const video = selectedVideo();
  const isDownloading = ["downloading", "exporting"].includes(video?.offlineDownloadStatus);
  const hasCopy = Boolean(video?.offlineUrl && !video.offlineStale);
  const canSave = canSaveOfflineUrl(video?.url);
  els.offlinePermission.disabled = !canSave || isDownloading;
  els.saveOfflineButton.disabled = !canSave || !els.offlinePermission.checked || isDownloading;
  els.saveOfflineButton.querySelector("span:last-child").textContent =
    hasCopy && offlineExportDirectoryHandle ? "Copy to folder" : "Save offline";
  els.removeOfflineButton.disabled = !video?.offlineUrl || isDownloading;
  els.offlineProgress.hidden = !isDownloading;
  renderOfflineDestination();

  if (!video) {
    els.offlineStatus.textContent = "Select a video to manage its local copy.";
    els.offlinePath.textContent = offlineStoragePath
      ? `Disk archive: ${offlineStoragePath}`
      : "Copies are stored by the Material Picker server, not in browser localStorage.";
    return;
  }

  if (isDownloading) {
    const total = Number(video.offlineTotalBytes || 0);
    const downloaded = Number(video.offlineBytesDownloaded || 0);
    const filesTotal = Number(video.offlineFilesTotal || 0);
    const filesDone = Number(video.offlineFilesDone || 0);
    if (total > 0) {
      els.offlineProgress.value = Math.min(100, (downloaded / total) * 100);
    } else if (filesTotal > 0) {
      els.offlineProgress.value = Math.min(100, (filesDone / filesTotal) * 100);
    } else {
      els.offlineProgress.removeAttribute("value");
    }
    els.offlineStatus.textContent = `${video.offlineDownloadStatus === "exporting" ? "Copying to chosen folder" : "Saving"} · ${offlineProgressLabel(video)}`;
  } else if (hasCopy) {
    els.offlineProgress.value = 100;
    els.offlineStatus.textContent = `Saved on disk · ${formatBytes(video.offlineSize)} · ${video.offlineFormat === "hls" ? "local HLS" : "video file"}`;
  } else if (video.offlineStale) {
    els.offlineStatus.textContent = "The video URL changed. Remove the old copy or save the updated video again.";
  } else if (video.offlineDownloadStatus === "failed") {
    els.offlineStatus.textContent = `Offline save failed: ${video.offlineError || "Unknown error"}`;
  } else if (!canSave) {
    els.offlineStatus.textContent = "This provider does not expose a downloadable file or public unencrypted HLS source.";
  } else {
    els.offlineStatus.textContent = "No disk copy yet. Confirm permission, then choose Save offline.";
  }

  const archiveId = video.offlineCopyId || video.id;
  const relativePath = video.offlineUrl ? `data/videos/${archiveId}` : "";
  els.offlinePath.textContent = relativePath
    ? `Stored at ${offlineStoragePath ? `${offlineStoragePath}/${archiveId}` : relativePath}`
    : offlineStoragePath
      ? `Disk archive: ${offlineStoragePath}`
      : "Copies are stored in data/videos on the computer running Material Picker.";
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
    renderOfflineManager();
  } catch (error) {
    els.offlineStatus.textContent = `Offline storage is unavailable: ${error.message}`;
    els.saveOfflineButton.disabled = true;
  }
}

async function saveOfflineVideo() {
  const video = selectedVideo();
  if (!video?.url || !els.offlinePermission.checked) return;
  setStatus(`Saving “${video.title || "Untitled video"}” to disk...`);
  try {
    await saveOrExportOfflineVideo(video);
    els.offlinePermission.checked = false;
    renderOfflineManager();
  } catch (error) {
    markOfflineFailure(video, error);
    setStatus(`Offline save failed: ${error.message}`);
  }
}

async function saveSelectedOfflineVideos() {
  const videos = state.videos.filter(
    (video) => selectedVideoIds.has(video.id) && canSaveOfflineUrl(video.url) &&
      ((!video.offlineUrl || video.offlineStale) || Boolean(offlineExportDirectoryHandle))
  );
  if (!videos.length || !els.libraryOfflinePermission.checked || bulkOfflineRunning) return;
  bulkOfflineRunning = true;
  bulkOfflineTotal = videos.length;
  bulkOfflineIndex = 0;
  bulkOfflineCurrentId = videos[0]?.id || "";
  const failures = [];
  renderLibraryOfflineManager();

  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    bulkOfflineIndex = index;
    bulkOfflineCurrentId = video.id;
    bulkOfflineMessage = `Saving ${index + 1} of ${videos.length}: ${video.title || "Untitled video"}`;
    renderLibraryOfflineManager();
    try {
      await saveOrExportOfflineVideo(video);
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

async function chooseOfflineFolder() {
  if (!("showDirectoryPicker" in window)) {
    setStatus("Folder selection is not available in this browser. Offline copies will stay in Material Picker storage.");
    renderOfflineDestination();
    return;
  }
  try {
    offlineExportDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite", startIn: "videos" });
    setStatus(`New offline copies will also be saved in “${offlineExportDirectoryHandle.name}”.`);
    renderOfflineDestination();
    renderLibraryOfflineManager();
    renderOfflineManager();
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`The download folder could not be opened: ${error.message}`);
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
      ? "Material Picker storage (choose another folder if needed)"
      : "Material Picker storage (folder selection unavailable in this browser)";
  els.libraryDestinationStatus.textContent = label;
  els.offlineDestinationStatus.textContent = label;
  const buttonLabel = offlineExportDirectoryHandle ? "Change folder" : "Choose folder";
  els.chooseLibraryFolderButton.textContent = buttonLabel;
  els.chooseOfflineFolderButton.textContent = buttonLabel;
  els.chooseLibraryFolderButton.disabled = !supported || bulkOfflineRunning || operationRunning;
  els.chooseOfflineFolderButton.disabled = !supported || bulkOfflineRunning || operationRunning;
}

async function saveOrExportOfflineVideo(video) {
  if (!video.offlineUrl || video.offlineStale) await startOfflineDownload(video);
  if (offlineExportDirectoryHandle) await exportOfflineCopy(video);
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
  renderOfflineManager();

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
          if (state.selectedId === video.id) renderOfflineManager();
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
  if (state.selectedId === video.id) renderOfflineManager();
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
  renderOfflineManager();
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
  const job = await response.json();
  if (!response.ok) throw new Error(job.error || `Offline save returned ${response.status}.`);
  await pollOfflineJob(video.id);
}

function markOfflineFailure(video, error) {
  video.offlineDownloadStatus = "failed";
  video.offlineError = error.message;
  saveState();
  renderLibrary();
  renderLibraryOfflineManager();
  if (state.selectedId === video.id) renderOfflineManager();
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
      renderOfflineManager();
      setStatus(`Saved “${video.title || "Untitled video"}” to disk for offline playback.`);
      return;
    }
    if (job.status === "failed") throw new Error(job.error || "The download failed.");
    saveState();
    renderLibrary();
    renderLibraryOfflineManager();
    if (state.selectedId === videoId) renderOfflineManager();
  }
}

async function removeOfflineVideo() {
  const video = selectedVideo();
  if (!video?.offlineUrl) return;
  if (!confirm(`Remove the disk copy of “${video.title || "Untitled video"}”? The library record and transcript will remain.`)) return;
  try {
    const copyId = video.offlineCopyId || video.id;
    const response = await fetch(`/api/offline/${encodeURIComponent(copyId)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Remove request returned ${response.status}.`);
    [
      "offlineUrl",
      "offlineCopyId",
      "offlineSize",
      "offlineSavedAt",
      "offlineFormat",
      "offlineProvider",
      "offlineStale",
      "offlineDownloadStatus",
      "offlineBytesDownloaded",
      "offlineTotalBytes",
      "offlineSpeedBytesPerSecond",
      "offlineEtaSeconds",
      "offlineStartedAt",
      "offlineFilesDone",
      "offlineFilesTotal",
    ].forEach((key) => delete video[key]);
    saveState();
    renderLibrary();
    renderPlayer();
    renderOfflineManager();
    setStatus("The offline disk copy was removed. The video record and transcript were kept.");
  } catch (error) {
    setStatus(`The offline copy could not be removed: ${error.message}`);
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
      const added = addExtractedVideos(items, sourceUrl);
      state.videos = state.videos.filter((video) => video.id !== record.id);
      completedSources.add(sourceKey);
      repaired += 1;
      recordScrape(sourceUrl, {
        status: "completed",
        foundCount: items.length,
        addedCount: added,
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

function setupAudioTrackCapture() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  if (!mediaElementSource) {
    mediaElementSource = audioContext.createMediaElementSource(els.videoPlayer);
    mediaElementSource.connect(audioContext.destination);
  }

  return { audioContext, mediaElementSource };
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

  startAudioTrackTranscription(video);
}

function startAudioTrackTranscription(video) {
  const setup = setupAudioTrackCapture();
  if (!setup) {
    setTranscriptButtons(false);
    setTranscriptStatus("Web Audio API is not supported in this browser.", "error");
    setStatus("Audio track transcription could not start.");
    return;
  }

  stopTranscription();

  audioTrackTranscribing = true;
  accumulatedSamples = [];
  accumulatedLength = 0;
  isTranscribingChunk = false;
  lastChunkTime = els.videoPlayer.currentTime || 0;

  audioProcessor = setup.audioContext.createScriptProcessor(4096, 1, 1);
  setup.mediaElementSource.connect(audioProcessor);
  audioProcessor.connect(setup.audioContext.destination);

  audioProcessor.onaudioprocess = (event) => {
    if (!audioTrackTranscribing || els.videoPlayer.paused) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(inputData, setup.audioContext.sampleRate);
    accumulatedSamples.push(downsampled);
    accumulatedLength += downsampled.length;

    if (accumulatedLength >= 56000 && !isTranscribingChunk) {
      processPendingAudioChunk(false);
    }
  };

  const onEnded = () => {
    processPendingAudioChunk(true);
    stopTranscription();
  };

  els.videoPlayer.addEventListener("ended", onEnded, { once: true });

  setTranscriptButtons(true);
  const currentTime = formatTime(els.videoPlayer.currentTime || 0);
  setTranscriptStatus(`Transcribing directly from video audio track [${currentTime}]...`, "working");
  setStatus("Transcribing from the video audio track. The video is playing.");
}

async function processPendingAudioChunk(isFinal = false) {
  if (accumulatedLength === 0) return;

  const merged = new Float32Array(accumulatedLength);
  let offset = 0;
  for (const chunk of accumulatedSamples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  accumulatedSamples = [];
  accumulatedLength = 0;

  const chunkStartTime = lastChunkTime;
  const chunkEndTime = els.videoPlayer.currentTime || (chunkStartTime + (merged.length / 16000));
  lastChunkTime = chunkEndTime;

  let sumSquares = 0;
  for (let i = 0; i < merged.length; i++) {
    sumSquares += merged[i] * merged[i];
  }
  const rms = Math.sqrt(sumSquares / merged.length);
  if (rms < 0.005) return;

  const pcmBase64 = floatTo16BitPCMBase64(merged);
  isTranscribingChunk = true;

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcmBase64,
        language: els.sourceLang.value,
        currentTime: chunkStartTime,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (response.ok && data.text) {
      const timeStr = formatTime(chunkStartTime);
      const newText = `[${timeStr}] ${data.text}`;
      els.transcriptText.value = els.transcriptText.value.trim()
        ? `${els.transcriptText.value.trim()}\n${newText}`
        : newText;
      updateTranscriptFields();

      const video = selectedVideo();
      if (video) {
        video.transcript = els.transcriptText.value;
        saveState();
      }
      setTranscriptStatus(`Transcribing from audio track [${formatTime(chunkEndTime)}]...`, "working");
    }
  } catch (error) {
    console.error("Transcription chunk error:", error);
  } finally {
    isTranscribingChunk = false;
  }
}

function stopTranscription() {
  audioTrackTranscribing = false;
  if (audioProcessor) {
    try {
      audioProcessor.disconnect();
    } catch {}
    audioProcessor = null;
  }
  if (accumulatedLength > 16000) {
    processPendingAudioChunk(true);
  }
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  setTranscriptButtons(false);
  if (els.transcriptText.value.trim()) {
    setTranscriptStatus("Audio track transcript saved for this video.", "ready");
  } else {
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
