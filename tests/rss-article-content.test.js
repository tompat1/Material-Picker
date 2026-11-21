const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function articleContentApp() {
  const context = vm.createContext({
    document: { body: { dataset: {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { clearTimeout, setTimeout, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null, setItem() {} },
    crypto,
    URL,
    Intl,
    console,
    setTimeout,
    clearTimeout,
    confirm: () => true,
  });
  const source = fs.readFileSync(require.resolve("../public/rss-desk.js"), "utf8");
  vm.runInContext(`${source}\n
    globalThis.articleContentTest = {
      paragraphCount: articleParagraphCount,
      needsFullContent: isFeedItemTruncated,
    };
  `, context);
  return context.articleContentTest;
}

test("single-paragraph feed teasers request fuller article content", () => {
  const app = articleContentApp();
  const bbcTeaser = "Earlier this week, Trump greeted Putin ahead of a meeting in China and said the pair have a great relationship.";

  assert.equal(app.paragraphCount(bbcTeaser), 1);
  assert.equal(app.needsFullContent({ summary: bbcTeaser }), true);
});

test("two substantial feed paragraphs are enough for the reader", () => {
  const app = articleContentApp();
  const summary = "This is the first substantial paragraph from the article feed.\n\nThis is the second substantial paragraph with additional reporting.";

  assert.equal(app.paragraphCount(summary), 2);
  assert.equal(app.needsFullContent({ summary }), false);
});
