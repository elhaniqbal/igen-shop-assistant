import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolModel } from "../../lib/api.admin";
import { apiUser, type BatchStatusItem } from "../../lib/api.user";
import { HardwareOverlay } from "../../components/HardwareOverlay";

function msg(e: any) { return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed"; }
type Phase = "select_period" | "running" | "confirm_pickup" | "done" | "failed";
type QueueItem = { tool_model_id: string; label: string };

function findPendingRequest(items: BatchStatusItem[]) {
  return items.find((x) => (x.stage || x.hw_status) === "waiting_user_confirm")?.request_id || null;
}
function isFinished(items: BatchStatusItem[]) {
  return items.length > 0 && items.every((x) => ["dispensed_ok", "succeeded", "failed"].includes(x.hw_status) || ["succeeded", "failed"].includes(String(x.stage || "")));
}

export function DispenseModal({ open, onClose, tool, cartItems, onDispenseCompleted }: { open: boolean; onClose: () => void; tool?: ToolModel | null; cartItems?: { tool_model_id: string; qty: number; label?: string }[]; userId: string; readerId: string; onDispenseCompleted: () => void; }) {
  const [phase, setPhase] = useState<Phase>("select_period");
  const [hours, setHours] = useState<number>(8);
  const [err, setErr] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<BatchStatusItem[]>([]);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("select_period"); setHours(8); setErr(""); setQueue([]); setIdx(0); setBatchId(null); setBatchItems([]); setPendingRequestId(null);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); pollRef.current = null; };
  }, [open]);

  const effectiveCart = useMemo(() => {
    if (cartItems?.length) return cartItems.filter((x) => x.qty > 0);
    if (tool) return [{ tool_model_id: tool.tool_model_id, qty: 1, label: tool.name }];
    return [];
  }, [cartItems, tool]);
  const expandedQueue = useMemo<QueueItem[]>(() => effectiveCart.flatMap((x) => Array.from({ length: x.qty }, () => ({ tool_model_id: x.tool_model_id, label: x.label ?? "Tool" }))), [effectiveCart]);
  const current = queue[idx] ?? null;
  const stopPoll = () => { if (pollRef.current) window.clearInterval(pollRef.current); pollRef.current = null; };

  const pollBatch = async (bid: string, i: number, q: QueueItem[]) => {
    const st = await apiUser.dispenseStatus(bid);
    setBatchItems(st.items);
    const pending = findPendingRequest(st.items);
    setPendingRequestId(pending);
    if (pending) { setPhase("confirm_pickup"); return; }
    if (!isFinished(st.items)) return;
    stopPoll();
    const ok = st.items.some((x) => x.hw_status === "dispensed_ok" || x.hw_status === "succeeded");
    if (!ok) { await dispenseOne(i + 1, q); return; }
    await dispenseOne(i + 1, q);
  };

  const dispenseOne = async (i: number, q: QueueItem[]) => {
    stopPoll();
    const item = q[i];
    if (!item) {
      setPhase("done");
      onDispenseCompleted();
      window.setTimeout(() => onClose(), 750);
      return;
    }
    setIdx(i); setBatchId(null); setBatchItems([]); setPendingRequestId(null); setErr(""); setPhase("running");
    const resp = await apiUser.dispense({ items: [{ tool_model_id: item.tool_model_id, qty: 1 }], loan_period_hours: hours });
    setBatchId(resp.batch_id);
    await pollBatch(resp.batch_id, i, q);
    pollRef.current = window.setInterval(() => pollBatch(resp.batch_id, i, q).catch((e) => setErr(msg(e))), 900);
  };

  const startDispense = async () => {
    try {
      if (!expandedQueue.length) { setErr("Nothing selected to dispense."); return; }
      setQueue(expandedQueue); setIdx(0); setPhase("running");
      await dispenseOne(0, expandedQueue);
    } catch (e: any) { setErr(msg(e)); setPhase("failed"); }
  };

  const confirmPickup = async () => {
    if (!pendingRequestId) return;
    try { await apiUser.dispenseConfirmRequest(pendingRequestId); setPhase("running"); setPendingRequestId(null); }
    catch (e: any) { setErr(msg(e)); }
  };
  const cancelPickup = async () => {
    if (!pendingRequestId) return;
    try { await apiUser.dispenseCancelRequest(pendingRequestId); setPhase("failed"); setPendingRequestId(null); setErr("Pickup cancelled."); }
    catch (e: any) { setErr(msg(e)); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[30px] bg-white shadow-2xl">
        {(phase === "running" || phase === "confirm_pickup") ? <HardwareOverlay title={phase === "confirm_pickup" ? "Confirm pickup" : "Dispensing tools"} subtitle={phase === "confirm_pickup" ? "Take the tool at the door, then confirm to continue." : current ? `Preparing ${current.label}` : "Preparing your request"} /> : null}
        <div className="flex items-center justify-between border-b px-6 py-4"><div className="text-lg font-bold">Dispense tools</div><button className="rounded-xl px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={() => { stopPoll(); onClose(); }}>✕</button></div>
        <div className="px-6 py-5">
          <div className="rounded-2xl border bg-rose-50 p-4"><div className="text-base font-semibold">Cart</div><div className="mt-2 space-y-1 text-sm text-slate-700">{effectiveCart.length ? effectiveCart.map((x) => <div key={x.tool_model_id} className="flex items-center justify-between"><span className="font-semibold">{x.label ?? "Tool"}</span><span className="font-semibold">x{x.qty}</span></div>) : <div className="text-slate-600">No items selected.</div>}</div></div>
          {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div> : null}
          {phase === "select_period" ? <div className="mt-5 space-y-4"><div className="text-sm font-medium text-slate-700">Expected return period</div><select className="w-full rounded-2xl border px-4 py-3" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[2,4,8,12,24].map((h)=><option key={h} value={h}>{h} hours</option>)}</select><div className="flex justify-end gap-3"><button className="rounded-2xl border px-4 py-2" onClick={onClose}>Cancel</button><button className="rounded-2xl bg-rose-600 px-4 py-2 font-semibold text-white" onClick={startDispense}>Confirm dispense</button></div></div> : null}
          {phase === "confirm_pickup" ? <div className="mt-5 rounded-2xl border bg-slate-50 p-4"><div className="text-base font-semibold text-slate-900">Take your tool from the door</div><div className="mt-2 text-sm text-slate-600">Once the item is in hand, press confirm to continue the queue.</div><div className="mt-4 flex justify-end gap-3"><button className="rounded-2xl border px-4 py-2" onClick={cancelPickup}>Cancel</button><button className="rounded-2xl bg-rose-600 px-4 py-2 font-semibold text-white" onClick={confirmPickup}>I took the tool</button></div></div> : null}
          {phase === "failed" ? <div className="mt-5 flex justify-end"><button className="rounded-2xl border px-4 py-2" onClick={onClose}>Close</button></div> : null}
          {phase === "done" ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Dispense complete ✅</div> : null}
          {(phase === "running" || phase === "confirm_pickup") ? <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700"><div className="flex items-center justify-between"><div className="font-semibold">Current item: {current?.label ?? "—"}</div><div className="text-xs text-slate-500">{queue.length ? `${idx + 1} / ${queue.length}` : ""}</div></div><div className="mt-2 text-xs text-slate-500">Batch: {batchId || "Creating request…"}</div></div> : null}
        </div>
      </div>
    </div>
  );
}
