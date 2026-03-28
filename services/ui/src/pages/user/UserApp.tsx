import { useEffect, useMemo, useState } from "react";
import { DispenseModal } from "./DispenseModal";
import { HardwareOverlay } from "../../components/HardwareOverlay";
import { BrandMark } from "../../components/BrandMark";
import { apiAdmin, type InventoryRow, type ToolModel } from "../../lib/api.admin";
import { apiUser, type LoanRow } from "../../lib/api.user";
import { CONFIG } from "../../lib/config";

function msg(e: any) {
  if (e && typeof e === "object") {
    if ("message" in e) return String((e as any).message);
    if ("detail" in e) return typeof (e as any).detail === "string" ? (e as any).detail : JSON.stringify((e as any).detail);
  }
  return "request failed";
}

type Tab = "browse" | "mytools" | "return";
type CartEntry = { tool_model_id: string; qty: number; label: string };
type ReturnPhase = "idle" | "running" | "confirm_insert" | "done" | "failed";

function fmtDT(s: string) { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleString() : s; }
function findPendingRequest(items: any[]) { return items.find((x) => (x.stage || x.hw_status) === "waiting_user_confirm")?.request_id || null; }
function isReturnFinished(items: any[]) { return items.length > 0 && items.every((x) => ["return_ok", "succeeded", "failed"].includes(x.hw_status) || ["succeeded", "failed"].includes(String(x.stage || ""))); }

