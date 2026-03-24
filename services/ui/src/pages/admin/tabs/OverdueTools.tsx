import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type LoanOut } from "../../../lib/api.admin";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

function hoursOverdue(due_at: string) {
  const due = new Date(due_at).getTime();
  const now = Date.now();
  const diffMs = now - due;
  if (diffMs <= 0) return 0;
  return Math.round((diffMs / 1000 / 60 / 60) * 10) / 10;
}

export default function OverdueTools() {
  const [loans, setLoans] = useState<LoanOut[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      const rows = await apiAdmin.listLoans({ overdue_only: true, limit: 5000 });
      setLoans(rows);
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return loans
      .map((l) => ({ ...l, overdue_hours: hoursOverdue(l.due_at) }))
      .filter((l) => l.overdue_hours > 0)
      .sort((a, b) => b.overdue_hours - a.overdue_hours);
  }, [loans]);

  return (
    <div className="rounded-2xl border p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Overdue</div>
        <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={load}>
          Refresh
        </button>
      </div>

      {err ? <div className="mt-3 rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

      <div className="mt-4 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="opacity-70">
            <tr>
              <th className="text-left py-3">Loan</th>
              <th className="text-left py-3">User</th>
              <th className="text-left py-3">Tool Item</th>
              <th className="text-right py-3">Overdue (h)</th>
              <th className="text-right py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.loan_id} className="border-t align-top">
                <td className="py-4 font-mono text-[13px]">{r.loan_id.slice(0, 8)}…</td>
                <td className="py-4 font-mono text-[13px]">{r.user_id}</td>
                <td className="py-4 font-mono text-[13px]">{r.tool_item_id}</td>
                <td className="py-4 text-right text-base font-semibold">{r.overdue_hours}</td>
                <td className="py-4 text-right">
                  <OverdueActions loan={r} onDone={load} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-slate-500">No overdue rows.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OverdueActions({ loan, onDone }: { loan: LoanOut; onDone: () => void }) {
  const [hours, setHours] = useState(24);
  const [extendBusy, setExtendBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const extend = async () => {
    setExtendBusy(true);
    setNote(null);
    try {
      const due = new Date(loan.due_at).getTime();
      const next = new Date(due + hours * 60 * 60 * 1000).toISOString();
      await apiAdmin.patchLoan(loan.loan_id, { due_at: next, status: "active" });
      setNote(`Extended by ${hours}h`);
      onDone();
    } catch (e: any) {
      setNote(msg(e));
    } finally {
      setExtendBusy(false);
    }
  };

  const sendEmail = async () => {
    setEmailBusy(true);
    setNote(null);
    try {
      const res = await apiAdmin.sendOverdueEmail(loan.loan_id);
      setNote(res.message || "Alert sent");
    } catch (e: any) {
      setNote(msg(e));
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="inline-flex flex-wrap items-center justify-end gap-2">
        <select className="rounded-lg border px-3 py-2 text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {[2, 4, 8, 12, 24, 48, 72].map((h) => (
            <option key={h} value={h}>+{h}h</option>
          ))}
        </select>
        <button
          disabled={extendBusy || emailBusy}
          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
          onClick={extend}
        >
          Extend
        </button>
        <button
          disabled={extendBusy || emailBusy}
          className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40"
          onClick={sendEmail}
        >
          Send Email Alert
        </button>
      </div>
      {note ? <div className="text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}
