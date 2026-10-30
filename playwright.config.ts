import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "mobile-360", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 360, height: 800 } } },
    { name: "mobile-430", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 430, height: 932 } } },
    ...(["firefox", "webkit"] as const).flatMap(browserName => [
      { name: `${browserName}-desktop`, use: { browserName, viewport: { width: 1440, height: 1000 } } },
      { name: `${browserName}-tablet`, use: { browserName, viewport: { width: 820, height: 1180 } } },
      ...[360, 390, 430].map(width => ({ name: `${browserName}-${width}`, use: { browserName, viewport: { width, height: 844 } } })),
    ]),
  ],
  webServer: { command: "npm run start", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
