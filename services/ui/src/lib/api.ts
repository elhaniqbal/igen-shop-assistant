const API_BASE = "1";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// -------- Auth --------
export async function login(userId: string, password: string) {
  // If your backend auth isn't ready yet, keep this temporary mock:
  if (API_BASE === "1") {
    if (userId === "ADMIN-001" && password === "admin123") return { role: "admin" as const, token: "mock" };
    if (userId === "EMP-1001" && password === "user123") return { role: "user" as const, token: "mock" };
    throw new Error("Invalid credentials");
  }
  return j<{ role: "admin" | "user"; token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, password }),
  });
}

// -------- Admin data --------
export async function getAdminSummary() {
  if (API_BASE === "1") {
    return { monthly_dispenses: 190, active_users: 42, avg_checkout_hours: 3.2, checked_out_now: 5 };
  }
  return j("/admin/stats/summary");
}

export async function getWeeklyDispenses() {
  if (API_BASE === "1") {
    return [
      { day: "Mon", count: 22 },
      { day: "Tue", count: 30 },
      { day: "Wed", count: 27 },
      { day: "Thu", count: 35 },
      { day: "Fri", count: 42 },
      { day: "Sat", count: 17 },
      { day: "Sun", count: 12 },
    ];
  }
  return j("/admin/stats/weekly-dispenses");
}

export async function getCategoryUsage() {
  if (API_BASE === "1") {
    return [
      { category: "Power Tools", pct: 35 },
      { category: "Hand Tools", pct: 28 },
      { category: "Measuring", pct: 20 },
      { category: "Safety", pct: 17 },
    ];
  }
  return j("/admin/stats/category-usage");
}

export async function getCheckedOut() {
  if (API_BASE === "1") {
    return [
      { tool: "Wire Cutters", tool_id: "TOOL-001-C", user: "John Martinez", out: "2025-11-22 08:30", due: "2025-11-22 16:30", status: "Active" },
      { tool: "Wire Strippers", tool_id: "TOOL-002-C", user: "Sarah Chen", out: "2025-11-22 07:45", due: "2025-11-22 15:45", status: "Active" },
      { tool: "Crimpers", tool_id: "TOOL-003-C", user: "Michael Johnson", out: "2025-11-22 10:00", due: "2025-11-22 14:00", status: "Active" },
      { tool: "Crimp Connectors", tool_id: "TOOL-004-E", user: "Emily Rodriguez", out: "2025-11-21 15:30", due: "2025-11-22 11:30", status: "Overdue" },
    ];
  }
  return j("/admin/checked-out");
}

export async function getOverdue() {
  if (API_BASE === "1") {
    return [
      { tool: "Cordless Drill", hours_overdue: 42, name: "John Smith", user_id: "EMP-1023", email: "john.smith@company.com", due: "2025-11-20 14:30", priority: "High" },
      { tool: "Angle Grinder", hours_overdue: 15, name: "Sarah Johnson", user_id: "EMP-2145", email: "sarah.j@company.com", due: "2025-11-21 09:00", priority: "Medium" },
      { tool: "Measuring Tape", hours_overdue: 8, name: "Mike Brown", user_id: "EMP-3267", email: "mike.b@company.com", due: "2025-11-21 16:15", priority: "Low" },
    ];
  }
  return j("/admin/overdue");
}

export async function getInventory() {
  if (API_BASE === "1") {
    return [
      { name: "Wire Cutters", locations: ["A1","A2","A3"], category: "Electrical Tools", available: 3, total: 5, checked_out: 2, status: "In Stock",
        items: [
          { tool_item_id: "TOOL-001-A", loc: "A1", state: "Available" },
          { tool_item_id: "TOOL-001-B", loc: "A2", state: "Available" },
          { tool_item_id: "TOOL-001-C", loc: "A3", state: "Checked Out" },
        ]
      },
      { name: "Wire Strippers", locations: ["B1","B2","B3","+1"], category: "Electrical Tools", available: 3, total: 4, checked_out: 1, status: "In Stock",
        items: [
          { tool_item_id: "TOOL-002-A", loc: "B1", state: "Available" },
          { tool_item_id: "TOOL-002-B", loc: "B2", state: "Available" },
          { tool_item_id: "TOOL-002-C", loc: "B3", state: "Checked Out" },
          { tool_item_id: "TOOL-002-D", loc: "B4", state: "Available" },
        ]
      },
    ];
  }
  return j("/admin/tools");
}

export async function getUsers() {
  if (API_BASE === "1") {
    return [
      { name: "John Martinez", student_id: "20211001", email: "john.martinez@machineshop.edu", role: "User", status: "Good Standing", badge: "EMP-1001" },
      { name: "Sarah Chen", student_id: "20202034", email: "sarah.chen@machineshop.edu", role: "User", status: "Good Standing", badge: "EMP-2034" },
      { name: "Emily Rodriguez", student_id: "20211445", email: "emily.rodriguez@machineshop.edu", role: "User", status: "Delinquent", badge: "EMP-1445" },
    ];
  }
  return j("/admin/users");
}



