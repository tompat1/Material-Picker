const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPublicIp(address) {
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicIp(mapped[1]);
  if (address.includes(":")) return true;

  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function assertPageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail(400, "The page URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail(400, "Only HTTP and HTTPS page URLs are allowed.");
  }
  if (url.username || url.password) throw fail(400, "URLs containing credentials are not allowed.");

  const host = url.hostname.toLowerCase();
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal";
  if (blockedName || (looksLikeIp(host) && !isPublicIp(host))) {
    throw fail(400, "Local and private network addresses are not allowed.");
  }
  return url;
}

function looksLikeIp(host) {
  return host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

async function readLimitedText(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PAGE_BYTES) throw fail(502, "The response is larger than the allowed limit.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw fail(502, "The response is larger than the allowed limit.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(merged);
}

async function fetchPage(value, fetchImpl, redirects = 0) {
  const url = assertPageUrl(value);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain",
      "User-Agent": BROWSER_USER_AGENT,
    },
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= MAX_REDIRECTS) throw fail(502, "The page redirected too many times.");
    const next = new URL(response.headers.get("location"), url).href;
    return fetchPage(next, fetchImpl, redirects + 1);
  }
  if (!response.ok) throw fail(502, `The page returned ${response.status}.`);

  const contentType = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw fail(502, "The URL returned an unsupported content type.");
  }
  const body = await readLimitedText(response);
  return { body, finalUrl: url.href, challenged: isBotChallenge(body) };
}

function isBotChallenge(html) {
  return /sgcaptcha|Robot Challenge Screen|cf-browser-verification|Just a moment/i.test(html);
}

async function renderPage(browser, url) {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw fail(502, `The page's bot check could not be completed (${response.status}). ${detail}`.trim());
  }
  const contentType = response.headers.get("content-type") || "";
  const html = contentType.includes("json") ? await htmlFromBrowserJson(response) : await readLimitedText(response);
  if (isBotChallenge(html)) {
    throw fail(502, "The site's bot check blocked the scan. Paste the page HTML below instead.");
  }
  return html;
}

async function htmlFromBrowserJson(response) {
  const data = JSON.parse(await readLimitedText(response));
  if (!data?.success || typeof data.result !== "string") {
    throw fail(502, "The page's bot check could not be completed.");
  }
  if (data.result.length > MAX_PAGE_BYTES) throw fail(502, "The response is larger than the allowed limit.");
  return data.result;
}

export async function handleApiRequest(request, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/offline/library") {
    return json(200, { videos: [], storagePath: "" });
  }
  if (request.method === "GET" && url.pathname === "/api/scrape") {
    const target = url.searchParams.get("url");
    if (!target) return json(400, { error: "A page URL is required." });
    try {
      const page = await fetchPage(target, fetchImpl);
      if (!page.challenged) return json(200, { html: page.body, finalUrl: page.finalUrl });
      if (!dependencies.renderPage) {
        throw fail(502, "The site's bot check blocked the scan. Paste the page HTML below instead.");
      }
      const html = await dependencies.renderPage(page.finalUrl);
      return json(200, { html, finalUrl: page.finalUrl });
    } catch (error) {
      return json(error.status || 502, { error: error.message || "The page could not be scanned." });
    }
  }
  return json(404, { error: "This API is only available in the local app." });
}

export default {
  async fetch(request, env) {
    return handleApiRequest(request, {
      renderPage: env?.BROWSER ? (url) => renderPage(env.BROWSER, url) : null,
    });
  },
};
