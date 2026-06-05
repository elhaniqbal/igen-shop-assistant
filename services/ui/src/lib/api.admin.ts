import { http } from "./api";
import { EP } from "./endpoints";

export type User = {
  user_id: string;
  card_id?: string | null;
  student_number?: string | null;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
};
export type AdminUserCreate = Partial<User>;

export type ToolModel = {
  tool_model_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  max_loan_hours?: number | null;
  max_qty_per_user?: number | null;
};
export type AdminToolModelCreate = Omit<ToolModel, "tool_model_id"> & { tool_model_id?: string | null };
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
export type AdminToolItemCreate = Omit<ToolItem, "tool_item_id"> & { tool_item_id?: string | null };

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
  tool_name?: string;
  tool_model_id?: string;
  tool_category?: string | null;
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
export type AdminLoanExtendResp = { ok: boolean; loan_id: string; due_at: string };
export type MotorTestStatusResp = {
  request_id: string;
  stage: "queued" | "accepted" | "in_progress" | "succeeded" | "failed";
  error_code?: string | null;
  error?: string | null;
};

export type AxisName = "horizontal" | "vertical";
export type AxisDirection = "positive" | "negative";
export type CakeMoveDirection = "cw" | "ccw";
export type HomeMode = "python_assisted" | "true_synced" | "manual_independent";

export type ManualJogAxisReq = { axis: AxisName; direction: AxisDirection; step: number };
export type ManualMoveCakeReq = { cake_id: number; step: number; direction: CakeMoveDirection };
export type ManualJogCakeDeltaReq = { cake_id: number; delta: number };
export type ManualRunMacroReq = { script: string };

export type ManualCommandResp = {
  ok: boolean;
  message: string;
  request_id?: string;
  command?: string;
  data?: any;
};

export type ManualControlStatus = {
  ok?: boolean;
  reachable?: boolean;
  homed?: boolean;
  busy?: boolean;
  state?: string;
  klipper_state?: string | null;
  klipper_state_message?: string | null;
  horizontal_position?: number | string | null;
  vertical_position?: number | string | null;
  active_cake_id?: number | string | null;
  endstops?: Record<string, boolean | null>;
  vertical_tilted?: boolean | null;
  [key: string]: any;
};

export type MachineStatus = ManualControlStatus;

export type MachineAlert = {
  alert_id?: string;
  id?: string;
  ts?: string;
  severity?: "critical" | "error" | "warning" | "info" | "success" | string;
  style?: string;
  source?: string;
  code?: string;
  message?: string;
  sticky?: boolean;
  ack_required?: boolean;
  related_request_id?: string | null;
  data?: Record<string, any> | null;
  event_id?: number;
};

export type PendingHardwareWait = {
  request_id: string;
  action?: string;
  stage?: string;
  timeout_s?: number;
  message?: string;
};

export type CalibrationStatus = {
  ok?: boolean;
  values?: Record<string, number | string | boolean | null>;
  raw?: Record<string, any> | null;
};

export type CalibrationSetReq =
  | { action: "set_variable"; variable: string; value: number | string }
  | { action: "set_door_x"; value: number }
  | { action: "set_door_distance"; value: number }
  | { action: "set_door_z"; value: number }
  | { action: "set_cake_center"; cake_id: number; value: number }
  | { action: "set_cake_center_x"; cake_id: number; value: number };

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
  eeprom: any | null;
  stage?: string;
  request_id?: string;
  error_code?: string | null;
  error_reason?: string | null;
  headers?: Record<string, string>;
};

export type ReadAngleResp = {
  ok: boolean;
  cake_id: number;
  reading: any | null;
  stage?: string;
  request_id?: string;
  error_code?: string | null;
  error_reason?: string | null;
};

export type CakeReadStartResp = { ok: boolean; request_id: string; cake_id: number };
export type CakeHomeStartResp = { ok: boolean; request_id: string; cake_id: number };
export type CakeHomeStatusResp = {
  request_id: string;
  cake_id: number;
  stage: "queued" | "accepted" | "in_progress" | "succeeded" | "failed";
  error_code?: string | null;
  error_reason?: string | null;
};

export type CronJobConfig = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  description?: string;
  last_run_ts?: string | null;
  last_status?: "ok" | "error" | "unknown" | null;
};

export type AlertRecipient = {
  id?: string;
  email: string;
  enabled: boolean;
  severity_threshold?: "warning" | "error" | "critical";
};

export type CakeOverview = {
  cake_id: string;
  current_slot: number;
  slots: { slot_index: number; tool_item_id: string | null }[];
};

export type KlipperFileName = "vars.cfg" | "steppers.cfg" | "macros.cfg";
export type KlipperFileResp = {
  ok: boolean;
  name: KlipperFileName;
  path: string;
  content: string;
  message?: string;
};

