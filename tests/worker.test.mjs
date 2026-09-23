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

test("hosted offline library reports no disk copies", async () => {
  const response = await handleApiRequest(request("/api/offline/library"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { videos: [], storagePath: "" });
});
