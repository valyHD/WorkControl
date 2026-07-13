import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let server: Server;
let origin = "";
let deployedVersion = 1;

const workerTemplate = readFileSync(resolve(process.cwd(), "public", "notification-sw.js"), "utf8")
  .replace(
    "https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js",
    "/firebase-app-compat.js"
  )
  .replace(
    "https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js",
    "/firebase-messaging-compat.js"
  );

function html(version: number) {
  return `<!doctype html>
    <html>
      <body>
        <main id="app">Se incarca</main>
        <button id="apply-update" type="button">Aplica update</button>
        <script>
          navigator.serviceWorker.register('/notification-sw.js', {
            scope: '/',
            updateViaCache: 'none'
          });

          document.getElementById('apply-update').addEventListener('click', async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration || !registration.waiting) throw new Error('Worker-ul nou nu asteapta confirmarea.');

            const controllerChanged = new Promise((resolve) => {
              navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            });
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            await controllerChanged;
            window.location.replace('/?wc_reload=' + Date.now());
          });
        </script>
        <script type="module" src="/assets/app-v${version}.js"></script>
      </body>
    </html>`;
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/notification-sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`/* deploy-${deployedVersion} */\n${workerTemplate}`);
      return;
    }

    if (url.pathname === "/firebase-app-compat.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        "self.firebase={initializeApp(){},messaging(){return {onBackgroundMessage(){}}}};"
      );
      return;
    }

    if (url.pathname === "/firebase-messaging-compat.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("");
      return;
    }

    if (url.pathname === "/manifest.webmanifest") {
      response.setHeader("Content-Type", "application/manifest+json");
      response.end(JSON.stringify({ name: "WorkControl PWA test" }));
      return;
    }

    if (url.pathname === `/assets/app-v${deployedVersion}.js`) {
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        `document.body.dataset.appVersion='${deployedVersion}';` +
          `document.getElementById('app').textContent='Versiunea ${deployedVersion}';`
      );
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html(deployedVersion));
      return;
    }

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html(deployedVersion));
  });

  await new Promise<void>((resolveReady) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Port PWA indisponibil.");
      origin = `http://127.0.0.1:${address.port}`;
      resolveReady();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
});

test("upgrade-ul asteapta confirmarea, reincarca versiunea noua si ramane disponibil offline", async ({
  page,
  context,
}) => {
  deployedVersion = 1;
  await page.goto(origin);
  await expect(page.locator("#app")).toHaveText("Versiunea 1");
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.getRegistration())?.active)
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  deployedVersion = 2;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });

  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.getRegistration())?.waiting)
  );
  await expect(page.locator("#app")).toHaveText("Versiunea 1");

  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Aplica update" }).click(),
  ]);
  await expect(page.locator("#app")).toHaveText("Versiunea 2");
  await expect(page.locator("body")).toHaveAttribute("data-app-version", "2");

  const badAssetWasCached = await page.evaluate(async () => {
    try {
      await import("/assets/does-not-exist.js");
    } catch {
      // Firebase Hosting returns the SPA shell for a missing asset; the browser rejects it as JavaScript.
    }
    const cache = await caches.open("workcontrol-static-v2");
    return Boolean(await cache.match("/assets/does-not-exist.js"));
  });
  expect(badAssetWasCached).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#app")).toHaveText("Versiunea 2");
});
