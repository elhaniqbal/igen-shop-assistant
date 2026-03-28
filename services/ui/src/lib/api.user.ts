import { http } from "./api";
import { EP } from "./endpoints";

export type RfidKind = "card" | "tool";
export type RfidSetModeReq = { reader_id: string; mode: RfidKind };
export type RfidScan = { card_id?: string; tag_id?: string; uid?: string; ts?: string; reader_id?: string };
export type RfidConsumeResp = { ok: boolean; scan: RfidScan | null };

export type CardAuthReq = { card_id: string };
export type CardAuthResp = {
  ok?: boolean;
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
  status?: string;
};

export type DispenseItemReq = { tool_model_id: string; qty: number };
export type DispenseBatchReq = { user_id?: string; items: DispenseItemReq[]; loan_period_hours: number };
export type DispenseBatchResp = { batch_id: string; request_ids: string[] };

export type HwStatus =
  | "pending"
  | "accepted"
  | "in_progress"
  | "waiting_user_confirm"
  | "dispensed_ok"
  | "confirmed"
  | "pickup_mismatch"
  | "return_ok"
  | "succeeded"
  | "failed";

export type BatchStatusItem = {
  request_id: string;
  request_type?: "dispense" | "return";
  tool_item_id?: string;
  slot_id?: string;
  hw_status: HwStatus;
  hw_error_code?: string | null;
  hw_error_reason?: string | null;
  created_at?: string;
  hw_updated_at?: string | null;
  stage?: string;
};
export type BatchStatusResp = { batch_id: string; items: BatchStatusItem[] };
export type LoanRow = {
  loan_id: string;
  tool_item_id: string;
  tool_model_id: string;
  tool_name: string;
  tool_category?: string | null;
  tool_tag_id: string;
  issued_at: string;
  due_at: string;
  confirmed_at?: string | null;
  returned_at?: string | null;
  status: string;
};
export type LoansResp = { user_id: string; loans: LoanRow[] };
export type ReturnItemReq = { tool_item_id: string };
export type ReturnBatchReq = { user_id?: string; items: ReturnItemReq[] };
export type ReturnBatchResp = { batch_id: string; request_ids: string[] };

export const apiUser = {
  rfidSetMode: (req: RfidSetModeReq) => http<{ ok: boolean }>(EP.rfidSetMode, { method: "POST", json: req }),
  rfidConsume: (readerId: string, kind: RfidKind) => http<RfidConsumeResp>(EP.rfidConsume(readerId, kind)),

  authCard: async (req: CardAuthReq) => {
    try {
      return await http<CardAuthResp>(EP.authSessionCard, { method: "POST", json: req });
    } catch {
      return await http<CardAuthResp>(EP.authCard, { method: "POST", json: req });
    }
  },
  sessionMe: () => http<CardAuthResp>(EP.authSessionMe),
  logout: () => http<{ ok: boolean }>(EP.authSessionLogout, { method: "POST" }),

  dispense: (req: DispenseBatchReq) => http<DispenseBatchResp>(EP.dispense, { method: "POST", json: req }),
  dispenseStatus: (batchId: string) => http<BatchStatusResp>(EP.dispenseStatus(batchId)),
  dispenseConfirmRequest: (requestId: string) => http<{ ok: boolean; request_id: string }>(EP.dispenseRequestConfirm(requestId), { method: "POST" }),
  dispenseCancelRequest: (requestId: string) => http<{ ok: boolean; request_id: string }>(EP.dispenseRequestCancel(requestId), { method: "POST" }),

  loans: () => http<LoansResp>(EP.loans),
  doReturn: (req: ReturnBatchReq) => http<ReturnBatchResp>(EP.doReturn, { method: "POST", json: req }),
  returnStatus: (batchId: string) => http<BatchStatusResp>(EP.returnStatus(batchId)),
  returnConfirmRequest: (requestId: string) => http<{ ok: boolean; request_id: string }>(EP.returnRequestConfirm(requestId), { method: "POST" }),
  returnCancelRequest: (requestId: string) => http<{ ok: boolean; request_id: string }>(EP.returnRequestCancel(requestId), { method: "POST" }),
};
