import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const useEmulator = process.env.WORKCONTROL_E2E_EMULATOR === "true";
const projectId = "demo-workcontrol";
const authBaseUrl = "http://127.0.0.1:9099";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const firestoreResetUrl = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`;
const authResetUrl = `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`;
const testEmail = "critical-workflows@example.test";
const testPassword = "WorkControl-Test-2026!";

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

let testUserId = "";
let authToken = "";

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function firestoreHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

async function putDocument(
  request: APIRequestContext,
  collection: string,
  documentId: string,
  data: Record<string, unknown>
) {
  const response = await request.patch(
    `${firestoreBaseUrl}/${collection}/${encodeURIComponent(documentId)}`,
    {
      headers: { Authorization: "Bearer owner" },
      data: { fields: toFirestoreFields(data) },
    }
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function listDocuments(request: APIRequestContext, collection: string) {
  const response = await request.get(`${firestoreBaseUrl}/${collection}`, {
    // Assertions inspect isolated emulator state without weakening production rules.
    headers: { Authorization: "Bearer owner" },
  });
  if (response.status() === 404) return [];
  expect(response.ok(), await response.text()).toBe(true);
  const payload = (await response.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, FirestoreValue> }>;
  };
  return payload.documents || [];
}

async function deleteCollectionDocuments(request: APIRequestContext, collection: string) {
  const documents = await listDocuments(request, collection);
  await Promise.all(
    documents.map(async (document) => {
      const documentId = document.name.split("/").at(-1);
      if (!documentId) return;
      const response = await request.delete(
        `${firestoreBaseUrl}/${collection}/${encodeURIComponent(documentId)}`,
        { headers: { Authorization: "Bearer owner" } }
      );
      expect(response.ok(), await response.text()).toBe(true);
    })
  );
}

function fieldString(document: { fields?: Record<string, FirestoreValue> }, key: string) {
  const value = document.fields?.[key];
  if (!value) return "";
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return value.integerValue;
  return "";
}

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("input[name='email']").fill(testEmail);
  await page.locator("input[name='password']").fill(testPassword);
  await page.getByRole("button", { name: "Conecteaza-te" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function confirmTimesheetPolicyIfVisible(page: Page) {
  const dialog = page.locator(".timesheet-policy-modal");
  if (await dialog.isVisible({ timeout: 750 }).catch(() => false)) {
    await dialog.locator("textarea").fill("Explicatie automata pentru testul emulatorului");
    await dialog.getByRole("button", { name: "Continua" }).click();
  }
}

test.describe("WorkControl critical workflows with Firebase Emulator", () => {
  test.skip(!useEmulator, "Ruleaza prin npm run test:e2e:emulator.");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    await request.delete(firestoreResetUrl);
    await request.delete(authResetUrl);

    const accountResponse = await request.post(
      `${authBaseUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
      {
        data: {
          email: testEmail,
          password: testPassword,
          displayName: "Utilizator E2E",
          returnSecureToken: true,
        },
      }
    );
    expect(accountResponse.ok(), await accountResponse.text()).toBe(true);
    const account = (await accountResponse.json()) as { localId: string; idToken: string };
    testUserId = account.localId;
    authToken = account.idToken;

    await putDocument(request, "users", testUserId, {
      uid: testUserId,
      fullName: "Utilizator E2E",
      email: testEmail,
      active: true,
      accessStatus: "active",
      role: "admin",
      globalAdmin: true,
      roleTitle: "Tehnician lifturi",
      department: "Service si Intretinere Lifturi",
      companyId: "company-e2e",
      companyIds: ["company-e2e"],
      companyNames: ["Companie E2E"],
      primaryCompanyId: "company-e2e",
      primaryCompanyName: "Companie E2E",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await putDocument(request, "firmeMentenanta", "company-e2e", {
      companyId: "company-e2e",
      companyKey: "company-e2e",
      companyName: "Companie E2E",
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await putDocument(request, "vehicles", "vehicle-e2e", {
      companyId: "company-e2e",
      plateNumber: "B99E2E",
      brand: "Dacia",
      model: "Logan Test",
      year: "2024",
      vin: "TESTVIN0000000001",
      fuelType: "benzina",
      status: "activa",
      currentKm: 6000,
      initialRecordedKm: 5900,
      ownerUserId: testUserId,
      ownerUserName: "Utilizator E2E",
      currentDriverUserId: testUserId,
      currentDriverUserName: "Utilizator E2E",
      maintenanceNotes: "",
      serviceStrategy: "interval",
      serviceIntervalKm: 15000,
      nextServiceKm: 21000,
      nextItpDate: "",
      nextRcaDate: "",
      nextCascoDate: "",
      nextRovinietaDate: "",
      nextOilServiceKm: 10000,
      coverImageUrl: "",
      coverThumbUrl: "",
      images: [],
      documents: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(firestoreResetUrl);
    await request.delete(authResetUrl);
  });

  test("new account registration creates a limited employee and requires company selection", async ({
    page,
    request,
  }) => {
    const registrationEmail = "self-registration@example.test";
    await page.goto("/login");
    await page.getByRole("tab", { name: "Cont nou" }).click();
    await page.getByLabel("Nume complet").fill("Angajat Inregistrat");
    await page.getByLabel("Email").fill(registrationEmail);
    await page.getByLabel("Parola", { exact: true }).fill(testPassword);
    await page.getByLabel("Confirma parola").fill(testPassword);
    await page.getByRole("button", { name: "Creeaza cont" }).click();

    await expect(page.getByRole("heading", { name: "Alege firma ta" })).toBeVisible();
    await page.locator("#initial-company").selectOption("company-e2e");
    await page.getByRole("button", { name: "Confirma firma" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await expect
      .poll(async () => {
        const users = await listDocuments(request, "users");
        return users.find((document) => fieldString(document, "email") === registrationEmail);
      })
      .toMatchObject({
        fields: expect.objectContaining({
          role: { stringValue: "angajat" },
          primaryCompanyId: { stringValue: "company-e2e" },
        }),
      });
  });

  test("login, project, timesheet, leave, maintenance client and vehicle mileage", async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:6037" });
    await context.setGeolocation({ latitude: 44.4268, longitude: 26.1025 });
    await page.route("https://nominatim.openstreetmap.org/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          display_name: "Strada Test, Bucuresti",
          address: { road: "Strada Test", house_number: "10", city: "Bucuresti" },
        }),
      });
    });

    await login(page);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Cautare globala" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/projects");
    await page.getByPlaceholder("Ex: Montaj lift A").fill("Proiect E2E Critic");
    await page.getByRole("button", { name: "Salveaza proiect" }).click();
    await expect
      .poll(async () =>
        (await listDocuments(request, "projects")).some(
          (document) => fieldString(document, "name") === "Proiect E2E Critic"
        )
      )
      .toBe(true);

    await page.goto("/my-timesheets");
    await page
      .locator("[data-assistant-action='change-timesheet-project']")
      .selectOption({ label: "Proiect E2E Critic" });
    await page.getByRole("button", { name: "Porneste pontaj" }).click();
    await confirmTimesheetPolicyIfVisible(page);
    await expect
      .poll(async () =>
        (await listDocuments(request, "timesheets")).some(
          (document) => fieldString(document, "status") === "activ"
        )
      )
      .toBe(true);

    await expect(page.getByRole("button", { name: "Opreste pontaj" })).toBeVisible();
    await page.getByRole("button", { name: "Opreste pontaj" }).click();
    await confirmTimesheetPolicyIfVisible(page);
    await expect
      .poll(async () =>
        (await listDocuments(request, "timesheets")).every(
          (document) => fieldString(document, "status") !== "activ"
        )
      )
      .toBe(true);

    await page.goto("/my-leave");
    await page.locator("[data-assistant-field='leave-start-date']").fill("2026-08-24");
    await page.locator("[data-assistant-field='leave-end-date']").fill("2026-08-30");
    await page.locator("[data-assistant-field='leave-reason']").fill("Concediu E2E");
    const signature = page.locator("[data-assistant-field='leave-signature']");
    const signatureBox = await signature.boundingBox();
    expect(signatureBox).not.toBeNull();
    await signature.evaluate((canvas) => {
      canvas.setPointerCapture = () => undefined;
      canvas.releasePointerCapture = () => undefined;
      canvas.hasPointerCapture = () => false;
    });
    await signature.dispatchEvent("pointerdown", {
      pointerId: 1,
      clientX: signatureBox!.x + 20,
      clientY: signatureBox!.y + 40,
      bubbles: true,
    });
    await page.waitForTimeout(80);
    await signature.dispatchEvent("pointermove", {
      pointerId: 1,
      clientX: signatureBox!.x + 80,
      clientY: signatureBox!.y + 70,
      bubbles: true,
    });
    await signature.dispatchEvent("pointermove", {
      pointerId: 1,
      clientX: signatureBox!.x + 130,
      clientY: signatureBox!.y + 35,
      bubbles: true,
    });
    await signature.dispatchEvent("pointerup", {
      pointerId: 1,
      clientX: signatureBox!.x + 130,
      clientY: signatureBox!.y + 35,
      bubbles: true,
    });
    await expect(signature).not.toHaveClass(/attention-pulse/);
    await page.getByRole("button", { name: "Trimite cererea" }).click();
    await expect(page.getByText(/Cererea a fost trimisa/i)).toBeVisible();
    await expect.poll(async () => (await listDocuments(request, "leaveRequests")).length).toBe(1);

    await page.goto("/maintenance?tab=clients&assistant=client");
    await page
      .locator("[data-assistant-field='maintenance-client-name']")
      .first()
      .fill("Client E2E");
    await page
      .locator("[data-assistant-field='maintenance-client-email']")
      .first()
      .fill("client@example.test");
    await page
      .locator("[data-assistant-field='maintenance-client-address']")
      .first()
      .fill("Strada Lift 1");
    await page
      .locator("[data-assistant-field='maintenance-client-lift-number']")
      .first()
      .fill("LIFT-E2E-1");
    await page.locator("[data-assistant-action='maintenance-save-client']").first().click();
    await expect
      .poll(async () =>
        (await listDocuments(request, "maintenanceClients")).some(
          (document) => fieldString(document, "name") === "Client E2E"
        )
      )
      .toBe(true);

    await page.goto("/vehicles/vehicle-e2e/edit");
    const currentKm = page.locator("#vehicle-currentKm");
    await expect(currentKm).toHaveValue("6000");
    await currentKm.fill("6616");
    await page.locator("button[data-assistant-action='save-vehicle']").click();
    await expect
      .poll(async () => {
        const response = await request.get(`${firestoreBaseUrl}/vehicles/vehicle-e2e`, {
          headers: firestoreHeaders(),
        });
        const document = (await response.json()) as { fields?: Record<string, FirestoreValue> };
        return fieldString(document, "currentKm");
      })
      .toBe("6616");

    // Server-side notification dispatch is asynchronous. Wait for the four workflow
    // notifications so the following serial visual test captures deterministic data.
    await expect.poll(async () => (await listDocuments(request, "notifications")).length).toBe(4);
  });

  test("product experience navigation, focus, responsive layout and GPS visual guard", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);

    await deleteCollectionDocuments(request, "notifications");
    await putDocument(request, "notifications", "notification-visual-e2e", {
      userId: testUserId,
      companyId: "company-e2e",
      title: "Actualizare WorkControl",
      message: "Notificare stabila pentru verificarea vizuala.",
      module: "general",
      eventType: "test",
      read: false,
      createdAt: 1_783_897_200_000,
    });

    const viewports = [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/dashboard");
      await expect(page.locator("main h1").first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Cauta in WorkControl" })).toBeHidden();
    await page.goto("/maintenance?tab=dashboard");
    const menuButton = page.getByRole("button", { name: "Deschide meniul" });
    await menuButton.click();
    await expect(page.locator(".mobile-drawer")).toHaveAttribute("aria-hidden", "false");
    const activeMobileNavigation = page.locator(".mobile-drawer .nav-item-active");
    await expect(activeMobileNavigation).toHaveAttribute("href", "/maintenance");
    await expect(activeMobileNavigation).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeFocused();

    await page.goto("/control-panel");
    await menuButton.click();
    const mobileNavigation = page.locator(".mobile-drawer-navigation");
    const mobileFooter = page.locator(".mobile-drawer-footer");
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileFooter.getByRole("link", { name: "Control Panel" })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Control Panel" })).toHaveCount(0);
    await expect(mobileNavigation.getByRole("link", { name: "Dashboard", exact: true })).toBeAttached();
    await mobileNavigation.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(mobileNavigation.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/vehicles/vehicle-e2e?tab=gps");
    await page.locator("#vehicle-tracker-live-section summary").click();
    const routeCard = page.locator(".vehicle-live-route-card");
    await expect(routeCard).toBeVisible();
    const routeCardWidth = await routeCard.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    expect(routeCardWidth).toBeGreaterThanOrEqual(370);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/control-panel#billing");
    await expect(page.getByRole("heading", { name: "Consum și costuri" })).toBeVisible();
    await page.getByRole("link", { name: "Economie GPS" }).click();
    await expect(page).toHaveURL(/\/control-panel#gps$/);
    await expect(page.getByRole("heading", { name: "Economie GPS și Firestore" })).toBeVisible();
    await page.getByRole("link", { name: "Backup", exact: true }).click();
    await expect(page).toHaveURL(/\/control-panel#backup$/);
    await expect(page.getByRole("heading", { name: "Export profesional backup" })).toBeVisible();
    await page
      .getByLabel("Secțiuni pagină")
      .getByRole("link", { name: "UI Lab", exact: true })
      .click();
    await expect(
      page.locator("#ui-lab").getByRole("heading", { name: "UI Lab", exact: true }),
    ).toBeVisible();

    await page.keyboard.press("Control+K");
    const commandDialog = page.getByRole("dialog", { name: "Cautare globala" });
    await expect(commandDialog).toBeVisible();
    await page.getByRole("textbox", { name: "Cauta" }).fill("ui lab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/control-panel\/ui-lab$/);
    await expect(page.locator(".wc-ui-lab")).toBeVisible();
    await expect(page.getByRole("heading", { name: "UI Lab" }).first()).toBeVisible();
    await page.waitForTimeout(100);

    const accessibility = await new AxeBuilder({ page }).include(".wc-ui-lab").analyze();
    expect(
      accessibility.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious"
      )
    ).toEqual([]);

    await expect(page).toHaveScreenshot("ui-lab-desktop.png", {
      animations: "disabled",
      fullPage: true,
      mask: [
        page.locator(".desktop-logout-btn").first(),
        page.locator("[data-assistant-action='open-assistant']"),
      ],
      maxDiffPixelRatio: 0.01,
    });

    const visualPages = [
      { path: "/dashboard", name: "dashboard-foundation.png" },
      { path: "/timesheets?view=overview", name: "timesheets-foundation.png" },
      { path: "/my-timesheets", name: "my-timesheets-foundation.png" },
      { path: "/maintenance?tab=dashboard", name: "maintenance-foundation.png" },
      { path: "/vehicles", name: "vehicles-foundation.png" },
      { path: "/users", name: "users-foundation.png" },
      { path: "/control-panel", name: "control-panel-foundation.png" },
    ];

    for (const visualPage of visualPages) {
      await page.goto(visualPage.path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page).toHaveScreenshot(visualPage.name, {
        animations: "disabled",
        fullPage: true,
        mask: [
          page.locator(".desktop-logout-btn").first(),
          page.locator("[data-assistant-action='open-assistant']"),
          page.locator(".today-strip"),
        ],
        maxDiffPixelRatio: 0.02,
      });
    }

    await page.goto("/timesheets?view=overview");
    await expect(
      page.getByRole("navigation", { name: "Sectiuni management pontaje" })
    ).toBeVisible();
    await page.getByRole("button", { name: /Active acum/ }).click();
    await expect(page).toHaveURL(/view=active/);
    await expect(page.getByText("Tabel avansat pontaje")).toBeVisible();

    await page.goto("/vehicles");
    await page.getByTitle("Afisare tabel").click();
    await expect(page.getByRole("columnheader", { name: "GPS" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Documente" })).toBeVisible();

    await page.goto("/notifications");
    await page.getByRole("button", { name: /Necitite/ }).click();
    await expect(page.getByRole("heading", { name: "Notificări" })).toBeVisible();

    await page.goto("/control-panel");
    await expect(page).toHaveURL(/\/control-panel$/);
    await expect(page.getByRole("link", { name: "Control Panel" })).toBeVisible();

    await page.goto("/vehicles/gps-map");
    await expect(page.getByRole("heading", { name: "Toate GPS-urile" }).first()).toBeVisible();
    await expect(page.getByText("Filtre hartă")).toHaveCount(0);
    await expect(page).toHaveScreenshot("fleet-gps-foundation.png", {
      animations: "disabled",
      fullPage: true,
      mask: [
        page.locator(".leaflet-tile-pane"),
        page.locator(".desktop-logout-btn").first(),
        page.locator("[data-assistant-action='open-assistant']"),
      ],
      maxDiffPixelRatio: 0.02,
    });
    const showRouteButtons = page.getByRole("button", { name: "Arată traseul" });
    await expect(showRouteButtons).toHaveCount(0);
    await expect(page.locator(".vehicle-fleet-map-card")).toHaveCount(1);
    await expect(page.locator(".vehicle-fleet-map-card__empty")).toBeVisible();
    await expect(page.getByText("Nu exista pozitie GPS.")).toBeVisible();
  });
});
