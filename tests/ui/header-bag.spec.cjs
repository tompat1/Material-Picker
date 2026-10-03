const { test, expect } = require("@playwright/test");

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  test(`${device} header bag follows the saved item count`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const bag = page.locator("#headerBag");
    const drawer = page.locator("#shopDrawer");
    await expect(bag).toHaveAttribute("aria-label", "Bag, 0 items");
    await bag.click();
    await expect(page.locator("#desk-shop")).toBeChecked();
    await expect(drawer).not.toBeVisible();

    await page.locator("[data-shop-add]").first().click();
    await expect(bag).toHaveAttribute("aria-label", "Bag, 1 item");
    await expect(page.locator("#headerBagCount")).toHaveText("1");

    await page.locator("#desk-library").evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await bag.click();
    await expect(page.locator("#desk-shop")).toBeChecked();
    await expect(drawer).toBeVisible();
    await expect(bag).toHaveAttribute("aria-expanded", "true");

    await drawer.locator('[data-shop-qty][data-delta="1"]').click();
    await expect(page.locator("#headerBagCount")).toHaveText("2");
    await page.reload();
    await expect(page.locator("#headerBagCount")).toHaveText("2");
    await page.locator("#headerBag").click();
    await expect(drawer).toBeVisible();

    await drawer.locator("[data-shop-remove]").click();
    await expect(page.locator("#headerBagCount")).toHaveText("0");
    await drawer.locator('[data-shop-close][aria-label="Close"]').click();
    await page.locator("#headerBag").click();
    await expect(drawer).not.toBeVisible();
    await expect(page.locator("#desk-shop")).toBeChecked();
  });
}

test("bag stays accessible in a narrow phone header and leaves the player", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const bag = page.locator("#headerBag");
  await expect(bag).toBeVisible();
  const size = await bag.boundingBox();
  expect(size.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.locator("body").evaluate((body) => body.classList.add("is-mobile-player"));
  await bag.click();
  await expect(page.locator("#desk-shop")).toBeChecked();
  await expect(page.locator("body")).not.toHaveClass(/is-mobile-player/);
});
