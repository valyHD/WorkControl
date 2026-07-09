import type { ProjectItem } from "./timesheet";

export type ExpenseDocumentKind = "bon" | "factura" | "chitanta" | "proforma" | "other";

export interface ExpenseLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ExpenseAiAnalysis {
  documentKind: ExpenseDocumentKind;
  supplierName: string;
  supplierTaxId: string;
  buyerCompanyName: string;
  buyerTaxId: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  currency: string;
  subtotalAmount: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: string;
  expenseCategory: string;
  projectHint: string;
  userHint: string;
  companyHint: string;
  lineItems: ExpenseLineItem[];
  confidence: number;
  notes: string;
}

export interface ExpenseDocumentItem extends ExpenseAiAnalysis {
  id: string;
  fileName: string;
  fileUrl: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  extension: string;
  uploadedByUserId: string;
  uploadedByUserName: string;
  assignedUserId: string;
  assignedUserName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  companyName: string;
  reimbursable: boolean;
  yearMonth: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExpenseFilters {
  yearMonth: string;
  userId: string;
  projectId: string;
  companyName: string;
  supplierName: string;
  documentKind: ExpenseDocumentKind | "";
  reimbursable: "" | "yes" | "no";
}

export type ExpenseProjectOption = Pick<ProjectItem, "id" | "code" | "name" | "status">;

export interface ExpenseCompanyOption {
  id: string;
  companyName: string;
  companyKey: string;
}

export interface ExpenseFormPreference {
  assignedUserId: string;
  projectId: string;
  companyName: string;
}

export interface ExpenseFileDraft {
  fileName: string;
  fileUrl: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  extension: string;
}

export interface ExpenseDocumentPayload extends ExpenseAiAnalysis {
  fileName: string;
  fileUrl: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  extension: string;
  uploadedByUserId: string;
  uploadedByUserName: string;
  assignedUserId: string;
  assignedUserName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  companyName: string;
  reimbursable: boolean;
}

export interface ExpenseSummary {
  count: number;
  total: number;
  subtotal: number;
  vat: number;
  reimbursableTotal: number;
  reimbursableVat: number;
  supplierCount: number;
  invoiceCount: number;
  receiptCount: number;
}
