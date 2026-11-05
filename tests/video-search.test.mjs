import assert from "node:assert/strict";
import test from "node:test";
import { searchVideos, videoFeed, videosFromDuckDuckGo, vimeoFromChannel, youtubeFromPayload } from "../video-search.mjs";

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

test("youtube topic search follows continuations and returns more than twelve unique videos", async () => {
  const video = (index) => ({
    videoRenderer: {
      videoId: `v${String(index).padStart(10, "0")}`,
      title: { simpleText: `AI video ${index}` },
      ownerText: { simpleText: "AI Channel" },
    },
  });
  let requests = 0;

  const results = await searchVideos("AI", "youtube", async (_url, options) => {
    requests++;
    const body = JSON.parse(options.body);
    if (requests === 1) {
      assert.equal(body.query, "AI");
      assert.equal(body.continuation, undefined);
      return new Response(JSON.stringify({
        contents: [
          ...Array.from({ length: 20 }, (_, index) => video(index)),
          {
            continuationItemRenderer: {
              trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
              continuationEndpoint: { continuationCommand: { token: "next-page" } },
            },
          },
        ],
      }));
    }

    assert.equal(body.query, undefined);
    assert.equal(body.continuation, "next-page");
    return new Response(JSON.stringify({
      onResponseReceivedCommands: [{
        appendContinuationItemsAction: {
          continuationItems: [video(0), ...Array.from({ length: 20 }, (_, index) => video(index + 20))],
        },
      }],
    }));
  });

  assert.equal(requests, 2);
  assert.equal(results.length, 36);
  assert.equal(new Set(results.map((item) => item.url)).size, 36);
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

test("vimeo staff picks keep the film page and runtime", () => {
  const results = vimeoFromChannel([
    { id: 173544356, title: "Jade", user_name: "Ada Clay", duration: 125, thumbnail_large: "https://i.vimeocdn.com/jade.jpg" },
    { id: "nope", title: "Skip" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://vimeo.com/173544356");
  assert.equal(results[0].speaker, "Ada Clay");
  assert.equal(results[0].duration, "2:05");
  assert.equal(results[0].thumbnail, "https://i.vimeocdn.com/jade.jpg");
  assert.equal(results[0].source, "vimeo");
});

test("popular feed asks YouTube for this week's most watched videos", async () => {
  const results = await videoFeed("youtube-popular", async (url, options) => {
    assert.match(url, /youtubei\/v1\/search/);
    const body = JSON.parse(options.body);
    assert.equal(body.params, "CAMSAggD");
    assert.equal(body.query, "a");
    return new Response(JSON.stringify({
      contents: [{ videoRenderer: { videoId: "abcdefghijk", title: { simpleText: "A popular film" }, ownerText: { simpleText: "Studio" }, lengthText: { simpleText: "4:01" } } }],
    }));
  });
  assert.equal(results[0].title, "A popular film");
  assert.equal(results[0].source, "youtube");
});

test("compact YouTube feeds remain capped at twelve videos", async () => {
  let requests = 0;
  const results = await videoFeed("youtube-latest", async () => {
    requests++;
    return new Response(JSON.stringify({
      contents: [
        ...Array.from({ length: 20 }, (_, index) => ({
          videoRenderer: {
            videoId: `f${String(index).padStart(10, "0")}`,
            title: { simpleText: `Latest video ${index}` },
          },
        })),
        {
          continuationItemRenderer: {
            trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
            continuationEndpoint: { continuationCommand: { token: "unused-feed-page" } },
          },
        },
      ],
    }));
  });

  assert.equal(requests, 1);
  assert.equal(results.length, 12);
});

test("unknown feeds are rejected before the network", async () => {
  await assert.rejects(() => videoFeed("nope", async () => {
    throw new Error("should not fetch");
  }), /Unknown feed/);
});

test("search rejects a blank topic before calling the network", async () => {
  await assert.rejects(() => searchVideos(" ", "youtube", async () => {
    throw new Error("should not fetch");
  }), /topic/);
});
