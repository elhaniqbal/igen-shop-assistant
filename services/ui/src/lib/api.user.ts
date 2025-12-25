import { http } from "./api";
import { EP } from "./endpoints";

export type RfidKind = "card" | "tool";

export type RfidSetModeReq = { reader_id: string; mode: RfidKind };
export type RfidScan = { tag_id?: string; uid?: string; ts?: string; reader_id?: string };
export type RfidConsumeResp = { ok: boolean; scan: RfidScan | null };

export type CardAuthReq = { card_id: string };
export type CardAuthResp = { user_id: string; first_name: string; last_name: string; role: string };

export type DispenseItemReq = { tool_model_id: string; qty: number };
export type DispenseBatchReq = { user_id: string; items: DispenseItemReq[]; loan_period_hours: number };
export type DispenseBatchResp = { batch_id: string; request_ids: string[] };

export type HwStatus =
  | "pending"
  | "accepted"
  | "in_progress"
  | "dispensed_ok"
  | "confirmed"
  | "pickup_mismatch"
  | "return_ok"
  | "failed";


export type BatchStatusItem = {
  request_id: string;
  request_type?: "dispense" | "return"; // your get_batch_status returns this
  tool_item_id?: string;
  slot_id?: string;
  hw_status: HwStatus;
  hw_error_code?: string | null;
  hw_error_reason?: string | null;
  created_at?: string;
  hw_updated_at?: string | null;
};

export type BatchStatusResp = { batch_id: string; items: BatchStatusItem[] };

// maps to POST /rfid/tool-confirm in your backend
export type DispenseConfirmReq = { user_id: string; tool_tag_id: string };
export type DispenseConfirmResp = { ok: boolean; loan_id?: string; tool_item_id?: string };

export type LoanRow = {
  loan_id: string;

  tool_item_id: string;

  // NEW (for UI)
  tool_model_id: string;
  tool_name: string;
  tool_category?: string | null;

  // NEW (for return validation; do NOT display)
  tool_tag_id: string;

  issued_at: string;
  due_at: string;
  confirmed_at?: string | null;
  returned_at?: string | null;
  status: string;
};

export type LoansResp = { user_id: string; loans: LoanRow[] };

export type ReturnItemReq = { tool_item_id: string };
export type ReturnBatchReq = { user_id: string; items: ReturnItemReq[] };
export type ReturnBatchResp = { batch_id: string; request_ids: string[] };

export const apiUser = {
  rfidSetMode: (req: RfidSetModeReq) =>
    http<{ ok: boolean }>(EP.rfidSetMode, { method: "POST", json: req }),

  rfidConsume: (readerId: string, kind: RfidKind) =>
    http<RfidConsumeResp>(EP.rfidConsume(readerId, kind)),

  authCard: (req: CardAuthReq) =>
    http<CardAuthResp>(EP.authCard, { method: "POST", json: req }),

  dispense: (req: DispenseBatchReq) =>
    http<DispenseBatchResp>(EP.dispense, { method: "POST", json: req }),

  dispenseStatus: (batchId: string) =>
    http<BatchStatusResp>(EP.dispenseStatus(batchId)),

  dispenseConfirm: (req: DispenseConfirmReq) =>
    http<DispenseConfirmResp>(EP.dispenseConfirm, { method: "POST", json: req }),

  loans: (userId: string) =>
    http<LoansResp>(EP.loans(userId)),

  doReturn: (req: ReturnBatchReq) =>
    http<ReturnBatchResp>(EP.doReturn, { method: "POST", json: req }),

  returnStatus: (batchId: string) =>
    http<BatchStatusResp>(EP.returnStatus(batchId)),
};
