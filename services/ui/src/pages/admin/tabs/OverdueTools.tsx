import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type LoanOut, type ToolItem, type ToolModel } from "../../../lib/api.admin";

function msg(e: any) { return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed"; }
function hoursOverdue(due_at: string) { const diffMs = Date.now() - new Date(due_at).getTime(); return diffMs <= 0 ? 0 : Math.round((diffMs / 36e5) * 10) / 10; }

export default function OverdueTools() {
  const [loans, setLoans] = useState<LoanOut[]>([]);
  const [items, setItems] = useState<Record<string, ToolItem>>({});
  const [models, setModels] = useState<Record<string, ToolModel>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      const [loanRows, itemRows, modelRows] = await Promise.all([
        apiAdmin.listLoans({ overdue_only: true, limit: 200 }),
        apiAdmin.listToolItems({ limit: 200 }),
        apiAdmin.listToolModels({ limit: 200 }),
      ]);
      setLoans(loanRows);
      setItems(Object.fromEntries(itemRows.map((i) => [i.tool_item_id, i])));
      setModels(Object.fromEntries(modelRows.map((m) => [m.tool_model_id, m])));
    } catch (e: any) { setErr(msg(e)); }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => loans.map((l) => {
    const item = items[l.tool_item_id];
    const model = item ? models[item.tool_model_id] : undefined;
    return {
      ...l,
      overdue_hours: hoursOverdue(l.due_at),
      tool_name: (l as any).tool_name || model?.name || item?.tool_model_id || "Unknown Tool",
      tool_public_id: l.tool_item_id,
    };
  }).filter((l) => l.overdue_hours > 0).sort((a,b) => b.overdue_hours - a.overdue_hours), [loans, items, models]);

  return (
    <div className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_14px_50px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex items-center justify-between gap-3"><div><div className="text-lg font-bold text-slate-900">Overdue tools</div><div className="mt-1 text-sm text-slate-600">Names and item IDs are shown together so admins can act quickly.</div></div><button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={load}>Refresh</button></div>
      {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div> : null}
      <div className="mt-5 overflow-auto"><table className="min-w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-3">Tool</th><th className="py-3">User</th><th className="py-3">Due</th><th className="py-3 text-right">Overdue (h)</th><th className="py-3 text-right">Actions</th></tr></thead><tbody>{rows.map((r: any) => <tr key={r.loan_id} className="border-t border-slate-100 align-top"><td className="py-4"><div className="font-semibold text-slate-900">{r.tool_name}</div><div className="mt-1 font-mono text-xs text-slate-500">{r.tool_public_id}</div></td><td className="py-4 font-mono text-[13px] text-slate-700">{r.user_id}</td><td className="py-4 text-slate-600">{new Date(r.due_at).toLocaleString()}</td><td className="py-4 text-right text-base font-bold text-slate-900">{r.overdue_hours}</td><td className="py-4 text-right"><OverdueActions loan={r} onDone={load} /></td></tr>)}{rows.length===0?<tr><td colSpan={5} className="py-10 text-center text-slate-500">No overdue rows.</td></tr>:null}</tbody></table></div>
    </div>
  );
}

function OverdueActions({ loan, onDone }: { loan: LoanOut; onDone: () => void }) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const extend = async () => { setBusy(true); setNote(null); try { const next = new Date(new Date(loan.due_at).getTime() + hours * 36e5).toISOString(); await apiAdmin.patchLoan(loan.loan_id, { due_at: next, status: "active" }); setNote(`Extended by ${hours}h`); onDone(); } catch (e: any) { setNote(msg(e)); } finally { setBusy(false); } };
  const sendEmail = async () => { setBusy(true); setNote(null); try { const res = await apiAdmin.sendOverdueEmail(loan.loan_id); setNote(res.message || "Alert sent"); } catch (e: any) { setNote(msg(e)); } finally { setBusy(false); } };
  return <div className="flex flex-col items-end gap-2"><div className="flex flex-wrap items-center justify-end gap-2"><select className="rounded-xl border px-3 py-2 text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[2,4,8,12,24,48,72].map((h)=><option key={h} value={h}>+{h}h</option>)}</select><button disabled={busy} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" onClick={extend}>Extend</button><button disabled={busy} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40" onClick={sendEmail}>Send Email</button></div>{note ? <div className="text-xs text-slate-500">{note}</div> : null}</div>;
}
