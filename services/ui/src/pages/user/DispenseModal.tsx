import { useEffect, useMemo, useRef, useState } from "react";
import { HardwareSpinner } from "../../components/RotarySpinner";
import { apiUser, type BatchStatusItem, type HwStatus } from "../../lib/api.user";
import type { ToolModel } from "../../lib/api.admin";

type Phase = "select_period" | "dispensing" | "confirm_pickup" | "done" | "failed";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

function statusLabel(s: HwStatus) {
  if (s === "pending") return "Pending";
  if (s === "accepted") return "Accepted";
  if (s === "in_progress") return "In Progress";
  if (s === "dispensed_ok") return "Succeeded";
  if (s === "failed") return "Failed";
  if (s === "confirmed") return "Confirmed";
  if (s === "pickup_mismatch") return "Pickup Mismatch";
  if (s === "return_ok") return "Return OK";
  return String(s);
}

function isDoneItem(x: BatchStatusItem) {
  return x.hw_status === "dispensed_ok" || x.hw_status === "failed";
}

type QueueItem = { tool_model_id: string; label: string };

export function DispenseModal({
  open,
  onClose,
  tool,
  cartItems,
  userId,
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
  const [err, setErr] = useState<string>("");

  // sequential state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [idx, setIdx] = useState(0);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<BatchStatusItem[]>([]);

  const [toolTag, setToolTag] = useState<string>("");
  const [confirmAttempts, setConfirmAttempts] = useState(0);

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

    setToolTag("");
    setConfirmAttempts(0);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open]);

  const effectiveCart = useMemo(() => {
    if (cartItems && cartItems.length) return cartItems.filter((x) => x.qty > 0);
    if (tool) return [{ tool_model_id: tool.tool_model_id, qty: 1, label: tool.name }];
    return [];
  }, [cartItems, tool]);

  const expandedQueue = useMemo<QueueItem[]>(() => {
    const out: QueueItem[] = [];
    for (const x of effectiveCart) {
      const label = x.label ?? "Tool";
      for (let i = 0; i < x.qty; i++) out.push({ tool_model_id: x.tool_model_id, label });
    }
    return out;
  }, [effectiveCart]);

  const canStart = open && expandedQueue.length > 0;
  const current = queue[idx] ?? null;

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const startDispense = async () => {
    try {
      setErr("");
      if (!canStart) {
        setErr("Nothing selected to dispense.");
        setPhase("failed");
        return;
      }

      setQueue(expandedQueue);
      setIdx(0);
      setBatchId(null);
      setBatchItems([]);
      setToolTag("");
      setConfirmAttempts(0);

      setPhase("dispensing");
      await dispenseOne(0, expandedQueue);
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
    }
  };

  const dispenseOne = async (i: number, q: QueueItem[]) => {
    stopPoll();

    const item = q[i];
    if (!item) {
      setPhase("done");
      onDispenseCompleted();
      window.setTimeout(() => onClose(), 650);
      return;
    }

    setIdx(i);
    setBatchId(null);
    setBatchItems([]);
    setToolTag("");
    setConfirmAttempts(0);
    setErr("");

    const resp = await apiUser.dispense({
      user_id: userId,
      items: [{ tool_model_id: item.tool_model_id, qty: 1 }],
      loan_period_hours: hours,
    });

    setBatchId(resp.batch_id);

    const tick = async () => {
      const st = await apiUser.dispenseStatus(resp.batch_id);
      setBatchItems(st.items);

      const done = st.items.length > 0 && st.items.every(isDoneItem);
      if (!done) return;

      stopPoll();

      const ok = st.items.some((x) => x.hw_status === "dispensed_ok");
      if (!ok) {
        await dispenseOne(i + 1, q);
        return;
      }

      setPhase("confirm_pickup");
    };

    await tick();
    pollRef.current = window.setInterval(() => tick().catch((e) => setErr(msg(e))), 800);
  };

  const waitForToolScan = async () => {
    try {
      setErr("");
      await apiUser.rfidSetMode({ reader_id: readerId, mode: "tool" });

      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "tool");
        if (r.ok && r.scan) {
          const tag = r.scan.tag_id ?? r.scan.uid;
          if (tag) {
            setToolTag(tag);
            return;
          }
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      setErr("No scan received. Tap the tool tag again or type it.");
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  const confirmPickup = async () => {
    const tag = toolTag.trim();
    if (!tag) {
      setErr("Tap the tool tag (or type it) to confirm pickup.");
      return;
    }

    try {
      setErr("");
      await apiUser.dispenseConfirm({ user_id: userId, tool_tag_id: tag });

      setPhase("dispensing");
      await dispenseOne(idx + 1, queue);
    } catch (e: any) {
      setConfirmAttempts((a) => a + 1);

      const m = msg(e);
      setErr(m);

      if (confirmAttempts + 1 >= 5) {
        setErr("Pickup not confirmed after 5 attempts. Marked unconfirmed. Moving to next tool.");
        setToolTag("");
        setConfirmAttempts(0);
        setPhase("dispensing");
        await new Promise((r) => setTimeout(r, 500));
        await dispenseOne(idx + 1, queue);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">Dispense Tools</div>
          <button
            className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100"
            onClick={() => {
              stopPoll();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-xl border bg-rose-50 p-4">
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

          {phase === "select_period" && (
            <div className="mt-5 space-y-3">
              <div className="text-sm font-medium text-slate-700">Expected Return (hours)</div>
              <select
                className="w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-300"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {[2, 4, 8, 12, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} hours
                  </option>
                ))}
              </select>

              {err && <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}

              <div className="mt-4 flex justify-end gap-3">
                <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>
                  Cancel
                </button>
                <button
                  disabled={!canStart}
                  className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                  onClick={startDispense}
                >
                  Confirm Dispense
                </button>
              </div>
            </div>
          )}

          {phase === "dispensing" && (
            <div className="mt-5">
              <HardwareSpinner label="Dispensing..." />

              <div className="mt-3 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    Now dispensing: <span className="font-bold text-slate-900">{current ? current.label : "—"}</span>
                  </div>
                  <div className="text-xs text-slate-500">{queue.length ? `${idx + 1} / ${queue.length}` : ""}</div>
                </div>

                <div className="mt-2 text-xs text-slate-600">{batchId ? "Dispense in progress…" : "Creating dispense request…"}</div>

                <div className="mt-2">
                  {batchItems.length ? (
                    <ul className="space-y-1">
                      {batchItems.map((it) => (
                        <li key={it.request_id} className="flex items-center justify-between">
                          <span className="text-xs">Status</span>
                          <span className="text-xs">{statusLabel(it.hw_status)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">Waiting for status…</div>
                  )}
                </div>
              </div>

              {err && <div className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}
            </div>
          )}

          {phase === "confirm_pickup" && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Tool dispensed. Confirm pickup for <span className="font-semibold">{current?.label ?? "this tool"}</span> by tapping the tool tag.
              </div>

              <div className="text-sm font-medium text-slate-700">Tool Tag / UID</div>
              <input
                className="w-full rounded-xl border px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-rose-300"
                value={toolTag}
                onChange={(e) => setToolTag(e.target.value)}
                placeholder="Tap tool tag or type"
              />

              <div className="flex items-center gap-3">
                <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={waitForToolScan}>
                  Wait for scan
                </button>
                <button
                  className="ml-auto rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700"
                  onClick={confirmPickup}
                >
                  Confirm Pickup
                </button>
              </div>

              <div className="text-xs text-slate-500">
                Attempts: <span className="font-mono">{confirmAttempts}</span> / 5 — Reader: <span className="font-mono">{readerId}</span>
              </div>

              {err && <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}
            </div>
          )}

          {phase === "failed" && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border bg-rose-50 px-4 py-3 text-sm text-rose-700">Dispense failed.</div>
              {err && <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}
              <div className="flex justify-end">
                <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="mt-5 rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Dispense flow complete ✅
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
