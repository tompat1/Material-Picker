const { test, expect } = require("@playwright/test");

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test(`${device} close controls retain a large target and a restrained X`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator(".mast")).toHaveScreenshot(`mast-${device}.png`);

    const closeButtons = page.locator('button[aria-label="Close"]:has(svg)');
    const dimensions = await closeButtons.evaluateAll((buttons) => buttons.map((button) => {
      const icon = button.querySelector("svg");
      const buttonStyle = getComputedStyle(button);
      const iconStyle = getComputedStyle(icon);
      return {
        buttonWidth: parseFloat(buttonStyle.width),
        buttonHeight: parseFloat(buttonStyle.height),
        iconWidth: parseFloat(iconStyle.width),
        iconHeight: parseFloat(iconStyle.height),
        strokeWidth: parseFloat(iconStyle.strokeWidth),
      };
    }));
    expect(dimensions.length).toBeGreaterThanOrEqual(7);
    for (const size of dimensions) {
      expect(size.buttonWidth).toBeGreaterThanOrEqual(44);
      expect(size.buttonHeight).toBeGreaterThanOrEqual(44);
      expect(size.iconWidth).toBeLessThanOrEqual(18);
      expect(size.iconHeight).toBeLessThanOrEqual(18);
      expect(size.strokeWidth).toBeLessThanOrEqual(2.2);
    }

    await page.locator("#accountLink").click();
    const account = page.locator("#accountDialog");
    await expect(account).toBeVisible();
    const accountClose = account.getByRole("button", { name: "Close" });
    await accountClose.evaluate((button) => button.blur());
    await expect(accountClose).toHaveScreenshot(`account-close-${device}.png`);
    await expect(account).toHaveScreenshot(`account-dialog-${device}.png`);
    await accountClose.click();
    await expect(account).not.toBeVisible();

    await page.locator("#globalSearchTrigger").click();
    const search = page.locator("#globalSearchDialog");
    await expect(search).toBeVisible();
    await search.getByRole("button", { name: "Close" }).evaluate((button) => button.blur());
    await expect(search).toHaveScreenshot(`search-dialog-${device}.png`);
    await search.getByRole("button", { name: "Close" }).click();
    await expect(search).not.toBeVisible();

    await page.locator("#addVideoButton").click();
    const addVideo = page.locator("#addVideoDialog");
    await expect(addVideo).toBeVisible();
    await addVideo.getByRole("button", { name: "Close" }).click();
    await expect(addVideo).not.toBeVisible();

    const addFeed = page.locator("#feedsAddDialog");
    await page.locator("#desk-feeds").evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await addFeed.evaluate((dialog) => dialog.showModal());
    await expect(addFeed).toBeVisible();
    await addFeed.getByRole("button", { name: "Close" }).click();
    await expect(addFeed).not.toBeVisible();
  });
}
