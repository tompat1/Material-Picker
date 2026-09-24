const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const core = require("../public/app-core.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "summit-day-2.html"), "utf8");
const summitUrl = "https://summitsforimpact.com/embodiment-summit/day-2/?playlist=78cefb8c&video=bd9fdf3";

test("extracts all 10 videos and their titles from the summit playlist", () => {
  const videos = core.extractVideos(fixture, summitUrl);

  assert.equal(videos.length, 10);
  assert.equal(videos[0].title, "Awareness and Love in Uncertain Times\u200b - Jack Kornfield");
  assert.equal(videos[3].title, "Panel: Meditation, Mindfulness, & Leadership");
  assert.equal(videos[9].url, "https://vimeo.com/471425414?share=copy");
  assert.ok(videos.every((video) => video.sourceUrl === summitUrl));
});

test("turns every summit Vimeo URL into a built-in player embed", () => {
  const videos = core.extractVideos(fixture, summitUrl);
  const playback = videos.map((video) => core.playbackKind(video.url));

  assert.ok(playback.every((item) => item.kind === "embed"));
  assert.deepEqual(
    playback.map((item) => item.embedUrl),
    [
      "https://player.vimeo.com/video/471301104",
      "https://player.vimeo.com/video/477105125",
      "https://player.vimeo.com/video/472609721",
      "https://player.vimeo.com/video/469518844",
      "https://player.vimeo.com/video/471426531",
      "https://player.vimeo.com/video/469218249",
      "https://player.vimeo.com/video/470052596",
      "https://player.vimeo.com/video/469525205",
      "https://player.vimeo.com/video/471739110",
      "https://player.vimeo.com/video/471425414",
    ]
  );
});

test("round-trips all videos through browser-style storage", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) || null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
  const videos = core.extractVideos(fixture, summitUrl).map((video, index) => ({ id: String(index), ...video }));
  const state = {
    selectedId: "0",
    videos,
    collections: [{ id: "folder-1", name: "Day 2", createdAt: "2026-09-23T00:00:00.000Z" }],
    scrapeHistory: [
      {
        id: "scan-1",
        url: summitUrl,
        scrapedAt: "2026-09-23T00:00:00.000Z",
        status: "completed",
        foundCount: 10,
        addedCount: 10,
      },
    ],
  };

  core.saveState(storage, "test-library", state);
  assert.deepEqual(core.loadState(storage, "test-library"), state);
  assert.equal(core.loadState(storage, "test-library").videos.length, 10);
  assert.equal(core.loadState(storage, "test-library").collections[0].name, "Day 2");
  assert.equal(core.loadState(storage, "test-library").scrapeHistory[0].foundCount, 10);
});

test("migrates an older saved library with an empty scrape history", () => {
  const storage = {
    getItem: () => JSON.stringify({ selectedId: null, videos: [] }),
    removeItem: () => {},
    setItem: () => {},
  };

  assert.deepEqual(core.loadState(storage, "old-library").scrapeHistory, []);
  assert.deepEqual(core.loadState(storage, "old-library").collections, []);
});

test("extracts direct, relative, YouTube, and Vimeo video URLs without duplicates", () => {
  const html = `
    <video src="/media/talk.mp4"></video>
    <a href="/media/talk.mp4">Duplicate</a>
    <iframe src="https://www.youtube.com/watch?v=abc123"></iframe>
    <div data-video-url="https://vimeo.com/123456" data-video-title="A named talk"></div>
  `;
  const videos = core.extractVideos(html, "https://example.com/events/day-1/");

  assert.equal(videos.length, 3);
  assert.equal(videos[0].url, "https://example.com/media/talk.mp4");
  assert.equal(videos[2].title, "A named talk");
});

test("rejects ordinary page and image URLs as player material", () => {
  assert.equal(core.isLikelyVideoUrl("https://example.com/about"), false);
  assert.equal(core.isLikelyVideoUrl("https://example.com/photo.jpg"), false);
  assert.equal(core.playbackKind("https://example.com/about").kind, "unsupported");
  assert.equal(core.playbackKind(`${summitUrl}&video=legacy-query-value`).kind, "unsupported");
});

test("moves selected videos into a collection and back to Unfiled", () => {
  const videos = [
    { id: "a", collectionId: "" },
    { id: "b", collectionId: "" },
    { id: "c", collectionId: "other" },
  ];

  assert.equal(core.moveVideosToCollection(videos, new Set(["a", "b"]), "day-2"), 2);
  assert.deepEqual(videos.map((video) => video.collectionId), ["day-2", "day-2", "other"]);
  assert.equal(core.moveVideosToCollection(videos, ["b"], ""), 1);
  assert.equal(videos[1].collectionId, "");
});