//    REAL DATA



// src/lib/api.ts
// Typed API client aligned with backend FastAPI routers + schemas.
//
// Assumes your backend is mounted under /api (e.g. app.include_router(..., prefix="/api"))
// and admin router paths are /api/admin/*

// export type ISODateTime = string;

// // ---------- Shared ----------
// export type ApiOk = { ok: true };

// export type ApiError = {
//   status: number;
//   detail: string;
// };

// export class ApiException extends Error {
//   status: number;
//   detail: string;
//   constructor(status: number, detail: string) {
//     super(`${status}: ${detail}`);
//     this.status = status;
//     this.detail = detail;
//   }
// }

// // ---------- USERS ----------
// export type UserRole = "student" | "staff" | "admin" | string;
// export type UserStatus = "good" | "delinquent" | "banned" | string;

// export type UserOut = {
//   user_id: string;
//   card_id: string | null;
//   student_number: string | null;
//   first_name: string;
//   last_name: string;
//   role: UserRole;
//   status: UserStatus;
//   created_at: ISODateTime;
//   updated_at: ISODateTime;
// };

// export type AdminUserCreate = {
//   user_id: string;
//   card_id?: string | null;
//   student_number?: string | null;
//   first_name?: string;
//   last_name?: string;
//   role?: UserRole;
//   status?: UserStatus;
// };

// export type AdminUserPatch = Partial<Omit<AdminUserCreate, "user_id">>;

// // ---------- TOOL MODELS ----------
// export type ToolModelOut = {
//   tool_model_id: string;
//   name: string;
//   description: string;
//   category: string | null;
// };

// export type AdminToolModelCreate = {
//   tool_model_id: string;
//   name: string;
//   description?: string;
//   category?: string | null;
// };

// export type AdminToolModelPatch = Partial<Omit<AdminToolModelCreate, "tool_model_id">>;

// // ---------- TOOL ITEMS ----------
// export type ToolItemOut = {
//   tool_item_id: string;
//   tool_model_id: string;
//   tool_tag_id: string;
//   cake_id: string;
//   slot_id: string;
//   condition_status: string;
//   is_active: boolean;
//   created_at: ISODateTime;
//   updated_at: ISODateTime;
// };

// export type AdminToolItemCreate = {
//   tool_item_id: string;
//   tool_model_id: string;
//   tool_tag_id: string;
//   cake_id: string;
//   slot_id: string;
//   condition_status?: string;
//   is_active?: boolean;
// };

// export type AdminToolItemPatch = Partial<Omit<AdminToolItemCreate, "tool_item_id">>;

// // ---------- LOANS ----------
// export type LoanStatus = "active" | "overdue" | "returned" | "lost" | "damaged" | string;

// export type LoanOut = {
//   loan_id: string;
//   user_id: string;
//   tool_item_id: string;
//   issued_at: ISODateTime;
//   due_at: ISODateTime;
//   confirmed_at: ISODateTime | null;
//   returned_at: ISODateTime | null;
//   status: LoanStatus;
// };

// export type AdminLoanPatch = Partial<Pick<LoanOut, "due_at" | "returned_at" | "status">>;

// // ---------- EVENTS ----------
// export type EventOut = {
//   event_id: number;
//   ts: ISODateTime;
//   event_type: string;
//   actor_type: "user" | "system" | string;
//   actor_id: string | null;
//   request_id: string | null;
//   tool_item_id: string | null;
//   payload_json: string; // stored JSON string in DB (per your model)
// };

// // ---------- Query Param Types ----------
// export type ListUsersQuery = {
//   search?: string;
//   role?: string;
//   status?: string;
//   limit?: number;
// };

// export type ListToolModelsQuery = {
//   search?: string;
//   category?: string;
//   limit?: number;
// };

// export type ListToolItemsQuery = {
//   tool_model_id?: string;
//   cake_id?: string;
//   is_active?: boolean;
//   search?: string;
//   limit?: number;
// };

// export type ListLoansQuery = {
//   active_only?: boolean;
//   overdue_only?: boolean;
//   user_id?: string;
//   tool_item_id?: string;
//   limit?: number;
// };

// export type ListEventsQuery = {
//   event_type?: string;
//   actor_id?: string;
//   request_id?: string;
//   tool_item_id?: string;
//   limit?: number;
// };

// // ---------- Low-level helpers ----------
// const API_BASE = "/api";

// function qs(params: Record<string, unknown | undefined>): string {
//   const u = new URLSearchParams();
//   for (const [k, v] of Object.entries(params)) {
//     if (v === undefined || v === null) continue;
//     // FastAPI expects "true/false" for bool query params
//     u.set(k, typeof v === "boolean" ? String(v) : String(v));
//   }
//   const s = u.toString();
//   return s ? `?${s}` : "";
// }

