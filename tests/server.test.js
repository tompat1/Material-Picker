const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertUnencryptedHls,
  downloadMetrics,
  extractPlayerConfig,
  isPublicIp,
  listArchiveFiles,
  parseHlsAttributes,
  parseVtt,
  sanitizeOfflineMaster,
  safeVideoId,
  selectHlsVariant,
  splitTranslationText,
  transcriptFromCues,
} = require("../server.js");

test("scrape relay rejects private and loopback IP ranges", () => {
  ["127.0.0.1", "10.0.0.4", "172.16.2.1", "192.168.1.20", "169.254.2.3", "::1", "fd00::1"].forEach(
    (address) => assert.equal(isPublicIp(address), false, address)
  );
});

test("scrape relay accepts public IPv4 and IPv6 addresses", () => {
  ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"].forEach((address) =>
    assert.equal(isPublicIp(address), true, address)
  );
});

test("parses Vimeo WebVTT captions into a timed transcript", () => {
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello &amp; welcome.\n\n2\n00:00:04.250 --> 00:00:06.000\n<v Speaker>This is a test.</v>`;
  const cues = parseVtt(vtt);

  assert.deepEqual(cues, [
    { start: "00:00:01.000", text: "Hello & welcome." },
    { start: "00:00:04.250", text: "This is a test." },
  ]);
  assert.equal(transcriptFromCues(cues), "[00:00:01] Hello & welcome.\n[00:00:04] This is a test.");
});

test("splits long translations without losing content", () => {
  const text = `${"A".repeat(20)}\n${"B".repeat(20)}`;
  const chunks = splitTranslationText(text, 24);

  assert.ok(chunks.every((chunk) => chunk.length <= 24));
  assert.equal(chunks.join(""), text);
});

test("extracts Vimeo player config without requiring a trailing semicolon", () => {
  const config = extractPlayerConfig(
    '<html><script>window.playerConfig = {"request":{"text_tracks":[{"lang":"en"}]}}</script></html>'
  );
  assert.equal(config.request.text_tracks[0].lang, "en");
});

test("selects the best HLS variant at or below 1080p", () => {
  const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
low/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="audio-a"
high/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160
ultra/playlist.m3u8`;
  const selected = selectHlsVariant(manifest);

  assert.equal(selected.uri, "high/playlist.m3u8");
  assert.equal(selected.height, 1080);
  assert.equal(selected.attributes.AUDIO, "audio-a");
  assert.equal(parseHlsAttributes('TYPE=AUDIO,GROUP-ID="audio-a",DEFAULT=YES').DEFAULT, "YES");
});

test("refuses encrypted HLS instead of attempting to bypass it", () => {
  assert.throws(
    () => assertUnencryptedHls("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"secret.key\""),
    /encrypted or DRM-protected/
  );
  assert.doesNotThrow(() => assertUnencryptedHls("#EXTM3U\n#EXT-X-KEY:METHOD=NONE"));
});

test("removes uncached subtitle groups from offline HLS masters", () => {
  const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-a",URI="audio/playlist.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-a",SUBTITLES="subs",CLOSED-CAPTIONS="cc"
video/playlist.m3u8`;
  const sanitized = sanitizeOfflineMaster(manifest);

  assert.match(sanitized, /AUDIO="audio-a"/);
  assert.match(sanitized, /CODECS="avc1\.640028,mp4a\.40\.2"/);
  assert.doesNotMatch(sanitized, /SUBTITLES|CLOSED-CAPTIONS/);
  assert.match(sanitized, /video\/playlist\.m3u8/);
});

test("accepts only filesystem-safe video IDs", () => {
  assert.equal(safeVideoId("video_123-abc"), "video_123-abc");
  assert.throws(() => safeVideoId("../outside"), /invalid/);
  assert.throws(() => safeVideoId("folder/video"), /invalid/);
});

test("reports download speed and ETA for exact-size and segmented downloads", () => {
  const now = Date.parse("2026-09-23T10:10:00.000Z");
  const exact = downloadMetrics({
    startedAt: "2026-09-23T10:00:00.000Z",
    status: "downloading",
    bytesDownloaded: 600 * 1024 * 1024,
    totalBytes: 1200 * 1024 * 1024,
  }, now);
  assert.equal(exact.downloadSpeedBytesPerSecond, 1024 * 1024);
  assert.equal(exact.etaSeconds, 600);

  const segmented = downloadMetrics({
    startedAt: "2026-09-23T10:05:00.000Z",
    status: "downloading",
    bytesDownloaded: 300 * 1024 * 1024,
    filesDone: 25,
    filesTotal: 100,
  }, now);
  assert.equal(segmented.downloadSpeedBytesPerSecond, 1024 * 1024);
  assert.equal(segmented.etaSeconds, 900);
});

test("lists a complete offline archive without following symbolic links", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "material-picker-archive-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "video"));
  fs.writeFileSync(path.join(directory, "master.m3u8"), "#EXTM3U\n");
  fs.writeFileSync(path.join(directory, ".DS_Store"), "metadata");
  fs.writeFileSync(path.join(directory, "video", "segment-0.ts"), "segment");
  fs.symlinkSync(path.join(directory, "master.m3u8"), path.join(directory, "ignored-link"));

  assert.deepEqual(await listArchiveFiles(directory), [
    { path: "master.m3u8", size: 8 },
    { path: "video/segment-0.ts", size: 7 },
  ]);
});
