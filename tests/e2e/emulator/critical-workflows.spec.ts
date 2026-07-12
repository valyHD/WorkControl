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
      headers: firestoreHeaders(),
      data: { fields: toFirestoreFields(data) },
    }
  );
  expect(response.ok(), await response.text()).toBe(true);
}

async function listDocuments(request: APIRequestContext, collection: string) {
  const response = await request.get(`${firestoreBaseUrl}/${collection}`, {
    headers: firestoreHeaders(),
  });
  if (response.status() === 404) return [];
  expect(response.ok(), await response.text()).toBe(true);
  const payload = (await response.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, FirestoreValue> }>;
  };
  return payload.documents || [];
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
      role: "admin",
      roleTitle: "Tehnician lifturi",
      department: "Service si Intretinere Lifturi",
      primaryCompanyName: "Companie E2E",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await putDocument(request, "vehicles", "vehicle-e2e", {
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
    await expect(page.getByText("Ce se întâmplă azi în firmă")).toBeVisible();
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Căutare globală" })).toBeVisible();
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
  });
});