// async function http<T>(path: string, init?: RequestInit): Promise<T> {
//   const res = await fetch(`${API_BASE}${path}`, {
//     headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
//     ...init,
//   });

//   if (res.ok) {
//     // Some endpoints might return empty body; handle safely
//     const text = await res.text();
//     return (text ? JSON.parse(text) : ({} as T)) as T;
//   }

//   // FastAPI default error shape is usually {"detail": "..."}
//   let detail = `${res.status} ${res.statusText}`;
//   try {
//     const body = await res.json();
//     if (typeof body?.detail === "string") detail = body.detail;
//     else detail = JSON.stringify(body);
//   } catch {
//     try {
//       detail = await res.text();
//     } catch {}
//   }
//   throw new ApiException(res.status, detail);
// }

// // ---------- API surface aligned with backend ----------
// export const api = {
//   // ----- USERS -----
//   listUsers: (q: ListUsersQuery = {}) =>
//     http<UserOut>(`/admin/users${qs({ limit: 200, ...q })}`) as unknown as Promise<UserOut[]>,

//   getUser: (user_id: string) =>
//     http<UserOut>(`/admin/users/${encodeURIComponent(user_id)}`),

//   createUser: (body: AdminUserCreate) =>
//     http<UserOut>(`/admin/users`, { method: "POST", body: JSON.stringify(body) }),

//   patchUser: (user_id: string, body: AdminUserPatch) =>
//     http<UserOut>(`/admin/users/${encodeURIComponent(user_id)}`, {
//       method: "PATCH",
//       body: JSON.stringify(body),
//     }),

//   deleteUser: (user_id: string) =>
//     http<ApiOk>(`/admin/users/${encodeURIComponent(user_id)}`, { method: "DELETE" }),

//   // ----- TOOL MODELS -----
//   listToolModels: (q: ListToolModelsQuery = {}) =>
//     http<ToolModelOut[]>(`/admin/tool-models${qs({ limit: 200, ...q })}`),

//   getToolModel: (tool_model_id: string) =>
//     http<ToolModelOut>(`/admin/tool-models/${encodeURIComponent(tool_model_id)}`),

//   createToolModel: (body: AdminToolModelCreate) =>
//     http<ToolModelOut>(`/admin/tool-models`, { method: "POST", body: JSON.stringify(body) }),

//   patchToolModel: (tool_model_id: string, body: AdminToolModelPatch) =>
//     http<ToolModelOut>(`/admin/tool-models/${encodeURIComponent(tool_model_id)}`, {
//       method: "PATCH",
//       body: JSON.stringify(body),
//     }),

//   deleteToolModel: (tool_model_id: string) =>
//     http<ApiOk>(`/admin/tool-models/${encodeURIComponent(tool_model_id)}`, { method: "DELETE" }),

//   // ----- TOOL ITEMS -----
//   listToolItems: (q: ListToolItemsQuery = {}) =>
//     http<ToolItemOut[]>(`/admin/tool-items${qs({ limit: 500, ...q })}`),

//   getToolItem: (tool_item_id: string) =>
//     http<ToolItemOut>(`/admin/tool-items/${encodeURIComponent(tool_item_id)}`),

//   createToolItem: (body: AdminToolItemCreate) =>
//     http<ToolItemOut>(`/admin/tool-items`, { method: "POST", body: JSON.stringify(body) }),

//   patchToolItem: (tool_item_id: string, body: AdminToolItemPatch) =>
//     http<ToolItemOut>(`/admin/tool-items/${encodeURIComponent(tool_item_id)}`, {
//       method: "PATCH",
//       body: JSON.stringify(body),
//     }),

//   deleteToolItem: (tool_item_id: string) =>
//     http<ApiOk>(`/admin/tool-items/${encodeURIComponent(tool_item_id)}`, { method: "DELETE" }),

//   // ----- LOANS (admin) -----
//   listLoans: (q: ListLoansQuery = {}) =>
//     http<LoanOut[]>(`/admin/loans${qs({ limit: 500, ...q })}`),

//   getLoan: (loan_id: string) =>
//     http<LoanOut>(`/admin/loans/${encodeURIComponent(loan_id)}`),

//   patchLoan: (loan_id: string, body: AdminLoanPatch) =>
//     http<LoanOut>(`/admin/loans/${encodeURIComponent(loan_id)}`, {
//       method: "PATCH",
//       body: JSON.stringify(body),
//     }),

//   // ----- EVENTS (read-only) -----
//   listEvents: (q: ListEventsQuery = {}) =>
//     http<EventOut[]>(`/admin/events${qs({ limit: 500, ...q })}`),

//   getEvent: (event_id: number) =>
//     http<EventOut>(`/admin/events/${event_id}`),
// };
