const { test, expect } = require("@playwright/test");

for (const [device, viewport, theme] of [
  ["desktop", { width: 1440, height: 900 }, "new-age"],
  ["phone", { width: 390, height: 844 }, "cinematic"],
]) {
  test(`${device} shop sizes stay visible and reach the bag`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    if (theme === "new-age") await page.locator("#thumbStyleNewAge").click();
    await page.locator("#headerBag").click();
    await expect(page.locator("#desk-shop")).toBeChecked();
    await expect(page.locator("#pickerLoader")).toBeHidden();

    const hoodie = page.locator('[data-shop-product="hoodie-black"]');
    const choices = hoodie.locator(".shop-option");
    await expect(choices.getByRole("radio")).toHaveCount(4);
    await expect(choices.locator("select")).toHaveCount(0);
    await expect(choices.getByRole("radio", { name: "S" })).toBeChecked();
    await choices.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expect(choices).toHaveScreenshot(`shop-sizes-${device}.png`);

    await choices.getByRole("radio", { name: "XL" }).check();
    await hoodie.locator("[data-shop-add]").click();
    await expect(page.locator('[data-shop-product="hoodie-black"]').getByRole("radio", { name: "XL" })).toBeChecked();
    await page.locator("#headerBag").click();
    await expect(page.locator("#shopDrawerBody .shop-line")).toContainText("XL");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

test("print sizes remain distinct bag options", async ({ page }) => {
  await page.goto("/");
  await page.locator("#headerBag").click();
  const print = page.locator('[data-shop-product="print"]');
  await expect(print.getByRole("radio")).toHaveCount(3);
  await print.getByRole("radio", { name: "50×70" }).check();
  await print.locator("[data-shop-add]").click();
  await page.locator("#headerBag").click();
  await expect(page.locator("#shopDrawerBody .shop-line")).toContainText("50×70");
});
