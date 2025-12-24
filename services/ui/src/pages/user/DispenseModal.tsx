import { useEffect, useMemo, useRef, useState } from "react";
import { HardwareSpinner } from "../../components/RotarySpinner";
import { apiUser, type BatchStatusItem, type HwStatus } from "../../lib/api.user";
import type { ToolModel } from "../../lib/api.admin";

type Phase = "select_period" | "dispensing" | "confirm_pickup" | "done" | "failed";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

function allDone(items: BatchStatusItem[]) {
  return items.length > 0 && items.every((x) => x.hw_status === "dispensed_ok" || x.hw_status === "failed");
}
function anyOk(items: BatchStatusItem[]) {
  return items.some((x) => x.hw_status === "dispensed_ok");
}
function statusLabel(s: HwStatus) {
  if (s === "pending") return "Pending";
  if (s === "accepted") return "Accepted";
  if (s === "in_progress") return "In Progress";
  if (s === "dispensed_ok") return "Succeeded";
  if (s === "failed") return "Failed";
  if (s === "confirmed") return "Confirmed";
if (s === "pickup_mismatch") return "Pickup Mismatch";
  return s;
}

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

  // Backwards compatible: you can keep passing a single tool
  tool?: ToolModel | null;

  // Shopping cart: future-proof (recommended)
  cartItems?: { tool_model_id: string; qty: number; label?: string }[];

  userId: string;
  readerId: string;
  onDispenseCompleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("select_period");
  const [hours, setHours] = useState<number>(8);
  const [toolTag, setToolTag] = useState<string>("");
  const [err, setErr] = useState<string>("");

  const [batchId, setBatchId] = useState<string | null>(null);
  const [items, setItems] = useState<BatchStatusItem[]>([]);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    setPhase("select_period");
    setHours(8);
    setToolTag("");
    setErr("");
    setBatchId(null);
    setItems([]);

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

  const title = useMemo(() => "Dispense Tools", []);
  const canStart = open && effectiveCart.length > 0;

  const startDispense = async () => {
    try {
      setErr("");
      if (!canStart) {
        setErr("Nothing selected to dispense.");
        setPhase("failed");
        return;
      }

      setPhase("dispensing");

      // IMPORTANT: This assumes you change backend to accept tool_model_id+qty.
      const resp = await apiUser.dispense({
        user_id: userId,
        items: effectiveCart.map((x) => ({ tool_model_id: x.tool_model_id, qty: x.qty })),
        loan_period_hours: hours,
      });

      setBatchId(resp.batch_id);

      const tick = async () => {
        const st = await apiUser.dispenseStatus(resp.batch_id);
        setItems(st.items);

        if (allDone(st.items)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;

          // If at least one succeeded, we go to confirm pickup.
          // If all failed, we show failed.
          if (anyOk(st.items)) {
            setPhase("confirm_pickup");
          } else {
            setErr("All dispenses failed.");
            setPhase("failed");
          }
        }
      };

      await tick();
      pollRef.current = window.setInterval(() => tick().catch((e) => setErr(msg(e))), 800);
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
    }
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
      setErr("No tool scan received. Tap the tool tag again or type it.");
    } catch (e: any) {
      setErr(msg(e));
    }
  };

const confirmPickup = async () => {
  const tag = toolTag.trim();
  if (!tag) {
    setErr("Enter or tap the tool tag to confirm pickup.");
    return;
  }
  try {
    setErr("");
    await apiUser.dispenseConfirm({ user_id: userId, tool_tag_id: tag });

    // only NOW is it a real checkout
    setPhase("done");
    onDispenseCompleted(); // refresh loans + inventory
    window.setTimeout(() => onClose(), 650);
  } catch (e: any) {
    // mismatch/unknown tag comes here now
    setErr(msg(e)); // your http wrapper should surface detail
  }
};

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
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
                    <span className="font-mono text-xs">{x.tool_model_id}</span>
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
              <div className="mt-4 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {batchId ? (
                  <div>
                    <div>
                      batch_id: <span className="font-mono">{batchId}</span>
                    </div>
                    <div className="mt-2">
                      {items.length ? (
                        <ul className="space-y-1">
                          {items.map((it) => (
                            <li key={it.request_id} className="flex items-center justify-between">
                              <span className="font-mono text-xs">{it.request_id.slice(0, 10)}…</span>
                              <span className="text-xs">{statusLabel(it.hw_status)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div>Waiting for status…</div>
                      )}
                    </div>
                  </div>
                ) : (
                  "Creating dispense batch…"
                )}
              </div>
              {err && <div className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}
            </div>
          )}

          {phase === "confirm_pickup" && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Dispense complete. Confirm pickup by tapping the tool tag (or type it).
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
                  Wait for tool scan
                </button>

                <button className="ml-auto rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700" onClick={confirmPickup}>
                  Confirm Pickup
                </button>
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
            <div className="mt-5 rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Pickup confirmed ✅</div>
          )}
        </div>
      </div>
    </div>
  );
}