test("removing a collection keeps its videos and returns them to Unfiled", () => {
  const videos = [
    { id: "a", collectionId: "day-2" },
    { id: "b", collectionId: "day-2" },
    { id: "c", collectionId: "other" },
  ];
  const collections = [
    { id: "day-2", name: "Day 2" },
    { id: "other", name: "Other" },
  ];

  const result = core.removeCollection(collections, videos, "day-2");
  assert.equal(result.unfiledCount, 2);
  assert.deepEqual(result.collections, [{ id: "other", name: "Other" }]);
  assert.deepEqual(videos.map((video) => video.collectionId), ["", "", "other"]);
});

test("formats download throughput and hour/minute estimates for the library", () => {
  assert.equal(core.formatBytes(6.25 * 1024 * 1024), "6.3 MB");
  assert.equal(core.formatDuration(45), "1 min");
  assert.equal(core.formatDuration(84 * 60), "1h 24m");
  assert.equal(core.formatDuration(2 * 60 * 60), "2h");
});

test("sums library run time and file size from known videos", () => {
  const summary = core.libraryMediaSummary([
    { durationSeconds: 600, estimatedBytes: 1000 },
    { durationSeconds: 90, offlineSize: 500, estimatedBytes: 900 },
    { title: "Unknown" },
  ]);
  assert.equal(summary.durationSeconds, 690);
  assert.equal(summary.bytes, 1500);
});

test("estimates remaining download time from completed work", () => {
  assert.equal(core.estimateRemainingSeconds(0.2, 100, 1000), null);
  assert.equal(core.estimateRemainingSeconds(10, 0, 1000), null);
  assert.equal(core.estimateRemainingSeconds(10, 250, 1000), 30);
  assert.equal(core.estimateRemainingSeconds(10, 1000, 1000), null);
});

test("creates portable destination folder names for offline archives", () => {
  assert.equal(core.archiveFolderName('A talk: body / mind?', "video_123-abc"), "A talk body mind - video_12");
  assert.equal(core.archiveFolderName("...", "../"), "Offline video - video");
  assert.equal(
    core.archiveFolderName('Dehumanizing is So Human: Practical Tools to Heal Trauma and Anxiety\u200b\u200b - Paul Linden', '471426345'),
    "Dehumanizing is So Human Practical Tools to Heal Trauma and Anxiety - Pa - 47142634"
  );
});

test("follows a split HLS master to its audio segments", () => {
  const masterUrl = "http://127.0.0.1:4173/local-media/dir/master.m3u8";
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="Original",DEFAULT=YES,URI="audio/playlist.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-high"',
    "video/playlist.m3u8",
  ].join("\n");
  const parsedMaster = core.parseHlsPlaylist(master, masterUrl);
  assert.equal(parsedMaster.audioPlaylistUrl, "http://127.0.0.1:4173/local-media/dir/audio/playlist.m3u8");
  assert.equal(parsedMaster.segments.length, 0);

  const media = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="segments/00000.mp4"',
    "#EXTINF:6.080000,",
    "segments/00001.m4s",
    "#EXTINF:6.080000,",
    "segments/00002.m4s",
  ].join("\n");
  const parsedMedia = core.parseHlsPlaylist(media, parsedMaster.audioPlaylistUrl);
  assert.equal(parsedMedia.initUrl, "http://127.0.0.1:4173/local-media/dir/audio/segments/00000.mp4");
  assert.equal(parsedMedia.segments.length, 2);
  assert.equal(parsedMedia.segments[0].url, "http://127.0.0.1:4173/local-media/dir/audio/segments/00001.m4s");
  assert.equal(parsedMedia.segments[1].start, 6.08);
});

test("recognizes common video container extensions including mkv, avi, and ts", () => {
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.mkv"), true);
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.avi"), true);
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.flv"), true);
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.wmv"), true);
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.ts"), true);
  assert.equal(core.isLikelyVideoUrl("file:///videos/clip.mp4"), true);
  assert.equal(core.isLikelyVideoUrl("file:///docs/readme.txt"), false);
});

