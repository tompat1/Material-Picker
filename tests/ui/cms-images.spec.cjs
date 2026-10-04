const { test, expect } = require("@playwright/test");
const path = require("node:path");

test("CMS image preview, crop draft, upload, and reload work end to end", async ({ page }) => {
  let cms = { copy: {}, shop: {} };
  let mediaUploads = 0;
  const savedPatches = [];

  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { email: "tremdia@gmail.com", admin: true } }),
  }));
  await page.route("**/api/cms/media", async (route) => {
    mediaUploads += 1;
    expect(route.request().headers()["content-type"]).toBe("image/jpeg");
    expect((await route.request().postDataBuffer()).byteLength).toBeGreaterThan(0);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "/api/cms/media/image-test-1234" }),
    });
  });
  await page.route("**/api/cms", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cms) });
      return;
    }
    const patch = JSON.parse(route.request().postData() || "{}");
    savedPatches.push(patch);
    cms = {
      copy: { ...cms.copy, ...(patch.copy || {}) },
      shop: { ...cms.shop },
    };
    for (const [id, fields] of Object.entries(patch.shop || {})) {
      cms.shop[id] = { ...(cms.shop[id] || {}), ...fields };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cms) });
  });

  await page.goto("/");
  await page.locator("#shopNav").click();
  await page.locator("#cmsEdit").click();

  let card = page.locator('[data-shop-product="hoodie-black"]');
  const input = card.locator("[data-cms-image]");
  await input.setInputFiles(path.join(__dirname, "../../public/merch/cap.jpg"));
  await expect(card.locator("[data-cms-image-status]")).toContainText("Ready");
  await expect(card.locator(".shop-photo")).toHaveAttribute("src", /^blob:/);

  await card.locator('[data-cms-prop="imageZoom"]').fill("1.75");
  await card.locator('[data-cms-prop="imageX"]').fill("25");
  await card.locator('[data-cms-prop="imageY"]').fill("70");
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-x: 25%/);
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-y: 70%/);
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-zoom: 1.75/);

  await page.getByRole("button", { name: "Apparel", exact: true }).click();
  card = page.locator('[data-shop-product="hoodie-black"]');
  await expect(card.locator(".shop-photo")).toHaveAttribute("src", /^blob:/);
  await expect(card.locator('[data-cms-prop="imageZoom"]')).toHaveValue("1.75");
  await expect(card.locator('[data-cms-prop="imageX"]')).toHaveValue("25");
  await expect(card.locator('[data-cms-prop="imageY"]')).toHaveValue("70");

  await page.locator("#cmsEdit").click();
  await expect(page.locator("#cmsEdit")).toHaveText("Edit");
  expect(mediaUploads).toBe(1);
  expect(savedPatches.at(-1).shop["hoodie-black"]).toEqual({
    imageZoom: 1.75,
    imageX: 25,
    imageY: 70,
    image: "/api/cms/media/image-test-1234",
  });

  await page.reload();
  await page.locator("#shopNav").click();
  card = page.locator('[data-shop-product="hoodie-black"]');
  await expect(card.locator(".shop-photo")).toHaveAttribute("src", "/api/cms/media/image-test-1234");
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-x:25%/);
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-y:70%/);
  await expect(card.locator(".shop-photo")).toHaveAttribute("style", /--shop-image-zoom:1.75/);
});
