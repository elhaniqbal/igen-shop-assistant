import { http } from "./api";
import { EP } from "./endpoints";

// ---------------- Types ----------------
export type User = {
  user_id: string;
  card_id?: string | null;
  student_number?: string | null;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
};

export type AdminUserCreate = {
  user_id?: string | null;
  card_id?: string | null;
  student_number?: string | null;
  first_name?: string;
  last_name?: string;
  role?: string;
  status?: string;
};

// Tool model policy fields (admin-configurable constraints)
export type ToolModel = {
  tool_model_id: string;
  name: string;
  description?: string | null;
  category?: string | null;

  max_loan_hours?: number | null;
  max_qty_per_user?: number | null;
};

export type AdminToolModelCreate = {
  tool_model_id?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;

  max_loan_hours?: number | null;
  max_qty_per_user?: number | null;
};

export type ToolModelPatch = Partial<Omit<ToolModel, "tool_model_id">>;

export type ToolItem = {
  tool_item_id: string;
  tool_model_id: string;
  tool_tag_id: string;
  cake_id: string;
  slot_id: string;
  condition_status: "ok" | "worn" | "damaged" | "missing_parts";
  is_active: boolean;
};

export type AdminToolItemCreate = {
  tool_item_id?: string | null;
  tool_model_id: string;
  tool_tag_id: string;
  cake_id: string;
  slot_id: string;
  condition_status: "ok" | "worn" | "damaged" | "missing_parts";
  is_active: boolean;
};

export type InventoryRow = {
  tool_model_id: string;
  name: string;
  total: number;
  available: number;
  checked_out: number;
};

export type LoanOut = {
  loan_id: string;
  user_id: string;
  tool_item_id: string;
  issued_at: string;
  due_at: string;
  confirmed_at?: string | null;
  returned_at?: string | null;
  status: string;
};

export type EventOut = {
  event_id: number;
  ts: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  request_id?: string | null;
  tool_item_id?: string | null;
  payload_json: string;
};

export type UsagePoint = { day: string; dispenses: number; returns: number };

export type MotorAction = "dispense" | "return";
export type MotorTestReq = { motor_id: number; action: MotorAction };
export type MotorTestStartResp = { request_id: string; motor_id: number; action: MotorAction };
export type LoanPatch = Partial<Pick<LoanOut, "due_at" | "status" | "confirmed_at" | "returned_at">>;
export type MotorTestStatusResp = {
  request_id: string;
  stage: "queued" | "accepted" | "in_progress" | "succeeded" | "failed";
  error_code?: string | null;
  error?: string | null;
};

// Hardware console
export type HardwareCmdResp = {
  ok: boolean;
  request_id: string;
  cake_id: number;
  command: string;
  eeprom: any | null;
};
export type ReadEepromResp = {
  ok: boolean;
  cake_id: number;
  // for now blank; later you can populate from headers/body
  eeprom: any | null;
  headers?: Record<string, string>;
};

export type CakeHomeStartResp = { ok: boolean; request_id: string; cake_id: number };
export type CakeHomeStatusResp = {
  request_id: string;
  cake_id: number;
  stage: "queued" | "accepted" | "in_progress" | "succeeded" | "failed";
  error_code?: string | null;
  error_reason?: string | null;
};

