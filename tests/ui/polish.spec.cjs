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

test("tablet library search stays compact and opens suggestions below the field", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");

  const search = page.locator(".workspace-nav .nav-search");
  const searchBox = await search.boundingBox();
  expect(searchBox.width).toBeLessThanOrEqual(672);
  expect(searchBox.height).toBeLessThanOrEqual(48);
  expect(searchBox.y + searchBox.height).toBeLessThan(150);

  await page.locator("#searchFeedSuggest").evaluate((list) => {
    list.innerHTML = '<li role="option"><button type="button">Example feed</button></li>';
    list.hidden = false;
  });
  const suggestionBox = await page.locator("#searchFeedSuggest").boundingBox();
  expect(suggestionBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
  expect(suggestionBox.height).toBeLessThan(100);
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
  await page.locator("#desk-feeds").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

test("mobile topic pills expand to additional catalog topics and scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#desk-feeds").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#feedsAddDialog").evaluate((dialog) => dialog.showModal());
  await page.evaluate(() => loadDirectory());

  const topics = page.locator("#feedTopics");
  const toggle = page.locator("#feedTopicsToggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("data-direction", "down");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Add custom topic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Design", exact: true })).toBeHidden();
  const compactSize = await topics.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(compactSize.overflowY).toBe("auto");
  const [topicsBox, addBox] = await Promise.all([
    topics.boundingBox(),
    page.getByRole("button", { name: "Add custom topic" }).boundingBox(),
  ]);
  expect(addBox.y + addBox.height).toBeLessThanOrEqual(topicsBox.y + topicsBox.height);

  await toggle.click();
  await expect(toggle).toHaveAttribute("data-direction", "up");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Design", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "EVs & Auto", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Music", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(page.getByRole("button", { name: "Design", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Add custom topic" }).click();
  await page.locator("#feedTopicCustomInput").fill("Climate");
  await page.locator("#feedTopicCustomForm").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Climate", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("material-picker:custom-feed-topics"))).toContain("Climate");
});

test("mobile feeds use a compact two-row header and slide panel", async ({ page }) => {
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
  expect(headerBox.height).toBeLessThanOrEqual(108);
  expect(Math.abs(discoverBox.y - settingsBox.y)).toBeLessThanOrEqual(1);
  expect(discoverBox.height).toBeGreaterThanOrEqual(44);
  expect(settingsBox.width).toBeGreaterThanOrEqual(44);
  expect(settingsBox.height).toBeGreaterThanOrEqual(44);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
  await expect(page.locator(".feeds-reeder-actions")).toHaveCSS("position", "static");
  await expect(page.locator("#feedsSortHint")).toHaveCSS("position", "absolute");
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

test("desktop YouTube subscription actions do not collide and Manage exposes channel controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("material-picker:v1", JSON.stringify({
      videos: [],
      collections: [],
      youtubeFavoriteChannels: ["UC111"],
      youtubeRemovedChannels: ["UC333"],
      youtubeSubFilter: "latest",
    }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("#desk-youtube").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => {
    renderYouTubeHome({
      channels: [
        { id: "UC111", title: "Fstoppers", thumbnail: "" },
        { id: "UC222", title: "Duncan Rogoff | Learn Claude Code With A Very Long Channel Name", thumbnail: "" },
        { id: "UC333", title: "Hidden Channel", thumbnail: "" },
      ],
      subscriptions: [
        { channelId: "UC111", speaker: "Fstoppers", publishedAt: "2026-11-03T10:00:00Z", url: "https://example.test/1" },
        { channelId: "UC222", speaker: "Duncan Rogoff", publishedAt: "2026-11-02T10:00:00Z", url: "https://example.test/2" },
      ],
      playlists: [],
      liked: [],
      activity: [],
    });
  });

  const titleRow = page.locator(".yt-subs-header-left");
  const actionRow = page.locator(".yt-subs-header-actions");
  const [titleBox, actionBox] = await Promise.all([titleRow.boundingBox(), actionRow.boundingBox()]);
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(actionBox.y);

  const manage = page.locator("[data-youtube-manage-subs]");
  await expect(page.locator("[data-youtube-restore-subs]")).toHaveText("Restore (1)");
  await expect(page.locator('[data-youtube-sub-filter="latest"]')).toHaveCount(0);
  await expect(page.locator('[data-youtube-sub-filter="new"]')).toBeVisible();
  await expect(page.locator(".yt-channel-actions")).toHaveCount(0);
  await manage.click();
  await expect(page.locator("[data-youtube-manage-subs]")).toHaveText("Done");
  await expect(page.locator("[data-youtube-manage-subs]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-youtube-manage-subs]")).toBeFocused();
  await expect(page.locator(".yt-subs-manage-hint")).toBeVisible();
  await expect(page.locator(".yt-channel-actions").first()).toHaveCSS("opacity", "1");
  await expect(page.locator(".yt-channel-name").first()).toHaveCSS("padding-right", "60.8px");

  const railBox = await page.locator(".yt-rail").boundingBox();
  const longChannelActions = page.locator('[data-channel-item-id="UC222"] .yt-channel-actions');
  const actionsBox = await longChannelActions.boundingBox();
  expect(actionsBox.x).toBeGreaterThanOrEqual(railBox.x);
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(railBox.x + railBox.width);

  const favouriteLongChannel = page.locator('[data-youtube-toggle-fav="UC222"]');
  const removeLongChannel = page.locator('[data-youtube-remove-channel="UC222"]');
  await expect(favouriteLongChannel).toBeVisible();
  await expect(removeLongChannel).toBeVisible();
  await favouriteLongChannel.click();
  await expect(page.locator('[data-youtube-toggle-fav="UC222"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-youtube-remove-channel="UC222"]').click();
  await expect(page.locator('[data-channel-item-id="UC222"]')).toHaveCount(0);
  await expect(page.locator("[data-youtube-restore-subs]")).toHaveText("Restore (2)");

  await page.locator("[data-youtube-manage-subs]").click();
  await expect(page.locator("[data-youtube-manage-subs]")).toHaveText("Manage");
  await expect(page.locator("[data-youtube-manage-subs]")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".yt-subs-manage-hint")).toHaveCount(0);
  await expect(page.locator(".yt-channel-actions")).toHaveCount(0);
});

