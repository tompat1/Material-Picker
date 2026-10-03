const fs = require("node:fs");
const path = require("node:path");

const core = require("../public/app-core.js");
const { assertUnencryptedHls, extractPlayerConfig, selectHlsVariant } = require("../server.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "summit-day-2.html"), "utf8");
const summitUrl = "https://summitsforimpact.com/embodiment-summit/day-2/?playlist=78cefb8c&video=bd9fdf3";
const videos = core.extractVideos(fixture, summitUrl);

async function verify(video) {
  const playerUrl = core.toEmbedUrl(video.url);
  try {
    const response = await fetch(playerUrl, { signal: AbortSignal.timeout(20000) });
    const html = await response.text();
    const config = extractPlayerConfig(html);
    const hasPlayer = Boolean(config.request);
    const isPublicEmbed = html.includes('"embed_permission":"public"');
    const hls = config.request?.files?.hls;
    const hlsUrl = hls?.cdns?.[hls.default_cdn]?.url || Object.values(hls?.cdns || {})[0]?.url;
    if (!hlsUrl) throw new Error("No public HLS source");
    const manifestResponse = await fetch(hlsUrl, { signal: AbortSignal.timeout(20000) });
    const manifest = await manifestResponse.text();
    assertUnencryptedHls(manifest);
    const variant = selectHlsVariant(manifest);
    const ready = response.ok && manifestResponse.ok && hasPlayer && isPublicEmbed && Boolean(variant);
    return { title: video.title, playerUrl, status: response.status, height: variant?.height || 0, ready };
  } catch (error) {
    return { title: video.title, playerUrl, status: error.name, ready: false };
  }
}

async function verifyYouTube() {
  const { handleApiRequest } = await import("../worker.mjs");
  const response = await handleApiRequest(new Request("https://picker.example/api/video-search?q=ceramics&source=youtube"));
  const body = await response.json();
  const results = body.results || [];
  if (!response.ok || !results.length || !results.every((item) => item.source === "youtube" && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(item.url))) {
    throw new Error(body.error || `Unexpected YouTube search response (${response.status}, ${results.length} results)`);
  }
  return `${response.status} ${results.length} playable search results`;
}

async function verifyRss() {
  const { handleApiRequest } = await import("../worker.mjs");
  const feedUrl = "https://hnrss.org/frontpage";
  const response = await handleApiRequest(new Request(`https://picker.example/api/rss?url=${encodeURIComponent(feedUrl)}`));
  const body = await response.json();
  const feed = body.feed;
  if (!response.ok || body.kind !== "feed" || !feed?.items?.length || !feed.items.some((item) => /^https?:\/\//.test(item.link || ""))) {
    throw new Error(body.error || `Unexpected RSS response (${response.status}, ${feed?.items?.length || 0} items)`);
  }
  return `${response.status} ${feed.items.length} feed items`;
}

async function reportExternal(label, check) {
  try {
    console.log(`PASS ${label} ${await check()}`);
  } catch (error) {
    console.error(`FAIL ${label} ${error.message}`);
    process.exitCode = 1;
  }
}

Promise.all(videos.map(verify)).then(async (results) => {
  results.forEach((result, index) => {
    console.log(
      `${result.ready ? "PASS" : "FAIL"} ${index + 1}/10 ${result.status} ${result.height ? `${result.height}p` : "no variant"} ${result.playerUrl}`
    );
  });
  const readyCount = results.filter((result) => result.ready).length;
  console.log(`\n${readyCount}/${results.length} Vimeo players expose selectable, public, unencrypted HLS for offline saving.`);
  if (readyCount !== results.length) process.exitCode = 1;
  await Promise.all([
    reportExternal("YouTube search", verifyYouTube),
    reportExternal("RSS feed", verifyRss),
  ]);
});
