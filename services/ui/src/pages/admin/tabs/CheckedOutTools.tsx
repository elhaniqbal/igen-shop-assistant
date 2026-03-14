import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type LoanOut, type User } from "../../../lib/api.admin";

function msg(e: any) {
  if (e && typeof e === "object") {
    if ("message" in e) return String((e as any).message);
    if ("detail" in e) return typeof (e as any).detail === "string" ? (e as any).detail : JSON.stringify((e as any).detail);
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

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function CheckedOutTools() {
  const [rows, setRows] = useState<LoanOut[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);

      const [allLoans, allUsers] = await Promise.all([
        apiAdmin.listLoans({ limit: 2000 }),
        apiAdmin.listUsers({ limit: 1000 }),
      ]);

      const um: Record<string, User> = {};
      for (const u of allUsers) um[u.user_id] = u;
      setUsers(um);

      // show open loans (includes unconfirmed)
      setRows(allLoans.filter((r) => !r.returned_at));
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const unconfirmedCount = useMemo(() => rows.filter((r) => r.status === "unconfirmed").length, [rows]);

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
    <div className="rounded-2xl border p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Checked Out Tools</div>
          <div className="text-sm text-slate-600 mt-1">
            Open loans. <span className="font-semibold">{unconfirmedCount}</span> unconfirmed pickup(s).
          </div>
        </div>
        <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={load}>
          Refresh
        </button>
      </div>

      {err ? <div className="mt-3 rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

      <div className="mt-4 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="opacity-70">
            <tr>
              <th className="text-left py-2">Loan</th>
              <th className="text-left py-2">User</th>
              <th className="text-left py-2">Tool Item</th>
              <th className="text-left py-2">Issued</th>
              <th className="text-left py-2">Due</th>
              <th className="text-left py-2">Status</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isUnconfirmed = (r.status ?? "").toLowerCase() === "unconfirmed";
              const busy = busyLoanId === r.loan_id;

              return (
                <tr key={r.loan_id} className="border-t">
                  <td className="py-2 font-mono">{r.loan_id.slice(0, 8)}…</td>
                  <td className="py-2">{userLabel(r.user_id)}</td>
                  <td className="py-2 font-mono">{r.tool_item_id}</td>
                  <td className="py-2">{r.issued_at}</td>
                  <td className="py-2">{r.due_at}</td>
                  <td className="py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-2 text-right">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-slate-500">
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
