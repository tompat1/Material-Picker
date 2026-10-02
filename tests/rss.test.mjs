import assert from "node:assert/strict";
import test from "node:test";

import { discoverFeeds, loadFeed, parseFeed, popularFeedCatalog, searchFeedCatalog } from "../rss.mjs";

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Desk notes</title>
    <link>https://notes.example/</link>
    <item>
      <title><![CDATA[Hello &amp; welcome]]></title>
      <link>https://notes.example/hello</link>
      <guid>note-1</guid>
      <pubDate>Tue, 01 Oct 2024 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>A <b>short</b> note.</p><script>alert(1)</script>]]></description>
      <enclosure url="https://cdn.example/hello.mp4" type="video/mp4" />
    </item>
    <item>
      <title>Older</title>
      <link>https://notes.example/older</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>Plain text.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Channel</title>
  <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=abc"/>
  <link rel="alternate" href="https://www.youtube.com/channel/abc"/>
  <entry>
    <id>yt:video:dQw4w9wg</id>
    <yt:videoId>dQw4w9wg</yt:videoId>
    <title>Talk</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9wg"/>
    <published>2024-06-02T08:00:00+00:00</published>
    <author><name>Ada</name></author>
    <media:group>
      <media:description>A filmed talk.</media:description>
      <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9wg/hqdefault.jpg"/>
    </media:group>
  </entry>
</feed>`;

test("parseFeed reads RSS items, strips markup, and keeps video enclosures", () => {
  const feed = parseFeed(RSS, "https://notes.example/feed.xml");
  assert.equal(feed.title, "Desk notes");
  assert.equal(feed.siteUrl, "https://notes.example/");
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].id, "note-1");
  assert.equal(feed.items[0].title, "Hello & welcome");
  assert.equal(feed.items[0].summary, "A short note.");
  assert.equal(feed.items[0].videoUrl, "https://cdn.example/hello.mp4");
  assert.equal(feed.items[0].publishedAt, "2024-10-01T12:00:00.000Z");
  assert.equal(feed.items[1].videoUrl, "");
});

test("parseFeed reads an Atom entry, including a YouTube-style video", () => {
  const feed = parseFeed(ATOM, "https://www.youtube.com/feeds/videos.xml?channel_id=abc");
  assert.equal(feed.title, "Channel");
  assert.equal(feed.siteUrl, "https://www.youtube.com/channel/abc");
  assert.equal(feed.items[0].title, "Talk");
  assert.equal(feed.items[0].author, "Ada");
  assert.equal(feed.items[0].summary, "A filmed talk.");
  assert.equal(feed.items[0].videoUrl, "https://www.youtube.com/watch?v=dQw4w9wg");
  assert.equal(feed.items[0].image, "https://i.ytimg.com/vi/dQw4w9wg/hqdefault.jpg");
  assert.equal(feed.items[0].publishedAt, "2024-06-02T08:00:00.000Z");
});

test("discoverFeeds finds alternate RSS and Atom links", () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/app.css">
    <link rel="alternate" type="application/rss+xml" title="Main" href="/rss.xml">
    <link rel="alternate" type="application/atom+xml" href="https://other.example/atom.xml">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml">
  </head></html>`;
  const feeds = discoverFeeds(html, "https://notes.example/blog");
  assert.deepEqual(feeds, [
    { url: "https://notes.example/rss.xml", title: "Main", type: "application/rss+xml" },
    { url: "https://other.example/atom.xml", title: "", type: "application/atom+xml" },
  ]);
});

test("loadFeed returns a choice list when a page offers several feeds", async () => {
  const result = await loadFeed("https://notes.example/", async () => ({
    body: `<link rel="alternate" type="application/rss+xml" title="News" href="/news.xml">
      <link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml">`,
    contentType: "text/html",
    finalUrl: "https://notes.example/",
  }));
  assert.equal(result.kind, "choices");
  assert.equal(result.feeds.length, 2);
  assert.equal(result.feeds[0].title, "News");
});

test("loadFeed follows the only discovered feed", async () => {
  const seen = [];
  const result = await loadFeed("https://notes.example/", async (url) => {
    seen.push(url);
    if (url.endsWith(".xml")) return { body: RSS, contentType: "application/rss+xml", finalUrl: url };
    return {
      body: `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`,
      contentType: "text/html",
      finalUrl: "https://notes.example/",
    };
  });
  assert.deepEqual(seen.slice(0, 2), ["https://notes.example/", "https://notes.example/feed.xml"]);
  assert.equal(result.kind, "feed");
  assert.equal(result.feed.title, "Desk notes");
  assert.equal(result.feed.items[0].title, "Hello & welcome");
});

