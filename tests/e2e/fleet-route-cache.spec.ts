import { expect, test } from "@playwright/test";

test("persists and restores a fleet route snapshot in IndexedDB", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  });
  await page.reload();

  const result = await page.evaluate(async () => {
    const module = await import(
      "/src/modules/vehicles/services/fleetRoutePersistentCache.ts"
    );
    const key = `e2e:${Date.now()}`;
    const points = Array.from({ length: 120 }, (_, index) => ({
      id: `point-${index}`,
      vehicleId: "vehicle-e2e",
      lat: 44 + index / 100_000,
      lng: 26 + index / 100_000,
      speedKmh: 30,
      gpsTimestamp: index + 1,
      serverTimestamp: index + 1,
    }));

    await module.fleetRoutePersistentCache.write(key, points);
    const restored = await module.fleetRoutePersistentCache.read(key);
    await module.fleetRoutePersistentCache.remove(key);

    return {
      count: restored?.length ?? 0,
      firstId: restored?.[0]?.id,
      lastId: restored?.at(-1)?.id,
    };
  });

  expect(result).toEqual({
    count: 120,
    firstId: "point-0",
    lastId: "point-119",
  });
});
