import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type ToolItem, type ToolModel, type InventoryRow, type LoanOut, type User } from "../../../lib/api.admin";
import { apiUser } from "../../../lib/api.user";

function msg(e: any) {
  if (e && typeof e === "object") {
    if ("message" in e) return String((e as any).message);
    if ("detail" in e) return typeof (e as any).detail === "string" ? (e as any).detail : JSON.stringify((e as any).detail);
  }
  return "request failed";
}

type ConditionStatus = "ok" | "worn" | "damaged" | "missing_parts";
const CONDITION_OPTIONS: { value: ConditionStatus; label: string }[] = [
  { value: "ok", label: "ok" },
  { value: "worn", label: "worn" },
  { value: "damaged", label: "damaged" },
  { value: "missing_parts", label: "missing_parts" },
];

type ModelForm = {
  name: string;
  category: string;
  description: string;
  max_loan_hours: string;
  max_qty_per_user: string;
};

function toOptInt(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error("Must be an integer");
  return n;
}

type ItemForm = {
  tool_model_id: string;
  cake_id: string;
  slot_id: string;
  condition_status: ConditionStatus;
  is_active: boolean;
  tool_tag_id: string;
};

type ItemRowView = ToolItem & {
  loan_status: "AVAILABLE" | "CHECKED_OUT";
  holder_name: string; // First Last
  due_at: string | null;
  loan_id: string | null;
  loan_state: string | null; // active/overdue/unconfirmed/etc
};