test("desktop fullscreen player keeps a clear minimize control visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    const shell = document.querySelector(".player-shell");
    const embed = document.querySelector("#embedPlayer");
    shell.dataset.mode = "embed";
    embed.setAttribute("src", "about:blank");
    livePlayback = true;
    returnFromPlayBubble();
  });

  const minimize = page.locator("#playerFullscreenExit");
  await expect(minimize).toBeVisible();
  await expect(minimize).toContainText("Minimize");
  await expect(minimize).toContainText("Esc");
  const box = await minimize.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs((box.x + box.width / 2) - 720)).toBeLessThanOrEqual(2);

  await minimize.click();
  await expect(page.locator("body")).not.toHaveClass(/is-player-fullscreen/);
  await expect(minimize).toBeHidden();
});

test("mobile YouTube channel carousel responds to a native horizontal swipe", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const videos = Array.from({ length: 7 }, (_, index) => ({
    channelId: "UC_TOUCH",
    speaker: "Touch channel",
    title: `Carousel video ${index + 1}`,
    publishedAt: `2026-11-0${Math.min(index + 1, 9)}T10:00:00Z`,
    url: `https://example.test/touch-${index + 1}`,
  }));

  await page.route("**/api/youtube/channel?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ results: videos }),
  }));
  await page.goto("/");
  await page.locator("#desk-youtube").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate((channelVideos) => {
    renderYouTubeHome({
      channels: [{ id: "UC_TOUCH", title: "Touch channel", thumbnail: "" }],
      subscriptions: channelVideos,
      playlists: [],
      liked: [],
      activity: [],
    });
  }, videos);
  await expect(page.locator('[data-youtube-sub-filter="latest"]')).toHaveCount(0);
  await expect(page.locator('[data-youtube-sub-filter="new"]')).toBeVisible();
  await expect(page.locator(".yt-channel-actions")).toHaveCount(0);
  await page.locator('[data-youtube-channel="UC_TOUCH"]').first().evaluate((button) => button.click());
  await expect(page.locator("[data-youtube-manage-subs]")).toHaveText("Manage");
  await expect(page.locator(".yt-channel-actions")).toHaveCount(0);

  const track = page.locator(".yt-carousel-track");
  await expect(track).toBeVisible();
  await track.scrollIntoViewIfNeeded();
  await expect(track.locator(".yt-card-content").first()).toHaveCSS("touch-action", "auto");

  const next = page.locator(".yt-carousel-next");
  const nextBox = await next.boundingBox();
  expect(nextBox.width).toBeGreaterThanOrEqual(44);
  expect(nextBox.height).toBeGreaterThanOrEqual(44);
  expect(await next.evaluate((button) => getComputedStyle(button, "::after").display)).toBe("none");

  const box = await track.boundingBox();
  const startX = box.x + Math.min(box.width - 30, 250);
  const endX = box.x + 35;
  const y = box.y + Math.min(90, box.height / 3);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y }],
  });
  for (let step = 1; step <= 5; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX + ((endX - startX) * step) / 5, y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
  await context.close();
});
