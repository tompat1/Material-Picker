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
  assert.equal(plan.estimatedBytes, 750);
  assert.equal(plan.durationSeconds, 6);
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

test("chapters API returns YouTube macro marker chapters", async () => {
  const watchHtml = `<html>macroMarkersListItemRenderer":{"title":{"simpleText":"Welcome"},"timeDescription":{"simpleText":"0:00"}}</html>`;
  const response = await handleApiRequest(
    request(`/api/chapters?url=${encodeURIComponent("https://www.youtube.com/watch?v=abcdefghijk")}`),
    {
      fetchImpl: async (input) => {
        const href = input instanceof URL ? input.href : String(input);
        if (href.includes("youtube.com/watch")) return htmlResponse(watchHtml);
        throw new Error(`Unexpected fetch: ${href}`);
      },
    }
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "youtube");
  assert.equal(data.chapters[0].title, "Welcome");
});

test("transcript API extracts Vimeo WebVTT captions into cue text", async () => {
  const mockVtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to the summit.

00:00:04.500 --> 00:00:08.000
Today we discuss embodiment.
`;
  const playerHtml = `<html><script>window.playerConfig = {
    "request": {
      "text_tracks": [
        { "id": 123, "lang": "en", "url": "https://captions.example/123.vtt", "label": "English", "default": true }
      ]
    }
  };</script></html>`;

  const response = await handleApiRequest(
    request(`/api/transcript?url=${encodeURIComponent("https://vimeo.com/471161461")}`),
    {
      fetchImpl: async (input) => {
        const href = input instanceof URL ? input.href : String(input);
        if (href.includes("player.vimeo.com")) return htmlResponse(playerHtml);
        if (href.includes("captions.example")) return new Response(mockVtt, { status: 200, headers: { "content-type": "text/vtt" } });
        throw new Error(`Unexpected fetch: ${href}`);
      },
    }
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.cueCount, 2);
  assert.equal(data.language, "en");
  assert.match(data.text, /\[00:00:01\] Welcome to the summit\./);
  assert.match(data.text, /\[00:00:04\] Today we discuss embodiment\./);
});

test("stream API resolves Vimeo HLS stream URL", async () => {
  const playerHtml = `<html><script>window.playerConfig = {
    "request": {
      "files": {
        "hls": {
          "default_cdn": "ak",
          "cdns": {
            "ak": { "url": "https://vod.example/master.m3u8" }
          }
        }
      }
    }
  };</script></html>`;

  const response = await handleApiRequest(
    request(`/api/stream?url=${encodeURIComponent("https://vimeo.com/471161461")}`),
    {
      fetchImpl: async (input) => {
        const href = input instanceof URL ? input.href : String(input);
        if (href.includes("player.vimeo.com")) return htmlResponse(playerHtml);
        throw new Error(`Unexpected fetch: ${href}`);
      },
    }
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.type, "hls");
  assert.equal(data.url, "https://vod.example/master.m3u8");
  assert.equal(data.provider, "Vimeo public HLS");
});

test("proofread API cleans stutter and filler words and removes timestamps by default", async () => {
  const response = await handleApiRequest(
    new Request("https://picker.example/api/proofread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "[00:01] Um um hello hello world." }),
    })
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.proofread, "Hello world.");
});

test("proofread API supports custom options for timestamps and speaker deduplication", async () => {
  const response = await handleApiRequest(
    new Request("https://picker.example/api/proofread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "[00:01] Speaker A: Um hello.\n[00:05] Speaker A: How are you?",
        removeTimestamps: false,
        deduplicateSpeakers: true,
      }),
    })
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.proofread, "[00:01] Speaker A: Hello.\n[00:05] How are you?");
});

test("proofread API splits continuous mega text when addLineBreaks option is true", async () => {
  const response = await handleApiRequest(
    new Request("https://picker.example/api/proofread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "First sentence of transcription. Second sentence follows immediately. Third sentence keeps going. Fourth sentence forms another paragraph.",
        addLineBreaks: true,
      }),
    })
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.proofread.includes("\n"), "Output should contain line breaks for continuous text");
});

test("choose-folder and scan-folder endpoints provide helpful responses on worker", async () => {
  const chooseRes = await handleApiRequest(
    new Request("https://picker.example/api/choose-folder")
  );
  assert.equal(chooseRes.status, 200);
  const chooseData = await chooseRes.json();
  assert.equal(chooseData.supported, false);

  const scanRes = await handleApiRequest(
    new Request("https://picker.example/api/scan-folder?path=/Users/example/Videos")
  );
  assert.equal(scanRes.status, 400);
  const scanData = await scanRes.json();
  assert.match(scanData.error, /local server|locally/i);
});

test("thumbnail rendering requires a prompt and a connected model", async () => {
  const missing = await handleApiRequest(new Request("https://picker.example/api/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "A quiet documentary portrait, no text." }),
  }));
  assert.equal(missing.status, 503);

  const empty = await handleApiRequest(new Request("https://picker.example/api/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "short" }),
  }), { ai: { async run() { return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); } } });
  assert.equal(empty.status, 400);
});

test("thumbnail rendering returns the Flux image bytes", async () => {
  let seen = null;
  const response = await handleApiRequest(new Request("https://picker.example/api/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "A quiet documentary portrait inspired by a workshop, no text." }),
  }), {
    ai: {
      async run(model, input) {
        seen = { model, input };
        return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(seen.model, "@cf/black-forest-labs/flux-1-schnell");
  assert.match(seen.input.prompt, /documentary portrait/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
});

test("thumbnail rendering accepts a Flux image stream", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const response = await handleApiRequest(new Request("https://picker.example/api/thumbnail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "A quiet documentary portrait inspired by a workshop, no text." }),
  }), {
    ai: {
      async run() {
        return new Response(jpeg).body;
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
});

test("live transcription sends saved audio to Whisper", async () => {
  const missing = await handleApiRequest(new Request("https://picker.example/api/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pcmBase64: Buffer.from([0, 0, 0, 0]).toString("base64"), language: "en" }),
  }));
  assert.equal(missing.status, 503);

  let seen = null;
  const response = await handleApiRequest(new Request("https://picker.example/api/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pcmBase64: Buffer.from([0, 0, 0, 0]).toString("base64"),
      language: "en",
      currentTime: 12,
    }),
  }), {
    ai: {
      async run(model, input) {
        seen = { model, input };
        return { text: "A quiet line of speech." };
      },
    },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.text, "A quiet line of speech.");
  assert.equal(data.timestamp, 12);
  assert.equal(seen.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(seen.input.language, "en");
  const wav = Buffer.from(seen.input.audio, "base64");
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
});

test("rss catalog searches topics without fetching a remote feed", async () => {
  let fetched = false;
  const response = await handleApiRequest(request("/api/rss/catalog?topic=ai&q=openai"), {
    fetchImpl: async () => {
      fetched = true;
      return new Response("", { status: 500 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(fetched, false);
  const body = await response.json();
  assert.ok(body.topics.some((topic) => topic.id === "movies"));
  assert.deepEqual(body.feeds.map((feed) => feed.id), ["openai"]);
});

test("rss relay requires a feed or page URL", async () => {
  const response = await handleApiRequest(request("/api/rss"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "A feed or page URL is required.");
});

test("rss relay rejects private targets before fetching", async () => {
  const targets = ["http://127.0.0.1/feed.xml", "http://192.168.1.4/rss", "https://user:pass@news.example/feed.xml"];
  for (const target of targets) {
    let fetched = false;
    const response = await handleApiRequest(request(`/api/rss?url=${encodeURIComponent(target)}`), {
      fetchImpl: async () => {
        fetched = true;
        return new Response("<rss></rss>", { headers: { "content-type": "application/rss+xml" } });
      },
    });
    assert.equal(response.status, 400, target);
    assert.equal(fetched, false, target);
  }
});

test("rss relay parses a public feed", async () => {
  const response = await handleApiRequest(
    request(`/api/rss?url=${encodeURIComponent("https://notes.example/feed.xml")}`),
    {
      fetchImpl: async () => new Response(
        `<rss version="2.0"><channel><title>Notes</title><item><title>One</title><link>https://notes.example/one</link></item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } }
      ),
    }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kind, "feed");
  assert.equal(body.feed.title, "Notes");
  assert.equal(body.feed.items[0].link, "https://notes.example/one");
});