test("parses offline archive requirements and verifies integrity", async () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="Original",DEFAULT=YES,URI="audio/playlist.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio-high"',
    "video/playlist.m3u8",
  ].join("\n");
  const videoMedia = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="segments/00000.mp4"',
    "#EXTINF:6,",
    "segments/00001.m4s",
  ].join("\n");
  const audioMedia = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="segments/00000.mp4"',
    "#EXTINF:6,",
    "segments/00001.m4s",
  ].join("\n");

  const reqs = core.parseOfflineArchiveRequirements(master, {
    "video/playlist.m3u8": videoMedia,
    "audio/playlist.m3u8": audioMedia,
  });

  assert.equal(reqs.format, "hls");
  assert.deepEqual(reqs.playlists, ["master.m3u8", "video/playlist.m3u8", "audio/playlist.m3u8"]);
  assert.deepEqual(reqs.videoSegments, ["video/segments/00000.mp4", "video/segments/00001.m4s"]);
  assert.deepEqual(reqs.audioSegments, ["audio/segments/00000.mp4", "audio/segments/00001.m4s"]);

  // Test healthy verification
  const validFtyp = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]); // "ftyp"
  const filesMap = new Map([
    ["master.m3u8", { size: master.length }],
    ["video/playlist.m3u8", { size: videoMedia.length }],
    ["audio/playlist.m3u8", { size: audioMedia.length }],
    ["video/segments/00000.mp4", { size: 1000, sample: validFtyp }],
    ["video/segments/00001.m4s", { size: 2000, sample: validFtyp }],
    ["audio/segments/00000.mp4", { size: 800, sample: validFtyp }],
    ["audio/segments/00001.m4s", { size: 1500, sample: validFtyp }],
  ]);

  const healthyResult = await core.verifyArchive(reqs, async (path, opts) => {
    const item = filesMap.get(path);
    if (!item) return { exists: false, size: 0, sample: null };
    return { exists: true, size: item.size, sample: opts?.sampleBytes ? item.sample : null };
  });

  assert.equal(healthyResult.healthy, true);
  assert.equal(healthyResult.playable, true);
  assert.equal(healthyResult.videoSegments.found, 2);
  assert.equal(healthyResult.audioSegments.found, 2);
  assert.equal(healthyResult.missingFiles.length, 0);

  // Test missing audio segment
  filesMap.delete("audio/segments/00001.m4s");
  const missingResult = await core.verifyArchive(reqs, async (path, opts) => {
    const item = filesMap.get(path);
    if (!item) return { exists: false, size: 0, sample: null };
    return { exists: true, size: item.size, sample: opts?.sampleBytes ? item.sample : null };
  });

  assert.equal(missingResult.healthy, false);
  assert.equal(missingResult.missingFiles.includes("audio/segments/00001.m4s"), true);
  assert.equal(missingResult.audioSegments.found, 1);
});

test("proofreadText removes timestamps and deduplicates consecutive speakers", () => {
  const input = `[00:00:05] Host Tana Saler: Welcome back, um we are glad you are here.
[00:00:10] Host Tana Saler: In today's session we talk about somatic practice.
[00:00:15] Mark Walsh: Thank you Tana, it is like a real pleasure.
[00:00:22] Mark Walsh: Let's start with a grounding breath.
[00:00:30] Host Tana Saler: Beautiful.`;

  const output = core.proofreadText(input, "en");
  assert.equal(
    output,
    "Host Tana Saler: Welcome back, we are glad you are here.\nIn today's session we talk about somatic practice.\nMark Walsh: Thank you Tana, it is a real pleasure.\nLet's start with a grounding breath.\nHost Tana Saler: Beautiful."
  );

  const keptTimestamps = core.proofreadText(input, "en", { removeTimestamps: false, deduplicateSpeakers: true });
  assert.ok(keptTimestamps.includes("[00:00:05] Host Tana Saler:"));
  assert.ok(keptTimestamps.includes("[00:00:10] In today's session"));
});

test("groupFolderEntries correctly groups HLS packages with master.m3u8, audio/video segments, and metadata", () => {
  const entries = [
    { name: "master.m3u8", relPath: "talk/master.m3u8" },
    { name: "metadata.json", relPath: "talk/metadata.json" },
    { name: "playlist.m3u8", relPath: "talk/audio/playlist.m3u8" },
    { name: "00000.mp4", relPath: "talk/audio/segments/00000.mp4" },
    { name: "00001.m4s", relPath: "talk/audio/segments/00001.m4s" },
    { name: "playlist.m3u8", relPath: "talk/video/playlist.m3u8" },
    { name: "00000.mp4", relPath: "talk/video/segments/00000.mp4" },
    { name: "00001.m4s", relPath: "talk/video/segments/00001.m4s" },
    { name: "independent-video.mp4", relPath: "independent-video.mp4" },
  ];

  const { hlsPackages, standaloneEntries } = core.groupFolderEntries(entries);

  assert.equal(hlsPackages.length, 1);
  const pkg = hlsPackages[0];
  assert.equal(pkg.rootPrefix, "talk");
  assert.equal(pkg.manifestName, "master.m3u8");
  assert.ok(pkg.metadataEntry);
  assert.equal(pkg.metadataEntry.name, "metadata.json");
  assert.equal(pkg.entries.length, 8);

  // Standalone entries should only contain independent-video.mp4, not 00000.mp4 or internal playlist.m3u8!
  assert.equal(standaloneEntries.length, 1);
  assert.equal(standaloneEntries[0].name, "independent-video.mp4");
});


