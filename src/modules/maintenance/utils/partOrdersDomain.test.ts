import { describe, expect, it } from "vitest";
import type { MaintenancePartOrder, MaintenancePartOrderLine } from "../../../types/maintenance";
import {
  applyPartOrderPreferences,
  buildOrderedPartHistory,
  calculateClientOfferTotal,
  calculateSupplierOfferTotal,
  getPartOrderDisplayAmount,
  getPartOrderVisualState,
  uniqueOrderedPartNames,
} from "./partOrdersDomain";

const line = (patch: Partial<MaintenancePartOrderLine> = {}): MaintenancePartOrderLine => ({
  id: "line-1",
  name: "Contactor",
  code: "C1",
  quantity: 2,
  unit: "buc",
  supplier: "Furnizor A",
  estimatedPrice: 10,
  supplierOfferUnitPrice: 12,
  clientOfferUnitPrice: 20,
  notes: "",
  ...patch,
});

const order = (patch: Partial<MaintenancePartOrder> = {}): MaintenancePartOrder => ({
  id: "order-1",
  companyId: "company-1",
  title: "Comanda test",
  status: "ordered",
  priority: "normal",
  clientId: "client-1",
  clientName: "Client",
  addressLabel: "Adresa",
  liftSerialNumber: "123",
  requestedByUserId: "user-1",
  requestedByUserName: "User",
  notifyUserId: "",
  notifyUserName: "",
  reminderIntervalMinutes: 30,
  notificationSeenAt: null,
  notificationSeenByUserId: "",
  notificationSeenByUserName: "",
  neededByDate: "",
  supplierName: "Furnizor A",
  supplierContact: "",
  supplierEmail: "supplier@example.com",
  orderNumber: "",
  clientEmail: "client@example.com",
  supplierEmailSentAt: null,
  supplierEmailSentByUserId: "",
  supplierEmailSentByUserName: "",
  supplierQuoteReceivedAt: null,
  supplierQuoteReceivedByUserId: "",
  supplierQuoteReceivedByUserName: "",
  supplierOfferAmount: 24,
  orderedAt: 200,
  orderedByUserId: "user-1",
  orderedByUserName: "User",
  clientOfferEmailSentAt: null,
  clientOfferEmailSentByUserId: "",
  clientOfferEmailSentByUserName: "",
  clientOfferAmount: 40,
  clientOfferNotes: "",
  clientOfferAttachment: null,
  resolvedAt: null,
  resolvedByUserId: "",
  resolvedByUserName: "",
  lastReminderAt: null,
  nextReminderAt: null,
  notes: "",
  lines: [line()],
  totalEstimated: 20,
  createdAt: 100,
  updatedAt: 200,
  ...patch,
});

describe("partOrdersDomain", () => {
  it("keeps ordered parts in history even after installation", () => {
    const history = buildOrderedPartHistory([order({ status: "installed", orderedAt: 150 })]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ clientName: "Client", orderedAt: 150 });
  });

  it("does not include requests that were never ordered", () => {
    expect(buildOrderedPartHistory([order({ status: "requested", orderedAt: null })])).toEqual([]);
  });

  it("builds unique suggestions from ordered history", () => {
    expect(uniqueOrderedPartNames([order(), order({ id: "order-2" })])).toEqual(["Contactor"]);
  });

  it("keeps supplier and client prices separate", () => {
    expect(calculateSupplierOfferTotal([line()])).toBe(24);
    expect(calculateClientOfferTotal([line()])).toBe(40);
  });

  it("shows supplier offer total after quote is received", () => {
    expect(getPartOrderDisplayAmount(order({ status: "quote_received", supplierOfferAmount: 123 }))).toEqual({
      amount: 123,
      label: "oferta furnizor",
    });
  });

  it("shows client offer total after client offer was sent", () => {
    expect(getPartOrderDisplayAmount(order({ clientOfferEmailSentAt: 300, clientOfferAmount: 250 }))).toEqual({
      amount: 250,
      label: "oferta client",
    });
  });

  it("maps order visual states for stronger highlighting", () => {
    expect(getPartOrderVisualState(order({ status: "requested", priority: "normal" }))).toBe("waiting");
    expect(getPartOrderVisualState(order({ status: "requested", priority: "urgent" }))).toBe("urgent");
    expect(getPartOrderVisualState(order({ status: "quote_received", priority: "normal" }))).toBe("quoted");
    expect(getPartOrderVisualState(order({ status: "ordered", priority: "normal" }))).toBe("ordered");
    expect(getPartOrderVisualState(order({ status: "installed", priority: "urgent" }))).toBe("resolved");
  });

  it("applies personal defaults without overwriting entered values", () => {
    const result = applyPartOrderPreferences(
      {
        supplierName: "",
        supplierContact: "0722",
        supplierEmail: "",
        lines: [line({ name: "", supplier: "" })],
      },
      {
        supplierName: "Furnizor salvat",
        supplierContact: "0733",
        supplierEmail: "salvat@example.com",
        lineSupplier: "Furnizor piesa",
        lastPartName: "Role usa",
      }
    );

    expect(result).toMatchObject({
      supplierName: "Furnizor salvat",
      supplierContact: "0722",
      supplierEmail: "salvat@example.com",
    });
    expect(result.lines[0]).toMatchObject({ name: "Role usa", supplier: "Furnizor piesa" });
  });
});
