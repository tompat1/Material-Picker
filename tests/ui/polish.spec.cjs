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

for (const width of [320, 390]) {
  test(`feed filter pills stay on one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.locator("#desk-feeds").evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const pills = page.locator("#feedsSort > button");
    await expect(pills).toHaveCount(3);
    const boxes = await pills.evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { top: Math.round(box.top), right: box.right };
    }));

    expect(new Set(boxes.map(({ top }) => top)).size).toBe(1);
    expect(Math.max(...boxes.map(({ right }) => right))).toBeLessThanOrEqual(width);
    await expect(page.locator("#feedsDiscoverCta svg")).toBeVisible();
  });
}

test("feed discovery presents its three steps as plain text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#feedsAddDialog").evaluate((dialog) => dialog.showModal());

  const steps = page.locator("#feedsDiscoverSteps > li");
  await expect(steps).toHaveText(["Choose topic", "Select feeds", "Pick folder"]);
  const presentation = await steps.evaluateAll((items) => items.map((item) => ({
    border: getComputedStyle(item).borderTopWidth,
    background: getComputedStyle(item).backgroundColor,
    arrow: getComputedStyle(item, "::before").content,
  })));

  expect(presentation.every(({ border }) => border === "0px")).toBe(true);
  expect(presentation.every(({ background }) => background === "rgba(0, 0, 0, 0)")).toBe(true);
  expect(presentation.slice(1).every(({ arrow }) => arrow.includes("→"))).toBe(true);
});

test("mobile feed tools use a right-edge tab rail and slide panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#desk-feeds").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const discover = page.getByRole("button", { name: "Discover", exact: true });
  const settings = page.getByRole("button", { name: "Feed settings" });
  const [headerBox, discoverBox, settingsBox] = await Promise.all([
    page.locator(".feeds-reeder-bar").boundingBox(),
    discover.boundingBox(),
    settings.boundingBox(),
  ]);
  expect(Math.round(discoverBox.x + discoverBox.width)).toBe(390);
  expect(Math.round(settingsBox.x + settingsBox.width)).toBe(390);
  expect(settingsBox.y).toBeGreaterThanOrEqual(discoverBox.y + discoverBox.height);
  expect(discoverBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
  await expect(page.locator(".feeds-reeder-actions")).toHaveCSS("position", "absolute");
  await expect(discover).toHaveAttribute("aria-controls", "feedsAddDialog");
  await expect(settings).toHaveAttribute("aria-controls", "feedsAddDialog");

  const drawer = page.locator("#feedsAddDialog");
  await drawer.evaluate((dialog) => {
    dialog.dataset.mode = "discover";
    dialog.showModal();
  });
  await expect(drawer).toBeVisible();
  await expect.poll(async () => {
    const box = await drawer.boundingBox();
    return {
      right: Math.round(box.x + box.width),
      top: Math.round(box.y),
      height: Math.round(box.height),
    };
  }).toEqual({ right: 390, top: 0, height: 844 });
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).not.toBeVisible();
});

test("feed filter descriptions follow the selected subject", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("material-picker:feeds", JSON.stringify({
      feeds: [{ id: "tech-feed", title: "Tech Feed", url: "https://tech.example/feed", folderIds: ["tech"] }],
      folders: [{ id: "tech", name: "Tech" }],
      favoriteFolderIds: ["tech"],
      items: [{ id: "tech-story", feedId: "tech-feed", title: "A tech story", publishedAt: "2026-10-31T10:00:00Z" }],
      read: { "tech-story": true },
      archived: {},
    }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#desk-feeds").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Show Tech feeds" }).click();

  const hint = page.locator("#feedsSortHint");
  await expect(hint).toHaveText("Tech posts, newest first. Read posts are muted.");
  await page.getByRole("button", { name: "Busiest" }).click();
  await expect(hint).toHaveText("Sources with the most posts in Tech first — based on this view.");
  await page.getByRole("button", { name: "Read" }).click();
  await expect(hint).toHaveText("Tech posts you’ve read, newest first.");
});
