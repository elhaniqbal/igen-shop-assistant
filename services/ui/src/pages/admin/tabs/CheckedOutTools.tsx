import { useEffect, useState } from "react";
import { apiAdmin, type LoanOut } from "../../../lib/api.admin";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

export default function CheckedOutTools() {
  const [rows, setRows] = useState<LoanOut[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      setRows(await apiAdmin.listLoans({ active_only: true, limit: 2000 }));
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-2xl border p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Checked Out Tools</div>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.loan_id} className="border-t">
                <td className="py-2 font-mono">{r.loan_id.slice(0, 8)}…</td>
                <td className="py-2 font-mono">{r.user_id}</td>
                <td className="py-2 font-mono">{r.tool_item_id}</td>
                <td className="py-2">{r.issued_at}</td>
                <td className="py-2">{r.due_at}</td>
                <td className="py-2">{r.status}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-slate-500">No active loans.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
