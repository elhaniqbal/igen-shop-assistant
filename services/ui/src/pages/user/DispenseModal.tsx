import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolModel } from "../../lib/api.admin";
import { apiUser, type BatchStatusItem } from "../../lib/api.user";
import { HardwareOverlay } from "../../components/HardwareOverlay";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

type Phase = "select_period" | "running" | "confirm_pickup" | "done" | "failed";
type QueueItem = { tool_model_id: string; label: string };

function findPendingRequest(items: BatchStatusItem[]) {
  return (
    items.find((x) => {
      const s = String(x.stage || x.hw_status || "");
      return s === "waiting_user_confirm" || s === "waiting_user_insert" || s === "door_take_confirm" || s.startsWith("waiting_user");
    })?.request_id || null
  );
}

function isFinished(items: BatchStatusItem[]) {
  return (
    items.length > 0 &&
    items.every(
      (x) =>
        ["dispensed_ok", "succeeded", "failed"].includes(x.hw_status) ||
        ["succeeded", "failed"].includes(String(x.stage || ""))
    )
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function confirmToolReceipt(toolTagId: string) {
  const res = await fetch("/api/rfid/tool-confirm", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool_tag_id: toolTagId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : data?.message || "tool confirmation failed");
  }
  return data;
}

export function DispenseModal({
  open,
  onClose,
  tool,
  cartItems,
  readerId,
  onDispenseCompleted,
}: {
  open: boolean;
  onClose: () => void;
  tool?: ToolModel | null;
  cartItems?: { tool_model_id: string; qty: number; label?: string }[];
  userId: string;
  readerId: string;
  onDispenseCompleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("select_period");
  const [hours, setHours] = useState<number>(8);
  const [err, setErr] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<BatchStatusItem[]>([]);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [scanBusy, setScanBusy] = useState(false);

  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("select_period");
    setHours(8);
    setErr("");
    setQueue([]);
    setIdx(0);
    setBatchId(null);
    setBatchItems([]);
    setPendingRequestId(null);
    setScanInput("");
    setScanBusy(false);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open]);

  const effectiveCart = useMemo(() => {
    if (cartItems?.length) return cartItems.filter((x) => x.qty > 0);
    if (tool) return [{ tool_model_id: tool.tool_model_id, qty: 1, label: tool.name }];
    return [];
  }, [cartItems, tool]);

  const expandedQueue = useMemo<QueueItem[]>(
    () =>
      effectiveCart.flatMap((x) =>
        Array.from({ length: x.qty }, () => ({
          tool_model_id: x.tool_model_id,
          label: x.label ?? "Tool",
        }))
      ),
    [effectiveCart]
  );

  const current = queue[idx] ?? null;

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const pollBatch = async (bid: string, i: number, q: QueueItem[]) => {
    const st = await apiUser.dispenseStatus(bid);
    setBatchItems(st.items);

    const pending = findPendingRequest(st.items);
    setPendingRequestId(pending);

    if (pending) {
      setPhase("confirm_pickup");
      stopPoll();
      return;
    }

    if (!isFinished(st.items)) return;

    stopPoll();

    const ok = st.items.some((x) => x.hw_status === "dispensed_ok" || x.hw_status === "succeeded");
    if (!ok) {
      await dispenseOne(i + 1, q);
      return;
    }

    await dispenseOne(i + 1, q);
  };

  const dispenseOne = async (i: number, q: QueueItem[]) => {
    stopPoll();

    const item = q[i];
    if (!item) {
      setPhase("done");
      onDispenseCompleted();
      window.setTimeout(() => onClose(), 900);
      return;
    }

    setIdx(i);
    setBatchId(null);
    setBatchItems([]);
    setPendingRequestId(null);
    setScanInput("");
    setErr("");
    setPhase("running");

    const resp = await apiUser.dispense({
      items: [{ tool_model_id: item.tool_model_id, qty: 1 }],
      loan_period_hours: hours,
    });

    setBatchId(resp.batch_id);
    await pollBatch(resp.batch_id, i, q);
    pollRef.current = window.setInterval(() => {
      pollBatch(resp.batch_id, i, q).catch((e) => setErr(msg(e)));
    }, 900);
  };

  const startDispense = async () => {
    try {
      if (!expandedQueue.length) {
        setErr("Nothing selected to dispense.");
        return;
      }
      setQueue(expandedQueue);
      setIdx(0);
      setPhase("running");
      await dispenseOne(0, expandedQueue);
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
    }
  };

  const confirmPickup = async () => {
    if (!pendingRequestId) return;
    try {
      await apiUser.dispenseConfirmRequest(pendingRequestId);
      setPhase("running");
      setPendingRequestId(null);
      setScanInput("");
      await pollBatch(batchId!, idx, queue);
      pollRef.current = window.setInterval(() => {
        pollBatch(batchId!, idx, queue).catch((e) => setErr(msg(e)));
      }, 900);
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  const cancelPickup = async () => {
    if (!pendingRequestId) return;
    try {
      await apiUser.dispenseCancelRequest(pendingRequestId);
      setPhase("failed");
      setPendingRequestId(null);
      setErr("Pickup cancelled.");
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  const waitForToolScan = async () => {
    try {
      setScanBusy(true);
      setErr("");
      await apiUser.rfidSetMode({ reader_id: readerId, mode: "tool" });

      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "tool");
        if (r.ok && r.scan) {
          const tag = r.scan.tag_id ?? r.scan.uid;
          if (tag) {
            setScanInput(tag);
            return;
          }
        }
        await sleep(250);
      }

      setErr("No tool scan received. You can tap again or use manual confirm.");
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setScanBusy(false);
    }
  };

  const submitScanConfirm = async () => {
    const tag = scanInput.trim();
    if (!tag) {
      setErr("Scan the dispensed tool first, or use manual confirm.");
      return;
    }

    try {
      setErr("");
      await confirmToolReceipt(tag);
      await confirmPickup();
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        {phase === "running" ? (
          <HardwareOverlay
            title={phase === "confirm_pickup" ? "Verify your tool" : "Dispensing tools"}
            subtitle={
              phase === "confirm_pickup"
                ? "Scan the dispensed tool to confirm it, or use the manual confirm button."
                : current
                ? `Preparing ${current.label}`
                : "Preparing your request"
            }
          />
        ) : null}

        <div className="flex items-center justify-between border-b px-7 py-5">
          <div className="text-xl font-bold">Dispense tools</div>
          <button
            className="rounded-xl px-3 py-1 text-slate-500 hover:bg-slate-100"
            onClick={() => {
              stopPoll();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div className="px-7 py-6">
          <div className="rounded-3xl border bg-rose-50 p-5">
            <div className="text-base font-semibold">Cart</div>
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              {effectiveCart.length ? (
                effectiveCart.map((x) => (
                  <div key={x.tool_model_id} className="flex items-center justify-between">
                    <span className="font-semibold">{x.label ?? "Tool"}</span>
                    <span className="font-semibold">x{x.qty}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-600">No items selected.</div>
              )}
            </div>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>
          ) : null}

          {phase === "select_period" ? (
            <div className="mt-6 space-y-4">
              <div className="text-sm font-medium text-slate-700">Expected return period</div>
              <select
                className="w-full rounded-2xl border px-4 py-3"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {[2, 4, 8, 12, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} hours
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-3">
                <button className="rounded-2xl border px-4 py-2" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="rounded-2xl bg-rose-600 px-5 py-2.5 font-semibold text-white"
                  onClick={startDispense}
                >
                  Confirm dispense
                </button>
              </div>
            </div>
          ) : null}

          {phase === "confirm_pickup" ? (
            <div className="mt-6 rounded-3xl border bg-slate-50 p-5">
              <div className="text-lg font-semibold text-slate-900">Scan the dispensed tool</div>
              <div className="mt-2 text-sm text-slate-600">
                Tap the tool tag to confirm you received the item that was just dispensed.
              </div>

              <div className="mt-4">
                <input
                  className="w-full rounded-2xl border px-4 py-3 font-mono"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Tap tool tag (or type)"
                />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  className="rounded-2xl border px-4 py-2 hover:bg-slate-50 disabled:opacity-40"
                  disabled={scanBusy}
                  onClick={waitForToolScan}
                >
                  {scanBusy ? "Waiting..." : "Wait for scan"}
                </button>

                <button
                  className="ml-auto rounded-2xl bg-rose-600 px-4 py-2 font-semibold text-white"
                  onClick={submitScanConfirm}
                >
                  Verify & Continue
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button className="rounded-2xl border px-4 py-2" onClick={cancelPickup}>
                  Cancel
                </button>
                <button className="text-sm font-medium text-slate-600 underline underline-offset-4" onClick={confirmPickup}>
                  Manual confirm
                </button>
              </div>
            </div>
          ) : null}

          {phase === "failed" ? (
            <div className="mt-6 flex justify-end">
              <button className="rounded-2xl border px-4 py-2" onClick={onClose}>
                Close
              </button>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Dispense complete ✅
            </div>
          ) : null}

          {phase === "running"  ? (
            <div className="mt-6 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Current item: {current?.label ?? "—"}</div>
                <div className="text-xs text-slate-500">{queue.length ? `${idx + 1} / ${queue.length}` : ""}</div>
              </div>
              <div className="mt-2 text-xs text-slate-500">Batch: {batchId || "Creating request…"}</div>
              {batchItems.length ? (
                <div className="mt-2 text-xs text-slate-500">
                  Status: {batchItems.map((x) => x.stage || x.hw_status).join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}