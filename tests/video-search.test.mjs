import assert from "node:assert/strict";
import test from "node:test";
import { searchVideos, videosFromDuckDuckGo, youtubeFromPayload } from "../video-search.mjs";

test("youtube search keeps playable videos and skips duplicates", () => {
  const results = youtubeFromPayload({
    contents: [
      { videoRenderer: { videoId: "abcdefghijk", title: { runs: [{ text: "Clay for beginners" }] }, ownerText: { runs: [{ text: "Studio North" }] }, lengthText: { simpleText: "12:04" } } },
      { videoRenderer: { videoId: "abcdefghijk", title: { simpleText: "Duplicate" } } },
      { videoRenderer: { videoId: "short", title: { simpleText: "Nope" } } },
    ],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Clay for beginners");
  assert.equal(results[0].speaker, "Studio North");
  assert.equal(results[0].duration, "12:04");
  assert.equal(results[0].url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(results[0].source, "youtube");
});

test("web and vimeo results keep direct video pages", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvimeo.com%2F173544356&amp;rut=abc">Jade Ceramics from Ada Clay on Vimeo</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fplayer.vimeo.com%2Fvideo%2F173544356&amp;rut=abc">Same film</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvimeo.com%2Fshowcase%2F1762689&amp;rut=abc">A showcase</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabcdefghijk&amp;rut=abc">A YouTube lesson</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Dudemy.com&amp;rut=abc">Ad</a>
  `;
  const vimeo = videosFromDuckDuckGo(html, "vimeo");
  assert.deepEqual(vimeo.map((item) => item.url), ["https://vimeo.com/173544356"]);
  assert.equal(vimeo[0].title, "Jade Ceramics");
  assert.equal(vimeo[0].speaker, "Ada Clay");
  const web = videosFromDuckDuckGo(html, "web");
  assert.equal(web.length, 2);
  assert.equal(web[1].source, "youtube");
});

test("search rejects a blank topic before calling the network", async () => {
  await assert.rejects(() => searchVideos(" ", "youtube", async () => {
    throw new Error("should not fetch");
  }), /topic/);
});
