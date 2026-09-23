import assert from "node:assert/strict";
import test from "node:test";

import { handleApiRequest } from "../worker.mjs";

function request(path) {
  return new Request(`https://picker.example${path}`);
}

function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

test("scrape relay requires a page URL", async () => {
  const response = await handleApiRequest(request("/api/scrape"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "A page URL is required.");
});

test("scrape relay rejects private, loopback, and credentialed targets", async () => {
  const targets = [
    "http://127.0.0.1/secret",
    "http://192.168.0.8/admin",
    "http://localhost/page",
    "https://user:pass@summitsforimpact.com/day-3/",
    "file:///etc/passwd",
  ];
  for (const target of targets) {
    const response = await handleApiRequest(request(`/api/scrape?url=${encodeURIComponent(target)}`), {
      fetchImpl: async () => {
        throw new Error("The relay fetched a blocked URL.");
      },
    });
    assert.equal(response.status, 400, target);
  }
});

test("scrape relay returns the page HTML and follows a public redirect", async () => {
  const seen = [];
  const response = await handleApiRequest(
    request(`/api/scrape?url=${encodeURIComponent("https://summitsforimpact.com/start")}`),
    { fetchImpl: async (input) => {
      const href = input instanceof URL ? input.href : String(input);
      seen.push(href);
      if (href.endsWith("/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "/embodiment-summit/day-3/" },
        });
      }
      return htmlResponse("<html><a href='https://vimeo.com/471987937'>Panel</a></html>");
    } }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.finalUrl, "https://summitsforimpact.com/embodiment-summit/day-3/");
  assert.match(body.html, /vimeo\.com\/471987937/);
  assert.deepEqual(seen, [
    "https://summitsforimpact.com/start",
    "https://summitsforimpact.com/embodiment-summit/day-3/",
  ]);
});

test("scrape relay refuses a redirect onto a private address", async () => {
  const response = await handleApiRequest(
    request(`/api/scrape?url=${encodeURIComponent("https://summitsforimpact.com/start")}`),
    {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /private network/i);
});

test("a bot challenge is rendered in the browser before the HTML is returned", async () => {
  let rendered = "";
  const response = await handleApiRequest(
    request(`/api/scrape?url=${encodeURIComponent("https://summitsforimpact.com/day-3/")}`),
    {
      fetchImpl: async () =>
        htmlResponse('<html><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/"></html>'),
      renderPage: async (url) => {
        rendered = url;
        return "<html><a href='https://vimeo.com/471987937'>Panel</a></html>";
      },
    }
  );
  assert.equal(response.status, 200);
  assert.equal(rendered, "https://summitsforimpact.com/day-3/");
  assert.match((await response.json()).html, /vimeo\.com\/471987937/);
});

test("a bot challenge without a browser asks for pasted HTML", async () => {
  const response = await handleApiRequest(
    request(`/api/scrape?url=${encodeURIComponent("https://summitsforimpact.com/day-3/")}`),
    {
      fetchImpl: async () => htmlResponse("<title>Robot Challenge Screen</title>"),
    }
  );
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Paste the page HTML/);
});

test("download plan rewrites a split HLS stream into local files", async () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="Original",DEFAULT=YES,URI="audio/playlist.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,AUDIO="audio-high"',
    "video/playlist.m3u8",
  ].join("\n");
  const media = (name) =>
    ["#EXTM3U", '#EXT-X-MAP:URI="segments/init.mp4"', "#EXTINF:6,", `segments/${name}`].join("\n");
  const response = await handleApiRequest(
    request(`/api/media-plan?url=${encodeURIComponent("https://cdn.example/master.m3u8")}`),
    {
      fetchImpl: async (input) => {
        const href = input instanceof URL ? input.href : String(input);
        const body = href.endsWith("/master.m3u8")
          ? master
          : href.includes("/audio/")
            ? media("audio.m4s")
            : media("video.m4s");
        return htmlResponse(body, 200, { "content-type": "application/vnd.apple.mpegurl" });
      },
    }
  );
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.format, "hls");
  assert.equal(plan.files[0].path, "master.m3u8");
  assert.match(plan.files[0].text, /video\/playlist\.m3u8/);
  assert.ok(plan.files.some((file) => file.path === "video/segments/00000.mp4" && file.url.endsWith("/init.mp4")));
  assert.ok(plan.files.some((file) => file.path === "audio/segments/00001.m4s"));
});

test("media proxy rejects a private file URL", async () => {
  const response = await handleApiRequest(
    request(`/api/media-proxy?url=${encodeURIComponent("http://127.0.0.1/secret.mp4")}`),
    { fetchImpl: async () => { throw new Error("fetched a private URL"); } }
  );
  assert.equal(response.status, 400);
});

test("hosted offline library reports no disk copies", async () => {
  const response = await handleApiRequest(request("/api/offline/library"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { videos: [], storagePath: "" });
});
