import { defineConfig, devices } from "@playwright/test";

const usesFirebaseEmulators = process.env.WORKCONTROL_E2E_EMULATOR === "true";
const appPort = usesFirebaseEmulators ? Number(process.env.WORKCONTROL_E2E_PORT || 6037) : 5173;
const appUrl = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: !usesFirebaseEmulators,
  workers: usesFirebaseEmulators ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: appUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${appPort}`,
    url: appUrl,
    env: {
      VITE_USE_FIREBASE_EMULATORS: usesFirebaseEmulators ? "true" : "false",
    },
    reuseExistingServer: !process.env.CI && !usesFirebaseEmulators,
    timeout: 120_000,
  },
});