test("parseFeed reads images from media tags and article html", () => {
  const guardian = parseFeed(`<?xml version="1.0"?>
    <rss><channel><title>Guardian</title><link>https://www.theguardian.com/film</link>
      <item>
        <title>Mural</title>
        <link>https://www.theguardian.com/film/mural</link>
        <description>A mural is painted over.</description>
        <media:content width="140" url="https://i.guim.co.uk/img/media/photo/master/1999.jpg?width=140&amp;quality=85"/>
      </item>
    </channel></rss>`, "https://www.theguardian.com/film/rss");
  assert.equal(guardian.items[0].image, "https://i.guim.co.uk/img/media/photo/master/1999.jpg?width=140&quality=85");

  const verge = parseFeed(`<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><title>Verge</title>
      <entry>
        <title>Suno</title>
        <link rel="alternate" href="https://www.theverge.com/suno"/>
        <summary type="html"><![CDATA[<img src="https://platform.theverge.com/uploads/suno.jpg?quality=90&#038;strip=all" /> Spoken words.]]></summary>
      </entry>
    </feed>`, "https://www.theverge.com/rss/index.xml");
  assert.equal(verge.items[0].image, "https://platform.theverge.com/uploads/suno.jpg?quality=90&strip=all");
});

test("loadFeed fills a missing image from the article page", async () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>IndieWire</title><link>https://www.indiewire.com/</link>
    <item><title>Baldwin</title><link>https://www.indiewire.com/baldwin</link><description>No picture here.</description></item>
  </channel></rss>`;
  const result = await loadFeed("https://www.indiewire.com/feed/", async (url) => {
    if (url.endsWith("/feed/")) return { body: rss, contentType: "application/rss+xml", finalUrl: url };
    return {
      body: `<meta property="og:image" content="https://www.indiewire.com/wp-content/uploads/baldwin.jpg" />`,
      contentType: "text/html",
      finalUrl: url,
    };
  });
  assert.equal(result.feed.items[0].image, "https://www.indiewire.com/wp-content/uploads/baldwin.jpg");
});

test("searchFeedCatalog filters by topic and words", () => {
  const movies = searchFeedCatalog({ topic: "movies" }).map((feed) => feed.title);
  assert.ok(movies.includes("Variety"));
  assert.ok(movies.includes("Roger Ebert"));
  assert.equal(movies.some((title) => title === "OpenAI News"), false);

  const apple = searchFeedCatalog({ query: "apple" }).map((feed) => feed.id);
  assert.ok(apple.includes("macrumors"));
  assert.ok(apple.includes("nineto5mac"));
  assert.ok(apple.includes("daring-fireball"));

  const gamingAi = searchFeedCatalog({ topic: "gaming", query: "pc" }).map((feed) => feed.id);
  assert.deepEqual(gamingAi, ["rps"]);

  assert.equal(searchFeedCatalog({}).length, 0);
  assert.equal(searchFeedCatalog({ topic: "cooking" }).length, 0);
  assert.ok(searchFeedCatalog({ topic: "popular" }).length >= 12);
  assert.deepEqual(searchFeedCatalog({ topic: "popular" }).map((feed) => feed.id), popularFeedCatalog().map((feed) => feed.id));
  assert.ok(searchFeedCatalog({ query: "gardening" }).every((feed) => feed.topics.includes("science")));
  assert.ok(searchFeedCatalog({ query: "indie games" }).every((feed) => feed.topics.includes("gaming")));
  assert.ok(searchFeedCatalog({ query: "cybersecurity" }).every((feed) => feed.topics.includes("tech")));
  assert.ok(searchFeedCatalog({ query: "marques" }).some((feed) => feed.id === "mkbhd"));
  assert.ok(searchFeedCatalog({ query: "mkbhd" }).some((feed) => feed.id === "mkbhd"));
  assert.ok(searchFeedCatalog({ query: "matt wolfe" }).some((feed) => feed.id === "matt-wolfe"));
  assert.ok(searchFeedCatalog({ query: "engadget" }).some((feed) => feed.id === "engadget"));
  assert.ok(searchFeedCatalog({ query: "guardian" }).some((feed) => feed.id === "guardian-world"));
});

test("loadFeed probes common feed paths when the page has no alternate links", async () => {
  const seen = [];
  const result = await loadFeed("https://notes.example/", async (url) => {
    seen.push(url);
    if (url === "https://notes.example/") {
      return { body: "<html><body>No feed tags</body></html>", finalUrl: url, contentType: "text/html" };
    }
    if (url === "https://notes.example/feed") {
      return {
        body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Notes</title><item><title>Hello</title><link>https://notes.example/1</link></item></channel></rss>`,
        finalUrl: url,
        contentType: "application/rss+xml",
      };
    }
    throw new Error(`unexpected ${url}`);
  });
  assert.equal(result.kind, "feed");
  assert.equal(result.feed.title, "Notes");
  assert.deepEqual(seen.slice(0, 2), ["https://notes.example/", "https://notes.example/feed"]);
});

test("loadFeed reports when a page has no feed", async () => {
  await assert.rejects(
    () => loadFeed("https://notes.example/", async () => ({ body: "<html><p>Hello</p></html>", contentType: "text/html", finalUrl: "https://notes.example/" })),
    (error) => error.status === 404 && /No RSS or Atom feed/.test(error.message)
  );
});
