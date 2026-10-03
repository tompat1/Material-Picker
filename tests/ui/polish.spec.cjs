const { test, expect } = require("@playwright/test");

for (const width of [761, 800, 1180]) {
  test(`tablet navigation and Add video stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const header = await page.locator(".mast").boundingBox();
    const addVideo = await page.locator("#addVideoButton").boundingBox();
    const search = await page.locator(".nav-search").boundingBox();
    const rail = await page.locator(".rail").boundingBox();
    expect(addVideo.y + addVideo.height).toBeLessThanOrEqual(search.y);
    expect(header.height).toBeLessThanOrEqual(80);
    expect(rail.height).toBeLessThanOrEqual(70);
    expect(rail.y + rail.height).toBeLessThanOrEqual(901);

    const labels = page.locator(".rail .nav-group label:visible");
    const rows = await labels.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().y)));
    expect(new Set(rows).size).toBe(1);

    if (width === 800) {
      await expect(page.locator(".mast")).toHaveScreenshot("tablet-mast.png");
      await expect(page.locator(".rail")).toHaveScreenshot("tablet-navigation.png");
    }

    await page.getByRole("button", { name: "Add video", exact: true }).first().click();
    await expect(page.locator("#addVideoDialog")).toBeVisible();
    await page.locator("#addVideoDialog button[aria-label='Close']").click();
    await expect(page.locator("#addVideoDialog")).not.toBeVisible();
  });
}

test("empty library action opens the import flow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".empty-add-video").click();
  await expect(page.locator("#addVideoDialog")).toBeVisible();
});