// ---------------- API ----------------
export const apiAdmin = {
  // Users CRUD
  listUsers: (params?: { search?: string; role?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.role) q.set("role", params.role);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<User[]>(`${EP.adminUsers}${qs ? `?${qs}` : ""}`);
  },

  createUser: (u: AdminUserCreate) => http<User>(EP.adminUsers, { method: "POST", json: u }),
  patchUser: (userId: string, patch: Partial<User>) => http<User>(EP.adminUser(userId), { method: "PATCH", json: patch }),
  deleteUser: (userId: string) => http<{ ok: boolean }>(EP.adminUser(userId), { method: "DELETE" }),

  // Tool models CRUD
  listToolModels: (params?: { search?: string; category?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.category) q.set("category", params.category);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<ToolModel[]>(`${EP.adminToolModels}${qs ? `?${qs}` : ""}`);
  },

  createToolModel: (m: AdminToolModelCreate) => http<ToolModel>(EP.adminToolModels, { method: "POST", json: m }),
  patchToolModel: (id: string, patch: ToolModelPatch) =>
    http<ToolModel>(EP.adminToolModel(id), { method: "PATCH", json: patch }),
  deleteToolModel: (id: string) => http<{ ok: boolean }>(EP.adminToolModel(id), { method: "DELETE" }),

  // Tool items CRUD
  listToolItems: (params?: { tool_model_id?: string; cake_id?: string; is_active?: boolean; search?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.tool_model_id) q.set("tool_model_id", params.tool_model_id);
    if (params?.cake_id) q.set("cake_id", params.cake_id);
    if (params?.is_active !== undefined) q.set("is_active", String(params.is_active));
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<ToolItem[]>(`${EP.adminToolItems}${qs ? `?${qs}` : ""}`);
  },

  createToolItem: (i: AdminToolItemCreate) => http<ToolItem>(EP.adminToolItems, { method: "POST", json: i }),
  patchToolItem: (id: string, patch: Partial<ToolItem>) => http<ToolItem>(EP.adminToolItem(id), { method: "PATCH", json: patch }),
  deleteToolItem: (id: string) => http<{ ok: boolean }>(EP.adminToolItem(id), { method: "DELETE" }),

  // Inventory
  inventory: () => http<InventoryRow[]>(EP.adminInventory),

  // loans
  listLoans: (params?: {
    active_only?: boolean;
    overdue_only?: boolean;
    user_id?: string;
    tool_item_id?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.overdue_only !== undefined) q.set("overdue_only", String(params.overdue_only));
    if (params?.user_id) q.set("user_id", params.user_id);
    if (params?.tool_item_id) q.set("tool_item_id", params.tool_item_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<LoanOut[]>(`${EP.adminLoans}${qs ? `?${qs}` : ""}`);
  },

  patchLoan: (loanId: string, patch: LoanPatch) =>
    http<LoanOut>(EP.adminLoan(loanId), { method: "PATCH", json: patch }),

  // NEW: confirm unconfirmed loan (admin override)
  confirmLoan: (loanId: string) =>
    http<{ ok: boolean; loan_id: string; status: string; confirmed_at: string }>(`/admin/loans/${loanId}/confirm`, { method: "POST" }),

  // NEW: cancel unconfirmed loan (free inventory)
  cancelUnconfirmedLoan: (loanId: string) =>
    http<{ ok: boolean; loan_id: string; status: string; returned_at: string }>(`/admin/loans/${loanId}/cancel-unconfirmed`, { method: "POST" }),

  // NEW: drop unconfirmed tool item from inventory (soft delete + cancel loan)
  dropUnconfirmedToolItem: (toolItemId: string) =>
    http<{ ok: boolean; tool_item_id: string; loan_id: string; status: string; item_is_active: boolean }>(`/admin/tool-items/${toolItemId}/drop-unconfirmed`, { method: "POST" }),

  // events
  listEvents: (params?: {
    event_type?: string;
    actor_id?: string;
    request_id?: string;
    tool_item_id?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.event_type) q.set("event_type", params.event_type);
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.request_id) q.set("request_id", params.request_id);
    if (params?.tool_item_id) q.set("tool_item_id", params.tool_item_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<EventOut[]>(`${EP.adminEvents}${qs ? `?${qs}` : ""}`);
  },

  // assign actions
  assignUserCard: (userId: string, card_id: string) =>
    http<{ ok: boolean; user_id: string; card_id: string }>(EP.adminAssignUserCard(userId), {
      method: "PUT",
      json: { card_id },
    }),

  assignToolTag: (toolItemId: string, tool_tag_id: string) =>
    http<{ ok: boolean; tool_item_id: string; tool_tag_id: string }>(EP.adminAssignToolTag(toolItemId), {
      method: "PUT",
      json: { tool_tag_id },
    }),

  // metrics
  usage: (days: number) => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    return http<UsagePoint[]>(`${EP.adminUsage}?${q.toString()}`);
  },

  // motor test
  motorTestStart: (req: MotorTestReq) => http<MotorTestStartResp>(EP.adminMotorTestStart, { method: "POST", json: req }),
  motorTestStatus: (requestId: string) => http<MotorTestStatusResp>(EP.adminMotorTestStatus(requestId)),

  // NEW: Hardware command console
  hardwareCommand: (cakeId: number, command: string, args?: Record<string, any>) =>
    http<HardwareCmdResp>(`/admin/hardware/cakes/${cakeId}/cmd`, { method: "POST", json: { command, args: args ?? {} } }),

  readCakeEeprom: async (cakeId: number) => {
    // placeholder endpoint; you can change path later
    const res = await fetch(`/admin/cakes/${cakeId}/eeprom`, { method: "GET" });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "read eeprom failed");
    }

    // Later: you said you’ll return EEPROM in request headers.
    // This collects them so the modal can display them.
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));

    // if you later return JSON body too, this will work
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      ok: true,
      cake_id: cakeId,
      eeprom: body?.eeprom ?? null,
      headers,
    } satisfies ReadEepromResp;
  },

  cakeSetHome: (cakeId: number) =>
    http<CakeHomeStartResp>(`/admin/cakes/${cakeId}/home`, { method: "POST" }),

  cakeSetHomeStatus: (requestId: string) =>
    http<CakeHomeStatusResp>(`/admin/cakes/home/${requestId}/status`),
};
