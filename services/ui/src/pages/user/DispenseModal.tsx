import { useEffect, useMemo, useState } from "react";
import { RotarySpinner } from "./RotarySpinner";
import type { ToolModel } from "./mockData";

type Phase = "select_period" | "dispensing" | "confirm_pickup" | "done" | "failed";

export function DispenseModal({
  open,
  onClose,
  tool,
  onDispenseDone,
}: {
  open: boolean;
  onClose: () => void;
  tool: ToolModel | null;
  onDispenseDone: (tool_item_id: string, loan_hours: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("select_period");
  const [hours, setHours] = useState<number>(8);
  const [toolTag, setToolTag] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setPhase("select_period");
    setHours(8);
    setToolTag("");
    setErr("");
  }, [open]);

  const title = useMemo(() => {
    if (!tool) return "Dispense Tool";
    return `Dispense Tool`;
  }, [tool]);

  if (!open || !tool) return null;

  const simulateHardwareDispense = () => {
    setPhase("dispensing");
    setErr("");

    // Simulate: ACK quickly, then done after a deterministic delay
    const ackMs = 200;
    const doneMs = 2200;

    window.setTimeout(() => {
      // ACK stage (we don't show a separate screen; you could add it)
    }, ackMs);

    window.setTimeout(() => {
      const ok = true; // flip to Math.random() > 0.1 to test failure paths
      if (ok) setPhase("confirm_pickup");
      else {
        setErr("Hardware dispense failed (SIM_JAM_GANTRY).");
        setPhase("failed");
      }
    }, doneMs);
  };

  const confirmPickup = () => {
    // In real life: toolTag must match expected tool_tag_id from DB for that request_id
    if (!toolTag.trim()) {
      setErr("Enter or tap the tool tag to confirm pickup.");
      return;
    }
    setErr("");
    setPhase("done");

    // For the demo: generate a fake unique tool_item_id label
    const tool_item_id = `TOOL-${String(Math.floor(100 + Math.random() * 900))}-A`;
    onDispenseDone(tool_item_id, hours);

    window.setTimeout(() => onClose(), 700);
  };

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
            <div className="text-base font-semibold">{tool.name}</div>
            <div className="text-sm text-slate-600">{tool.category}</div>
            <div className="mt-2 text-xs text-slate-600">
              Tool Model ID: <span className="font-mono">{tool.tool_model_id}</span>
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
                  className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700"
                  onClick={simulateHardwareDispense}
                >
                  Confirm Dispense
                </button>
              </div>
            </div>
          )}

          {phase === "dispensing" && (
            <div className="mt-5">
              <RotarySpinner label="Dispensing tool..." />
              <div className="mt-4 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Waiting for mechanical completion event…
              </div>
            </div>
          )}

          {phase === "confirm_pickup" && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Dispense complete. Now confirm pickup by tapping the tool tag (or type it).
              </div>

              <div className="text-sm font-medium text-slate-700">Tool Tag / Barcode</div>
              <input
                className="w-full rounded-xl border px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-rose-300"
                value={toolTag}
                onChange={(e) => setToolTag(e.target.value)}
                placeholder="Tap tool tag or type e.g. TAG-ABC-123"
              />

              <div className="flex items-center gap-3">
                <button
                  className="rounded-xl border px-4 py-2 hover:bg-slate-50"
                  onClick={() => setToolTag("TAG-SIM-TOOL-001")}
                >
                  Simulate Tap
                </button>

                <button
                  className="ml-auto rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700"
                  onClick={confirmPickup}
                >
                  Confirm Pickup
                </button>
              </div>

              {err && <div className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{err}</div>}
            </div>
          )}

          {phase === "failed" && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Dispense failed. Please contact shop staff.
              </div>
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
              Pickup confirmed ✅
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
