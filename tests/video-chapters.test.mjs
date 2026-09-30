import assert from "node:assert/strict";
import test from "node:test";
import {
  chaptersFromVtt,
  fetchVideoChapters,
  formatChapterClock,
  parseChapterClock,
  youtubeChaptersFromWatchHtml,
} from "../video-chapters.mjs";

test("chapter clocks round-trip common provider formats", () => {
  assert.equal(parseChapterClock("1:36"), 96);
  assert.equal(parseChapterClock("1:02:03"), 3723);
  assert.equal(formatChapterClock(96), "1:36");
  assert.equal(formatChapterClock(3723), "1:02:03");
});

test("youtube watch pages expose macro marker chapters", () => {
  const html = `
    <html>
      <script>
        var data = {"macroMarkersListItemRenderer":{"title":{"simpleText":"Intro"},"timeDescription":{"simpleText":"0:00"}}};
        data = {"macroMarkersListItemRenderer":{"title":{"simpleText":"Deep dive"},"timeDescription":{"simpleText":"12:04"}}};
      </script>
    </html>
  `;
  const chapters = youtubeChaptersFromWatchHtml(html);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "Intro");
  assert.equal(chapters[0].startSeconds, 0);
  assert.equal(chapters[1].title, "Deep dive");
  assert.equal(chapters[1].time, "12:04");
});

test("vimeo chapter tracks are parsed from WebVTT cues", () => {
  const chapters = chaptersFromVtt(`WEBVTT

00:00:00.000 --> 00:00:45.000
Opening

00:01:10.000 --> 00:02:05.000
Main talk
`);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "Opening");
  assert.equal(chapters[1].startSeconds, 70);
});

test("chapters API loads YouTube chapters from the watch page", async () => {
  const watchHtml = `<html>macroMarkersListItemRenderer":{"title":{"simpleText":"Start"},"timeDescription":{"simpleText":"0:00"}}</html>`;
  const result = await fetchVideoChapters("https://www.youtube.com/watch?v=abcdefghijk", async (url) => {
    assert.match(url, /watch\?v=abcdefghijk/);
    return new Response(watchHtml, { status: 200, headers: { "content-type": "text/html" } });
  });
  assert.equal(result.source, "youtube");
  assert.equal(result.chapters[0].title, "Start");
});

test("chapters API loads Vimeo chapter tracks", async () => {
  const playerHtml = `<html><script>window.playerConfig = {
    "request": {
      "text_tracks": [
        { "kind": "chapters", "label": "Chapters", "url": "https://captions.example/chapters.vtt" }
      ]
    }
  };</script></html>`;
  const vtt = `WEBVTT

00:00:30.000 --> 00:01:00.000
Chapter one
`;
  const result = await fetchVideoChapters("https://vimeo.com/471161461", async (url) => {
    if (String(url).includes("player.vimeo.com")) {
      return new Response(playerHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (String(url).includes("chapters.vtt")) {
      return new Response(vtt, { status: 200, headers: { "content-type": "text/vtt" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  assert.equal(result.source, "vimeo");
  assert.equal(result.chapters[0].title, "Chapter one");
  assert.equal(result.chapters[0].startSeconds, 30);
});