export default function Inventory() {
  const [models, setModels] = useState<ToolModel[]>([]);
  const [items, setItems] = useState<ToolItem[]>([]);
  const [invMap, setInvMap] = useState<Record<string, InventoryRow>>({});
  const [loanMap, setLoanMap] = useState<Record<string, LoanOut>>({});
  const [userMap, setUserMap] = useState<Record<string, User>>({});
  const [err, setErr] = useState<string | null>(null);

  const [qModels, setQModels] = useState("");
  const [qItems, setQItems] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [modal, setModal] = useState<
    | null
    | { kind: "model_create" }
    | { kind: "model_edit"; m: ToolModel }
    | { kind: "item_create" }
    | { kind: "item_edit"; it: ToolItem }
    | { kind: "tag"; it: ToolItem }
  >(null);

  const load = async () => {
    try {
      setErr(null);

      const [m, it, invRows, activeLoans, users] = await Promise.all([
        apiAdmin.listToolModels({ limit: 1000 }),
        apiAdmin.listToolItems({ limit: 2000 }),
        apiAdmin.inventory(),
        apiAdmin.listLoans({ active_only: true, limit: 2000 }),
        apiAdmin.listUsers({ limit: 1000 }),
      ]);

      setModels(m);
      setItems(it);

      const inv: Record<string, InventoryRow> = {};
      for (const r of invRows) inv[r.tool_model_id] = r;
      setInvMap(inv);

      const lm: Record<string, LoanOut> = {};
      for (const l of activeLoans) lm[l.tool_item_id] = l;
      setLoanMap(lm);

      const um: Record<string, User> = {};
      for (const u of users) um[u.user_id] = u;
      setUserMap(um);
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const modelName = (id: string) => models.find((x) => x.tool_model_id === id)?.name ?? id;
  const fmtOpt = (n?: number | null) => (n === null || n === undefined ? "—" : String(n));
  const invFor = (tool_model_id: string) =>
    invMap[tool_model_id] ?? { tool_model_id, name: modelName(tool_model_id), total: 0, available: 0, checked_out: 0 };

  const filteredModels = useMemo(() => {
    const s = qModels.trim().toLowerCase();
    if (!s) return models;
    return models.filter((m) =>
      `${m.name} ${m.category ?? ""} ${m.tool_model_id} ${m.max_loan_hours ?? ""} ${m.max_qty_per_user ?? ""}`
        .toLowerCase()
        .includes(s)
    );
  }, [models, qModels]);

  const viewItems: ItemRowView[] = useMemo(() => {
    return items.map((it) => {
      const loan = loanMap[it.tool_item_id];
      if (!loan) {
        return {
          ...it,
          loan_status: "AVAILABLE",
          holder_name: "—",
          due_at: null,
          loan_id: null,
          loan_state: null,
        };
      }
      const u = userMap[loan.user_id];
      const holder = u ? `${u.first_name} ${u.last_name}` : loan.user_id;
      return {
        ...it,
        loan_status: "CHECKED_OUT",
        holder_name: holder,
        due_at: loan.due_at,
        loan_id: loan.loan_id,
        loan_state: loan.status ?? null,
      };
    });
  }, [items, loanMap, userMap]);

  const filteredItems = useMemo(() => {
    const s = qItems.trim().toLowerCase();
    const base = !s
      ? viewItems
      : viewItems.filter((it) =>
          `${it.tool_item_id} ${it.tool_model_id} ${it.cake_id} ${it.slot_id} ${it.tool_tag_id ?? ""} ${it.condition_status} ${it.loan_status} ${it.holder_name} ${it.due_at ?? ""} ${it.loan_state ?? ""}`
            .toLowerCase()
            .includes(s)
        );
    return availableOnly ? base.filter((x) => x.loan_status === "AVAILABLE") : base;
  }, [viewItems, qItems, availableOnly]);

  const dropUnconfirmed = async (tool_item_id: string) => {
    try {
      if (!confirm("Drop this UNCONFIRMED checked-out item from inventory? This will cancel the unconfirmed loan and deactivate the item.")) return;
      setBusyKey(`drop:${tool_item_id}`);
      setErr(null);
      await apiAdmin.dropUnconfirmedToolItem(tool_item_id);
      await load();
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

      {/* TOOL MODELS */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Tool Models</div>
            <div className="text-sm text-slate-600 mt-1">Define the catalog of tools</div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={load}>
              Refresh
            </button>
            <button
              className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
              onClick={() => setModal({ kind: "model_create" })}
            >
              + Add Model
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <input
            value={qModels}
            onChange={(e) => setQModels(e.target.value)}
            className="flex-1 rounded-xl border px-4 py-2"
            placeholder="Search tool models..."
          />
        </div>

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-4">Name</th>
                <th className="text-left p-4">Category</th>
                <th className="text-left p-4">In Stock</th>
                <th className="text-left p-4">Total</th>
                <th className="text-left p-4">Max Loan (hrs)</th>
                <th className="text-left p-4">Max Qty/User</th>
                <th className="text-left p-4">Model ID</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((m) => {
                const inv = invFor(m.tool_model_id);
                return (
                  <tr key={m.tool_model_id} className="border-t border-slate-100">
                    <td className="p-4 font-medium">{m.name}</td>
                    <td className="p-4">{m.category ?? "—"}</td>
                    <td className="p-4 font-semibold">{inv.available}</td>
                    <td className="p-4">{inv.total}</td>
                    <td className="p-4">{fmtOpt(m.max_loan_hours)}</td>
                    <td className="p-4">{fmtOpt(m.max_qty_per_user)}</td>
                    <td className="p-4 font-mono text-xs">{m.tool_model_id}</td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        className="rounded-lg border px-3 py-1 hover:bg-slate-50"
                        onClick={() => setModal({ kind: "model_edit", m })}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-lg border px-3 py-1 hover:bg-rose-50 text-rose-700"
                        onClick={async () => {
                          if (!confirm("Delete tool model?")) return;
                          await apiAdmin.deleteToolModel(m.tool_model_id);
                          await load();
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-slate-500">
                    No tool models.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOOL ITEMS */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Tool Items</div>
            <div className="text-sm text-slate-600 mt-1">Physical assets (they exist even when checked out)</div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={load}>
              Refresh
            </button>
            <button
              className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
              onClick={() => setModal({ kind: "item_create" })}
            >
              + Add Item
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-3 items-center">
          <input
            value={qItems}
            onChange={(e) => setQItems(e.target.value)}
            className="flex-1 rounded-xl border px-4 py-2"
            placeholder="Search tool items..."
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />
            Available only
          </label>
        </div>

        <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-4">Tool Item</th>
                <th className="text-left p-4">Model</th>
                <th className="text-left p-4">Cake/Slot</th>
                <th className="text-left p-4">Tag</th>
                <th className="text-left p-4">Condition</th>
                <th className="text-left p-4">Active</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Holder</th>
                <th className="text-left p-4">Due</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((it) => {
                const isUnconfirmed = (it.loan_state ?? "").toLowerCase() === "unconfirmed";
                const busyDrop = busyKey === `drop:${it.tool_item_id}`;

                return (
                  <tr key={it.tool_item_id} className="border-t border-slate-100">
                    <td className="p-4 font-mono text-xs">{it.tool_item_id}</td>
                    <td className="p-4">{modelName(it.tool_model_id)}</td>
                    <td className="p-4 font-mono text-xs">
                      {it.cake_id}/{it.slot_id}
                    </td>
                    <td className="p-4 font-mono text-xs">{it.tool_tag_id ?? "—"}</td>
                    <td className="p-4">{it.condition_status}</td>
                    <td className="p-4">{it.is_active ? "yes" : "no"}</td>
                    <td className="p-4">
                      <span
                        className={[
                          "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                          it.loan_status === "AVAILABLE"
                            ? "bg-emerald-100 text-emerald-700"
                            : isUnconfirmed
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700",
                        ].join(" ")}
                      >
                        {it.loan_status === "AVAILABLE" ? "AVAILABLE" : isUnconfirmed ? "CHECKED OUT (UNCONFIRMED)" : "CHECKED OUT"}
                      </span>
                    </td>
                    <td className="p-4">{it.holder_name}</td>
                    <td className="p-4 font-mono text-xs">{it.due_at ? new Date(it.due_at).toLocaleString() : "—"}</td>
                    <td className="p-4 text-right space-x-2">
                      <button className="rounded-lg border px-3 py-1 hover:bg-slate-50" onClick={() => setModal({ kind: "tag", it })}>
                        Assign Tag
                      </button>
                      <button className="rounded-lg border px-3 py-1 hover:bg-slate-50" onClick={() => setModal({ kind: "item_edit", it })}>
                        Edit
                      </button>

                      {it.loan_status === "CHECKED_OUT" && isUnconfirmed ? (
                        <button
                          disabled={busyDrop}
                          className="rounded-lg border px-3 py-1 hover:bg-rose-50 text-rose-700 disabled:opacity-40"
                          onClick={() => dropUnconfirmed(it.tool_item_id)}
                        >
                          Drop Unconfirmed
                        </button>
                      ) : (
                        <button
                          className="rounded-lg border px-3 py-1 hover:bg-rose-50 text-rose-700"
                          onClick={async () => {
                            if (!confirm("Delete tool item?")) return;
                            await apiAdmin.deleteToolItem(it.tool_item_id);
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-slate-500">
                    No tool items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALS */}
      {modal?.kind === "model_create" ? (
        <ToolModelModal
          title="Create Tool Model"
          initial={{ name: "", category: "", description: "", max_loan_hours: "", max_qty_per_user: "" }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            const max_loan_hours = toOptInt(v.max_loan_hours);
            const max_qty_per_user = toOptInt(v.max_qty_per_user);
            await apiAdmin.createToolModel({
              name: v.name,
              category: v.category || null,
              description: v.description || null,
              max_loan_hours,
              max_qty_per_user,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "model_edit" ? (
        <ToolModelModal
          title="Edit Tool Model"
          initial={{
            name: modal.m.name,
            category: modal.m.category ?? "",
            description: modal.m.description ?? "",
            max_loan_hours: modal.m.max_loan_hours?.toString() ?? "",
            max_qty_per_user: modal.m.max_qty_per_user?.toString() ?? "",
          }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            const max_loan_hours = toOptInt(v.max_loan_hours);
            const max_qty_per_user = toOptInt(v.max_qty_per_user);
            await apiAdmin.patchToolModel(modal.m.tool_model_id, {
              name: v.name,
              category: v.category || null,
              description: v.description || null,
              max_loan_hours,
              max_qty_per_user,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "item_create" ? (
        <ToolItemModal
          title="Create Tool Item"
          models={models}
          readerId="kiosk_1_reader_1"
          initial={{
            tool_model_id: models[0]?.tool_model_id ?? "",
            cake_id: "cake_1",
            slot_id: "1",
            condition_status: "ok",
            is_active: true,
            tool_tag_id: "",
          }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            const tag = v.tool_tag_id.trim();
            if (!tag) throw new Error("tool_tag_id is required.");
            await apiAdmin.createToolItem({
              tool_model_id: v.tool_model_id,
              cake_id: v.cake_id,
              slot_id: v.slot_id,
              condition_status: v.condition_status,
              is_active: v.is_active,
              tool_tag_id: tag,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "item_edit" ? (
        <ToolItemModal
          title="Edit Tool Item"
          models={models}
          readerId="kiosk_1_reader_1"
          initial={{
            tool_model_id: modal.it.tool_model_id,
            cake_id: modal.it.cake_id,
            slot_id: modal.it.slot_id,
            condition_status: (modal.it.condition_status as ConditionStatus) ?? "ok",
            is_active: modal.it.is_active,
            tool_tag_id: modal.it.tool_tag_id ?? "",
          }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            const tag = v.tool_tag_id.trim();
            if (!tag) throw new Error("tool_tag_id is required.");
            await apiAdmin.patchToolItem(modal.it.tool_item_id, {
              tool_model_id: v.tool_model_id,
              cake_id: v.cake_id,
              slot_id: v.slot_id,
              condition_status: v.condition_status,
              is_active: v.is_active,
              tool_tag_id: tag,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "tag" ? (
        <AssignToolTagModal toolItem={modal.it} readerId="kiosk_1_reader_1" onClose={() => setModal(null)} onDone={load} />
      ) : null}
    </div>
  );
}

function ToolModelModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: ModelForm;
  onClose: () => void;
  onSave: (v: ModelForm) => Promise<void>;
}) {
  const [v, setV] = useState<ModelForm>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

          <Field label="Name">
            <input className="w-full rounded-xl border px-3 py-2" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>

          <Field label="Category">
            <input className="w-full rounded-xl border px-3 py-2" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          </Field>

          <Field label="Description">
            <textarea
              className="w-full rounded-xl border px-3 py-2"
              rows={3}
              value={v.description}
              onChange={(e) => setV({ ...v, description: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Max Loan Hours (optional)">
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={v.max_loan_hours}
                onChange={(e) => setV({ ...v, max_loan_hours: e.target.value })}
                placeholder="e.g. 8, 24, 72"
              />
              <div className="mt-1 text-xs text-slate-500">Blank = no limit.</div>
            </Field>

            <Field label="Max Qty Per User (optional)">
              <input
                className="w-full rounded-xl border px-3 py-2"
                value={v.max_qty_per_user}
                onChange={(e) => setV({ ...v, max_qty_per_user: e.target.value })}
                placeholder="e.g. 1, 2, 5"
              />
              <div className="mt-1 text-xs text-slate-500">Blank = no limit.</div>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>
              Cancel
            </button>
            <button
              disabled={busy}
              className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
              onClick={async () => {
                try {
                  setBusy(true);
                  setErr(null);
                  await onSave(v);
                } catch (e: any) {
                  setErr(msg(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolItemModal({
  title,
  models,
  initial,
  readerId,
  onClose,
  onSave,
}: {
  title: string;
  models: ToolModel[];
  initial: ItemForm;
  readerId: string;
  onClose: () => void;
  onSave: (v: ItemForm) => Promise<void>;
}) {
  const [v, setV] = useState<ItemForm>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setV(initial);
    setErr(null);
    setBusy(false);
  }, [initial]);

  const waitForTap = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiUser.rfidSetMode({ reader_id: readerId, mode: "tool" });
      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "tool");
        if (r.ok && r.scan) {
          const id = r.scan.tag_id ?? r.scan.uid;
          if (id) {
            setV((p) => ({ ...p, tool_tag_id: id }));
            return;
          }
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      setErr("No tap received. Tap again or paste Tag ID.");
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

          <Field label="Tool Model">
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={v.tool_model_id}
              onChange={(e) => setV({ ...v, tool_model_id: e.target.value })}
            >
              {models.map((m) => (
                <option key={m.tool_model_id} value={m.tool_model_id}>
                  {m.name} ({m.tool_model_id.slice(0, 6)}…)
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Cake ID">
              <input className="w-full rounded-xl border px-3 py-2" value={v.cake_id} onChange={(e) => setV({ ...v, cake_id: e.target.value })} />
            </Field>
            <Field label="Slot ID">
              <input className="w-full rounded-xl border px-3 py-2" value={v.slot_id} onChange={(e) => setV({ ...v, slot_id: e.target.value })} />
            </Field>
          </div>

          <Field label="Condition">
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={v.condition_status}
              onChange={(e) => setV({ ...v, condition_status: e.target.value as ConditionStatus })}
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Active">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />
              is_active
            </label>
          </Field>

          <Field label="Tool Tag ID (required)">
            <input
              className="w-full rounded-xl border px-3 py-2 font-mono"
              value={v.tool_tag_id}
              onChange={(e) => setV({ ...v, tool_tag_id: e.target.value })}
              placeholder="Tap tag or paste"
            />
            <div className="mt-2 flex items-center gap-2">
              <button disabled={busy} className="rounded-xl border px-4 py-2 hover:bg-slate-50 disabled:opacity-40" onClick={waitForTap}>
                Wait for tap
              </button>
              <div className="text-xs text-slate-500">
                Reader: <span className="font-mono">{readerId}</span>
              </div>
            </div>
          </Field>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>
              Cancel
            </button>
            <button
              disabled={busy}
              className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
              onClick={async () => {
                try {
                  setBusy(true);
                  setErr(null);
                  await onSave(v);
                } catch (e: any) {
                  setErr(msg(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignToolTagModal({
  toolItem,
  readerId,
  onClose,
  onDone,
}: {
  toolItem: ToolItem;
  readerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTag("");
    setErr(null);
    setBusy(false);
  }, [toolItem.tool_item_id]);

  const waitForTap = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiUser.rfidSetMode({ reader_id: readerId, mode: "tool" });
      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "tool");
        if (r.ok && r.scan) {
          const id = r.scan.tag_id ?? r.scan.uid;
          if (id) {
            setTag(id);
            return;
          }
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      setErr("No tap received. Tap again or paste ID.");
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    const tool_tag_id = tag.trim();
    if (!tool_tag_id) {
      setErr("Tool tag is empty.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiAdmin.assignToolTag(toolItem.tool_item_id, tool_tag_id);
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">Assign Tool Tag</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="rounded-xl border bg-slate-50 p-4">
            <div className="font-semibold">Tool Item</div>
            <div className="text-xs text-slate-500 font-mono">{toolItem.tool_item_id}</div>
            <div className="text-xs text-slate-500">
              current: <span className="font-mono">{toolItem.tool_tag_id ?? "—"}</span>
            </div>
          </div>

          {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

          <div className="text-sm font-medium text-slate-700">Tool Tag ID</div>
          <input className="w-full rounded-xl border px-4 py-3 font-mono" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tap or paste UID" />

          <div className="flex items-center gap-3">
            <button disabled={busy} className="rounded-xl border px-4 py-2 hover:bg-slate-50 disabled:opacity-40" onClick={waitForTap}>
              Wait for tap
            </button>
            <button disabled={busy} className="ml-auto rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40" onClick={assign}>
              Assign
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Reader: <span className="font-mono">{readerId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
