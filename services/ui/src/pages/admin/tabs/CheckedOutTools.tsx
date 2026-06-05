import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type LoanOut, type ToolItem, type ToolModel, type User } from "../../../lib/api.admin";

function msg(e: any) {
  if (e && typeof e === "object") {
    if ("message" in e) return String((e as any).message);
    if ("detail" in e) {
      return typeof (e as any).detail === "string"
        ? (e as any).detail
        : JSON.stringify((e as any).detail);
    }
  }
  return "request failed";
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();

  const cls =
    s === "unconfirmed"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : s === "overdue"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : s === "active"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : s === "canceled"
      ? "bg-slate-50 text-slate-700 border-slate-200"
      : "bg-slate-50 text-slate-700 border-slate-200";

  const label = s ? s.toUpperCase() : "UNKNOWN";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export default function CheckedOutTools() {
  const [rows, setRows] = useState<LoanOut[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [items, setItems] = useState<Record<string, ToolItem>>({});
  const [models, setModels] = useState<Record<string, ToolModel>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);

      const [allLoans, allUsers, itemRows, modelRows] = await Promise.all([
        apiAdmin.listLoans({ limit: 2000 }),
        apiAdmin.listUsers({ limit: 1000 }),
        apiAdmin.listToolItems({ limit: 2000 }),
        apiAdmin.listToolModels({ limit: 1000 }),
      ]);

      const um: Record<string, User> = {};
      for (const u of allUsers) um[u.user_id] = u;
      setUsers(um);

      setItems(Object.fromEntries(itemRows.map((i) => [i.tool_item_id, i])));
      setModels(Object.fromEntries(modelRows.map((m) => [m.tool_model_id, m])));

      setRows(allLoans.filter((r) => !r.returned_at));
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const unconfirmedCount = useMemo(
    () => rows.filter((r) => r.status === "unconfirmed").length,
    [rows]
  );

  const enrichedRows = useMemo(() => {
    return rows.map((r) => {
      const item = items[r.tool_item_id];
      const model = item ? models[item.tool_model_id] : undefined;
      const toolName =
        r.tool_name ||
        model?.name ||
        item?.tool_model_id ||
        "Unknown Tool";

      return {
        ...r,
        tool_name_display: toolName,
        tool_public_id: r.tool_item_id,
      };
    });
  }, [rows, items, models]);

  const userLabel = (user_id: string) => {
    const u = users[user_id];
    return u ? `${u.first_name} ${u.last_name}` : user_id;
  };

  const onConfirm = async (loan_id: string) => {
    try {
      setBusyLoanId(loan_id);
      setErr(null);
      await apiAdmin.confirmLoan(loan_id);
      await load();
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusyLoanId(null);
    }
  };

  const onCancel = async (loan_id: string) => {
    try {
      if (!confirm("Cancel this UNCONFIRMED checkout? This will free the item back into inventory.")) return;
      setBusyLoanId(loan_id);
      setErr(null);
      await apiAdmin.cancelUnconfirmedLoan(loan_id);
      await load();
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusyLoanId(null);
    }
  };

  return (
    <div className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_14px_50px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Checked Out Tools</div>
          <div className="mt-1 text-sm text-slate-600">
            Open loans. <span className="font-semibold">{unconfirmedCount}</span> unconfirmed pickup(s).
          </div>
        </div>
        <button
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {err ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {err}
        </div>
      ) : null}

      <div className="mt-5 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-3">Loan</th>
              <th className="py-3">User</th>
              <th className="py-3">Tool</th>
              <th className="py-3">Issued</th>
              <th className="py-3">Due</th>
              <th className="py-3">Status</th>
              <th className="py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enrichedRows.map((r) => {
              const isUnconfirmed = (r.status ?? "").toLowerCase() === "unconfirmed";
              const busy = busyLoanId === r.loan_id;

              return (
                <tr key={r.loan_id} className="border-t border-slate-100 align-top">
                  <td className="py-4 font-mono">{r.loan_id.slice(0, 8)}…</td>
                  <td className="py-4">{userLabel(r.user_id)}</td>
                  <td className="py-4">
                    <div className="font-semibold text-slate-900">{r.tool_name_display}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">{r.tool_public_id}</div>
                  </td>
                  <td className="py-4 text-slate-600">{r.issued_at}</td>
                  <td className="py-4 text-slate-600">{r.due_at}</td>
                  <td className="py-4">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-4 text-right">
                    {isUnconfirmed ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          disabled={busy}
                          className="rounded-xl border px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-40"
                          onClick={() => onConfirm(r.loan_id)}
                        >
                          Confirm pickup
                        </button>
                        <button
                          disabled={busy}
                          className="rounded-xl border px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                          onClick={() => onCancel(r.loan_id)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {enrichedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500">
                  No open loans.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}