export function UserApp({ userId, readerId, displayName, onLogout, canAdminMode, onAdminMode }: { userId: string; readerId: string; displayName: string; onLogout: () => void; canAdminMode: boolean; onAdminMode: () => void; }) {
  const [tab, setTab] = useState<Tab>("browse");
  const [toolModels, setToolModels] = useState<ToolModel[]>([]);
  const [inv, setInv] = useState<Record<string, InventoryRow>>({});
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnLoan, setReturnLoan] = useState<LoanRow | null>(null);
  const [returnPhase, setReturnPhase] = useState<ReturnPhase>("idle");
  const [returnErr, setReturnErr] = useState("");
  const [returnBatchId, setReturnBatchId] = useState<string | null>(null);
  const [returnRequestId, setReturnRequestId] = useState<string | null>(null);

  const cartItems = useMemo(() => Object.values(cart).filter((x) => x.qty > 0), [cart]);
  const cartCount = useMemo(() => cartItems.reduce((a, x) => a + x.qty, 0), [cartItems]);
  const clearCart = () => setCart({});

  const refreshBrowse = async () => {
    const [models, invRows] = await Promise.all([apiAdmin.listToolModels({ limit: 1000 }), apiAdmin.inventory()]);
    setToolModels(models);
    setInv(Object.fromEntries(invRows.map((r) => [r.tool_model_id, r])));
  };
  const refreshLoans = async () => { const resp = await apiUser.loans(); setLoans(resp.loans); };
  useEffect(() => { (async () => { try { setErr(null); await Promise.all([refreshBrowse(), refreshLoans()]); } catch (e: any) { setErr(msg(e)); } })(); }, []);

  const checkedOutCount = loans.filter((l) => !l.returned_at).length;
  const filteredModels = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return toolModels;
    return toolModels.filter((t) => `${t.name} ${t.category ?? ""} ${inv[t.tool_model_id]?.available ?? ""}`.toLowerCase().includes(s));
  }, [q, toolModels, inv]);

  const addToCart = (t: ToolModel) => setCart((prev) => ({ ...prev, [t.tool_model_id]: { tool_model_id: t.tool_model_id, qty: (prev[t.tool_model_id]?.qty ?? 0) + 1, label: t.name } }));
  const decFromCart = (tool_model_id: string) => setCart((prev) => {
    const cur = prev[tool_model_id]; if (!cur) return prev; const nextQty = cur.qty - 1; const copy = { ...prev }; if (nextQty <= 0) delete copy[tool_model_id]; else copy[tool_model_id] = { ...cur, qty: nextQty }; return copy;
  });

  const openReturnForLoan = (l: LoanRow) => { setReturnLoan(l); setReturnOpen(true); setReturnPhase("idle"); setReturnErr(""); setReturnBatchId(null); setReturnRequestId(null); };
  const closeReturn = () => { setReturnOpen(false); setReturnLoan(null); setReturnPhase("idle"); setReturnErr(""); setReturnBatchId(null); setReturnRequestId(null); };

  const startReturn = async () => {
    if (!returnLoan) return;
    try {
      setReturnPhase("running"); setReturnErr("");
      const resp = await apiUser.doReturn({ items: [{ tool_item_id: returnLoan.tool_item_id }] });
      setReturnBatchId(resp.batch_id);
      const poll = async () => {
        const st = await apiUser.returnStatus(resp.batch_id);
        const pending = findPendingRequest(st.items); setReturnRequestId(pending);
        if (pending) { setReturnPhase("confirm_insert"); return; }
        if (!isReturnFinished(st.items)) return;
        const ok = st.items.some((x: any) => x.hw_status === "return_ok" || x.hw_status === "succeeded");
        if (!ok) { setReturnErr("Return failed. Contact an admin."); setReturnPhase("failed"); return; }
        await refreshLoans(); await refreshBrowse(); setReturnPhase("done"); setTimeout(() => closeReturn(), 800);
      };
      await poll();
      const interval = window.setInterval(() => poll().catch((e) => { setReturnErr(msg(e)); setReturnPhase("failed"); window.clearInterval(interval); }), 900);
    } catch (e: any) { setReturnErr(msg(e)); setReturnPhase("failed"); }
  };

  const confirmReturn = async () => { if (!returnRequestId) return; try { await apiUser.returnConfirmRequest(returnRequestId); setReturnPhase("running"); } catch (e: any) { setReturnErr(msg(e)); } };
  const cancelReturn = async () => { if (!returnRequestId) return; try { await apiUser.returnCancelRequest(returnRequestId); setReturnErr("Return cancelled."); setReturnPhase("failed"); } catch (e: any) { setReturnErr(msg(e)); } };

  const ToolCard = ({ t }: { t: ToolModel }) => {
    const row = inv[t.tool_model_id]; const total = row?.total ?? 0; const avail = row?.available ?? 0; const pct = total > 0 ? Math.round((avail / total) * 100) : 0;
    return <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_16px_55px_rgba(15,23,42,0.08)] backdrop-blur"><div className="flex items-start gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700">⬢</div><div className="flex-1"><div className="font-semibold text-slate-900">{t.name}</div><div className="text-sm text-slate-600">{t.category ?? "—"}</div></div></div><div className="mt-4 text-xs text-slate-600"><div className="flex items-center justify-between"><span>Available</span><span className="font-semibold">{avail} of {total}</span></div><div className="mt-2 h-2 w-full rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div></div><button className="mt-5 w-full rounded-2xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-40" disabled={avail <= 0} onClick={() => addToCart(t)}>Add to Cart</button></div>;
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.10),_transparent_25%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_40%,#f8fafc_100%)]">
      <div className="border-b border-white/70 border-b border-white/70 bg-white/82 shadow-sm backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><BrandMark size={52} spinning /><div><div className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff2340]">HAVEN</div><div className="text-sm text-slate-600">Welcome, {displayName}</div></div></div><div className="flex items-center gap-3">{canAdminMode ? <button onClick={onAdminMode} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Admin Mode</button> : null}<button onClick={onLogout} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Logout</button></div></div></div>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-3xl font-black text-slate-950">Student tool access</div><div className="mt-2 text-slate-600">Browse inventory, dispense tools, and return checked-out items through one guided flow.</div></div><div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm"><div className="text-right text-xs text-slate-500"><div>Checked Out</div><div className="text-lg font-bold text-slate-900">{checkedOutCount}</div></div><div className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 font-bold text-white">{checkedOutCount}</div></div></div>
        {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div> : null}
        {cartCount > 0 ? <div className="mt-4 rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-slate-900">Cart</div><div className="text-sm text-slate-600">{cartCount} item(s)</div></div><div className="flex gap-2"><button className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={clearCart}>Clear</button><button className="rounded-2xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800" onClick={() => setCartOpen(true)}>Dispense Cart</button></div></div><div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{cartItems.map((ci) => <div key={ci.tool_model_id} className="flex items-center justify-between rounded-2xl border bg-slate-50 p-3"><div><div className="font-semibold text-slate-900">{ci.label}</div><div className="text-xs text-slate-500">Qty: {ci.qty}</div></div><div className="flex items-center gap-2"><button className="rounded-xl border px-3 py-1" onClick={() => decFromCart(ci.tool_model_id)}>–</button><div className="w-8 text-center font-semibold">{ci.qty}</div><button className="rounded-xl border px-3 py-1" onClick={() => { const t = toolModels.find((x) => x.tool_model_id === ci.tool_model_id); if (t) addToCart(t); }}>+</button></div></div>)}</div></div> : null}
        <div className="mt-6 flex gap-6 border-b border-slate-200">{([ ["browse","Browse Tools",null], ["mytools","My Tools",checkedOutCount], ["return","Return Tools",null] ] as const).map(([id,label,badge]) => <button key={id} onClick={() => setTab(id)} className={`relative -mb-px flex items-center gap-2 border-b-2 px-2 py-3 text-sm font-medium ${tab===id?"border-rose-600 text-rose-700":"border-transparent text-slate-600 hover:text-slate-900"}`}>{label}{badge ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span> : null}</button>)}</div>

        {tab === "browse" ? <div className="mt-6 space-y-6"><div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]"><div><div className="flex items-center gap-3"><input className="flex-1 rounded-2xl border bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-200" placeholder="Search tools..." value={q} onChange={(e) => setQ(e.target.value)} /><button className="rounded-2xl border px-4 py-3 text-sm hover:bg-slate-50" onClick={() => refreshBrowse().catch((e) => setErr(msg(e)))}>Refresh</button></div><div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">{filteredModels.map((t) => <ToolCard key={t.tool_model_id} t={t} />)}{filteredModels.length === 0 ? <div className="rounded-2xl border bg-white p-6 text-slate-600">No tools found.</div> : null}</div></div><div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm"><div className="text-lg font-bold text-slate-900">Need another tool?</div><div className="mt-2 text-sm leading-7 text-slate-600">Don’t see what you want? Scan this QR code to request stock or suggest additions.</div><div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-4"><img src="/stock_request_qr.png" alt="Stock request QR" className="mx-auto h-56 w-56 rounded-2xl bg-white p-2" /><a href={CONFIG.stockRequestUrl} target="_blank" rel="noreferrer" className="mt-4 block text-center text-sm font-semibold text-rose-700 underline underline-offset-4">Open stock request site</a></div></div></div></div> : null}

        {tab === "mytools" ? <div className="mt-6 space-y-4"><div className="flex items-center justify-between"><div className="text-sm text-slate-600">Your active loans.</div><button className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={() => refreshLoans().catch((e) => setErr(msg(e)))}>Refresh</button></div>{loans.length === 0 ? <div className="rounded-[28px] border bg-white p-6 text-slate-600">No active loans.</div> : loans.map((l) => <div key={l.loan_id} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm"><div className="flex items-start justify-between"><div className="flex items-start gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700">⬢</div><div><div className="font-semibold text-slate-900">{l.tool_name}</div><div className="text-sm text-slate-600">{l.tool_category ?? "—"}</div><div className="mt-3 text-sm text-slate-500">Issued: {fmtDT(l.issued_at)}<br/>Due: {fmtDT(l.due_at)}</div></div></div><div className={`rounded-full px-3 py-1 text-sm ${l.status === "overdue" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>{l.status}</div></div></div>)}</div> : null}

        {tab === "return" ? <div className="mt-6"><div className="mx-auto max-w-3xl rounded-[30px] border border-white/80 bg-white/90 p-8 shadow-sm"><div className="text-xl font-bold text-slate-900">Return tools</div><div className="mt-2 text-sm text-slate-600">Select a checked-out item, place it at the door when prompted, and confirm the return.</div>{loans.length === 0 ? <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-slate-600">No active loans to return.</div> : <div className="mt-5 space-y-3">{loans.map((l) => <div key={l.loan_id} className="flex items-center justify-between rounded-2xl border p-4"><div><div className="font-semibold">{l.tool_name}</div><div className="text-xs text-slate-500">{l.tool_category ?? "—"}</div><div className="mt-1 text-xs text-slate-500">Due: {fmtDT(l.due_at)}</div></div><button className="rounded-2xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800" onClick={() => openReturnForLoan(l)}>Return</button></div>)}</div>}</div></div> : null}
      </div>

      <DispenseModal open={cartOpen} onClose={() => setCartOpen(false)} cartItems={cartItems} userId={userId} readerId={readerId} onDispenseCompleted={async () => { await refreshLoans(); await refreshBrowse(); setTab("mytools"); clearCart(); setCartOpen(false); }} />

      {returnOpen && returnLoan ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className="relative w-full max-w-xl overflow-hidden rounded-[30px] bg-white shadow-2xl">{(returnPhase === "running" || returnPhase === "confirm_insert") ? <HardwareOverlay title={returnPhase === "confirm_insert" ? "Insert the tool" : "Returning tool"} subtitle={returnPhase === "confirm_insert" ? "Place the item at the door, then confirm to continue." : `Processing ${returnLoan.tool_name}`} /> : null}<div className="flex items-center justify-between border-b px-6 py-4"><div className="text-lg font-bold">Return tool</div><button className="rounded-xl px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={closeReturn}>✕</button></div><div className="space-y-4 px-6 py-5"><div className="rounded-2xl border bg-slate-50 p-4"><div className="font-semibold">{returnLoan.tool_name}</div><div className="text-sm text-slate-600">{returnLoan.tool_category ?? "—"}</div><div className="mt-1 text-xs text-slate-500">Due: {fmtDT(returnLoan.due_at)}</div></div>{returnErr ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{returnErr}</div> : null}{returnPhase === "idle" ? <div className="flex items-center justify-end gap-3"><button className="rounded-2xl border px-4 py-2" onClick={closeReturn}>Cancel</button><button className="rounded-2xl bg-rose-700 px-4 py-2 font-semibold text-white" onClick={startReturn}>Start Return</button></div> : null}{returnPhase === "confirm_insert" ? <div className="rounded-2xl border bg-slate-50 p-4"><div className="text-base font-semibold text-slate-900">Insert the tool at the door</div><div className="mt-2 text-sm text-slate-600">Once the item is placed, confirm so HAVEN can complete the return path.</div><div className="mt-4 flex justify-end gap-3"><button className="rounded-2xl border px-4 py-2" onClick={cancelReturn}>Cancel</button><button className="rounded-2xl bg-rose-700 px-4 py-2 font-semibold text-white" onClick={confirmReturn}>I inserted the tool</button></div></div> : null}{returnPhase === "failed" ? <div className="flex justify-end"><button className="rounded-2xl border px-4 py-2" onClick={closeReturn}>Close</button></div> : null}{returnPhase === "done" ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Return accepted ✅</div> : null}<div className="text-xs text-slate-500">Reader: <span className="font-mono">{readerId}</span>{returnBatchId ? <span className="ml-2">Batch: <span className="font-mono">{returnBatchId}</span></span> : null}</div></div></div></div> : null}
    </div>
  );
}
