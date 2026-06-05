import { http } from "./api";
import { EP } from "./endpoints";

export type RfidKind = "card" | "tool";

export type RfidScan = {
  card_id?: string;
  tag_id?: string;
  uid?: string;
  ts?: string;
};

export type CatalogRow = {
  tool_model_id: string;
  name: string;
  category?: string;
  description?: string;
  total: number;
  available: number;
  checked_out: number;
};

export type DispenseBatchResp = {
  batch_id: string;
  request_ids: string[];
};

export type BatchStatusItem = {
  request_id: string;
  hw_status: string;
  stage?: string;
};

export type BatchStatusResp = {
  batch_id: string;
  items: BatchStatusItem[];
};

export type LoanRow = {
  loan_id: string;
  tool_item_id: string;
  tool_model_id: string;
  tool_name: string;
  tool_tag_id: string;
  issued_at: string;
  due_at: string;
  returned_at?: string;
  status: string;
};

export const apiUser = {
  // RFID
  rfidSetMode: (req: { reader_id: string; mode: RfidKind }) =>
    http<{ ok: boolean }>(EP.rfidSetMode, { method: "POST", json: req }),

  rfidConsume: (readerId: string, kind: RfidKind) =>
    http<{ ok: boolean; scan: RfidScan | null }>(
      EP.rfidConsume(readerId, kind)
    ),

  // Auth
  authCard: (req: { card_id: string }) =>
    http(EP.authSessionCard, { method: "POST", json: req }),

  sessionMe: () => http(EP.authSessionMe),
  logout: () => http(EP.authSessionLogout, { method: "POST" }),

  // Catalog
  catalog: () => http<CatalogRow[]>(EP.catalog),

  // Dispense
  dispense: (req: any) =>
    http<DispenseBatchResp>(EP.dispense, { method: "POST", json: req }),

  dispenseStatus: (batchId: string) =>
    http<BatchStatusResp>(EP.dispenseStatus(batchId)),

  dispenseConfirmRequest: (id: string) =>
    http(EP.dispenseRequestConfirm(id), { method: "POST" }),

  dispenseCancelRequest: (id: string) =>
    http(EP.dispenseRequestCancel(id), { method: "POST" }),

  // Loans
  loans: () => http<{ loans: LoanRow[] }>(EP.loans),

  // Return
  doReturn: (req: any) =>
    http(EP.doReturn, { method: "POST", json: req }),

  returnStatus: (batchId: string) =>
    http<BatchStatusResp>(EP.returnStatus(batchId)),

  returnConfirmRequest: (id: string) =>
    http(EP.returnRequestConfirm(id), { method: "POST" }),

  returnCancelRequest: (id: string) =>
    http(EP.returnRequestCancel(id), { method: "POST" }),
};