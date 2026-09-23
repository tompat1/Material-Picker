const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const core = require("../app-core.js");

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
