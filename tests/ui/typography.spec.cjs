const { test, expect } = require("@playwright/test");

async function checkVisibleType(page) {
  const result = await page.evaluate(() => {
    const tooSmall = [...document.querySelectorAll("body *")].flatMap((element) => {
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (!text) return [];
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || !box.height || box.right <= 0 || box.bottom <= 0 ||
          box.left >= innerWidth || box.top >= innerHeight ||
          style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return [];
      const pixels = parseFloat(style.fontSize);
      return pixels < 12 ? [`${pixels}px: ${text.slice(0, 48)}`] : [];
    });
    return { tooSmall, width: document.documentElement.scrollWidth, viewport: innerWidth };
  });
  expect(result.tooSmall).toEqual([]);
  expect(result.width).toBeLessThanOrEqual(result.viewport + 1);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
]) {
  test(`functional text stays readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await checkVisibleType(page);

    await page.locator("#desk-feeds").evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await checkVisibleType(page);

    await page.locator("#accountLink").click();
    await checkVisibleType(page);
    await page.locator("#accountDialog button[aria-label='Close']").click();

    await page.locator("#globalSearchTrigger").click();
    await checkVisibleType(page);
    await page.locator("#globalSearchDialog button[aria-label='Close']").click();

    await page.locator("#thumbStyleNewAge").click();
    await expect(page.locator("html")).toHaveAttribute("data-picker-theme", "new-age");
    await checkVisibleType(page);
  });
}