export const apiAdmin = {
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

  listToolModels: (params?: { search?: string; category?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.category) q.set("category", params.category);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<ToolModel[]>(`${EP.adminToolModels}${qs ? `?${qs}` : ""}`);
  },
  createToolModel: (m: AdminToolModelCreate) => http<ToolModel>(EP.adminToolModels, { method: "POST", json: m }),
  patchToolModel: (id: string, patch: ToolModelPatch) => http<ToolModel>(EP.adminToolModel(id), { method: "PATCH", json: patch }),
  deleteToolModel: (id: string) => http<{ ok: boolean }>(EP.adminToolModel(id), { method: "DELETE" }),

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
  dropUnconfirmedToolItem: (toolItemId: string) =>
    http<{ ok: boolean; tool_item_id: string; loan_id: string; status: string; item_is_active: boolean }>(
      `${EP.adminToolItem(toolItemId)}/drop-unconfirmed`,
      { method: "POST" }
    ),

  inventory: () => http<InventoryRow[]>(EP.adminInventory),

  listLoans: (params?: { active_only?: boolean; overdue_only?: boolean; user_id?: string; tool_item_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.overdue_only !== undefined) q.set("overdue_only", String(params.overdue_only));
    if (params?.user_id) q.set("user_id", params.user_id);
    if (params?.tool_item_id) q.set("tool_item_id", params.tool_item_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<LoanOut[]>(`${EP.adminLoans}${qs ? `?${qs}` : ""}`);
  },
  patchLoan: (loanId: string, patch: LoanPatch) => http<LoanOut>(EP.adminLoan(loanId), { method: "PATCH", json: patch }),
  extendLoan: (loanId: string, add_hours: number) => http<AdminLoanExtendResp>(EP.adminLoanExtend(loanId), { method: "POST", json: { add_hours } }),
  sendOverdueEmail: (loanId: string) =>
    http<{ ok: boolean; loan_id: string; message: string }>(EP.adminLoanSendOverdueEmail(loanId), { method: "POST" }),

  listEvents: (params?: { event_type?: string; actor_id?: string; request_id?: string; tool_item_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.event_type) q.set("event_type", params.event_type);
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.request_id) q.set("request_id", params.request_id);
    if (params?.tool_item_id) q.set("tool_item_id", params.tool_item_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return http<EventOut[]>(`${EP.adminEvents}${qs ? `?${qs}` : ""}`);
  },

  assignUserCard: (userId: string, card_id: string) =>
    http<{ ok: boolean; user_id: string; card_id: string }>(EP.adminAssignUserCard(userId), { method: "PUT", json: { card_id } }),
  assignToolTag: (toolItemId: string, tool_tag_id: string) =>
    http<{ ok: boolean; tool_item_id: string; tool_tag_id: string }>(EP.adminAssignToolTag(toolItemId), { method: "PUT", json: { tool_tag_id } }),

  usage: (days: number) => http<UsagePoint[]>(`${EP.adminUsage}?days=${days}`),

  motorTestStart: (req: MotorTestReq) => http<MotorTestStartResp>(EP.adminMotorTestStart, { method: "POST", json: req }),
  motorTestStatus: (requestId: string) => http<MotorTestStatusResp>(EP.adminMotorTestStatus(requestId)),

  manualStatus: () => http<ManualControlStatus>(EP.adminMachineStatus),
  manualHomeAll: (home_mode?: HomeMode) =>
    http<ManualCommandResp>(EP.adminManualHomeAll, {
      method: "POST",
      json: home_mode ? { home_mode } : {},
    }),
  manualGoToDoor: () => http<ManualCommandResp>(EP.adminManualGoToDoor, { method: "POST" }),
  manualStop: () => http<ManualCommandResp>(EP.adminManualStop, { method: "POST" }),
  manualJogAxis: (req: ManualJogAxisReq) => http<ManualCommandResp>(EP.adminManualJogAxis, { method: "POST", json: req }),
  manualMoveCake: (req: ManualMoveCakeReq) => http<ManualCommandResp>(EP.adminManualMoveCake, { method: "POST", json: req }),
  manualJogCakeDelta: (req: ManualJogCakeDeltaReq) => http<ManualCommandResp>(EP.adminManualJogCakeDelta, { method: "POST", json: req }),
  manualRunMacro: (req: ManualRunMacroReq) => http<ManualCommandResp>(EP.adminManualRunMacro, { method: "POST", json: req }),

  machineStatus: () => http<MachineStatus>(EP.adminMachineStatus),
  machineQueryStatus: () => http<ManualCommandResp>(EP.adminMachineQueryStatus, { method: "POST" }),
  machineRestartKlipper: () => http<ManualCommandResp>(EP.adminMachineRestartKlipper, { method: "POST" }),
  machineFirmwareRestart: () => http<ManualCommandResp>(EP.adminMachineFirmwareRestart, { method: "POST" }),
  machineEmergencyStop: () => http<ManualCommandResp>(EP.adminMachineEmergencyStop, { method: "POST" }),

  machineAlerts: async () => {
    try {
      return await http<MachineAlert[]>(EP.adminMachineAlerts);
    } catch {
      return [];
    }
  },

  hardwareWaits: async () => {
    try {
      return await http<{ waits?: PendingHardwareWait[] }>(EP.adminHardwareWaits);
    } catch {
      return { waits: [] };
    }
  },

  hardwareConfirmRequest: (requestId: string) =>
    http<{ ok: boolean; request_id: string }>(`/api/admin/hardware/requests/${encodeURIComponent(requestId)}/confirm`, { method: "POST" }),
  hardwareCancelRequest: (requestId: string) =>
    http<{ ok: boolean; request_id: string }>(`/api/admin/hardware/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST" }),

  calibrationStatus: () => http<CalibrationStatus>(EP.adminCalibrationStatus),
  calibrationSet: (req: CalibrationSetReq) => http<ManualCommandResp>(EP.adminCalibrationSet, { method: "POST", json: req }),

  queueCakeReadEeprom: (cakeId: number) =>
    http<CakeReadStartResp>(`/api/admin/cakes/${cakeId}/read-eeprom`, { method: "POST" }),
  readCakeEeprom: (cakeId: number) =>
    http<ReadEepromResp>(`/api/admin/cakes/${cakeId}/eeprom`),

  queueCakeReadAngle: (cakeId: number) =>
    http<CakeReadStartResp>(`/api/admin/cakes/${cakeId}/read-angle`, { method: "POST" }),
  readCakeAngle: (cakeId: number) =>
    http<ReadAngleResp>(`/api/admin/cakes/${cakeId}/angle`),

  cakeSetHome: (cakeId: number) => http<CakeHomeStartResp>(`/api/admin/cakes/${cakeId}/home`, { method: "POST" }),
  cakeSetHomeStatus: (requestId: string) => http<CakeHomeStatusResp>(`/api/admin/cakes/home/${requestId}/status`),

  cakesOverview: async () => {
    const data = await http<{ cakes?: CakeOverview[] } | CakeOverview[]>(EP.adminCakes);
    return Array.isArray(data) ? data : (data.cakes ?? []);
  },

  emailTemplates: () => http<{ templates: string[] }>(EP.adminEmailsTemplates),
  sendEmail: (body: { to: string; subject: string; message: string }) =>
    http<{ ok: boolean; message?: string }>(EP.adminEmailsSend, { method: "POST", json: body }),
  sendTemplate: (body: { to: string; template_name: string; context?: Record<string, any> }) =>
    http<{ ok: boolean; message?: string }>(EP.adminEmailsSendTemplate, { method: "POST", json: body }),

  cronJobs: async () => {
    const data = await http<{ jobs?: CronJobConfig[] } | CronJobConfig[]>(EP.adminCronJobs);
    return Array.isArray(data) ? data : (data.jobs ?? []);
  },
  cronRunHealthcheck: () => http<{ ok: boolean; message?: string }>(EP.adminCronRunHealthcheck, { method: "POST" }),
  cronRunEmailTest: () => http<{ ok: boolean; message?: string }>(EP.adminCronRunEmailTest, { method: "POST" }),
  cronAlertRecipients: async () => {
    const data = await http<{ recipients?: AlertRecipient[] } | AlertRecipient[]>(EP.adminCronAlertRecipients);
    return Array.isArray(data) ? data : (data.recipients ?? []);
  },

  getKlipperFile: (name: KlipperFileName) =>
    http<KlipperFileResp>(`/api/admin/klipper/file?name=${encodeURIComponent(name)}`),

  saveKlipperFile: (name: KlipperFileName, content: string) =>
    http<KlipperFileResp>(`/api/admin/klipper/file`, {
      method: "POST",
      json: { name, content },
    }),

  restartKlipper: (mode: "restart_klipper" | "firmware_restart") =>
    http<ManualCommandResp>(`/api/admin/klipper/restart`, {
      method: "POST",
      json: { mode },
    }),

  confirmLoan: (loanId: string) =>
    http<{ ok: boolean }>(EP.adminLoanConfirm(loanId), {
      method: "POST",
    }),

  cancelUnconfirmedLoan: (loanId: string) =>
    http<{ ok: boolean; loan_id: string; status: string; returned_at: string }>(
      `/api/admin/loans/${encodeURIComponent(loanId)}/cancel-unconfirmed`,
      { method: "POST" }
    ),
};
