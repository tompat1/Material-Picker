const { defineConfig } = require("@playwright/test");

const port = 4180;
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "./tests/ui",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "node server.js",
    url: baseURL,
    env: { PORT: String(port), NODE_ENV: "development" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
