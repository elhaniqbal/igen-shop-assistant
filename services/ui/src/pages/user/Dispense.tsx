import { useEffect, useState } from "react";
import { apiUser, type BatchStatusResp } from "../../lib/api.user";
import { HardwareSpinner } from "../../components/RotarySpinner";
import { RfidScanPanel } from "../../components/RfidScanPanel";

// inside component:
const [batchId, setBatchId] = useState<string | null>(null);
const [status, setStatus] = useState<BatchStatusResp | null>(null);
const [phase, setPhase] = useState<"idle" | "running" | "confirm" | "done" | "error">("idle");
const [error, setError] = useState<string | null>(null);

// call this when user hits Dispense:
async function startDispense(userId: string, items: { tool_model_id: string; qty: number }[], loanHours: number) {
  try {
    setError(null);
    setPhase("running");
    setStatus(null);

    const resp = await apiUser.dispense({ user_id: userId, items, loan_period_hours: loanHours });
    setBatchId(resp.batch_id);
  } catch (e) {
    setPhase("error");
    setError(e && typeof e === "object" && "message" in e ? String((e as any).message) : "dispense failed");
  }
}

// polling
useEffect(() => {
  if (!batchId) return;
  let alive = true;

  const poll = async () => {
    try {
      const s = await apiUser.dispenseStatus(batchId);
      if (!alive) return;
      setStatus(s);

      const done = s.items.length > 0 && s.items.every(i => i.hw_status === "dispensed_ok" || i.hw_status === "failed");
      const anyOk = s.items.some(i => i.hw_status === "dispensed_ok");

      if (done) {
        setPhase(anyOk ? "confirm" : "done");
        return;
      }
      window.setTimeout(poll, 500);
    } catch (e) {
      setPhase("error");
      setError(e && typeof e === "object" && "message" in e ? String((e as any).message) : "poll failed");
    }
  };

  poll();
  return () => { alive = false; };
}, [batchId]);

async function confirmTool(userId: string, toolTag: string) {
  try {
    setError(null);
    await apiUser.dispenseConfirm({ user_id: userId, tool_tag_id: toolTag });
    // You might want to show "confirmed" toast; keep scanning for the next tool.
  } catch (e) {
    setError(e && typeof e === "object" && "message" in e ? String((e as any).message) : "confirm failed");
  }
}
