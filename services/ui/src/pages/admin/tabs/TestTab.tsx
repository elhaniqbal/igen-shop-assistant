import { useState } from "react";
import { apiAdmin, type MotorAction, type MotorTestStatusResp } from "../../../lib/api.admin";
import { HardwareSpinner } from "../../../components/RotarySpinner";

type CardState = {
  busy: boolean;
  requestId?: string;
  status?: MotorTestStatusResp;
  error?: string;
};

export default function TestTab() {
  const motorIds = [2,3,4,5,6,7,8,9,10];
  const [cards, setCards] = useState<Record<number, CardState>>(
    Object.fromEntries(motorIds.map(id => [id, { busy: false }])) as Record<number, CardState>
  );

  const start = async (motor_id: number, action: MotorAction) => {
    setCards(s => ({ ...s, [motor_id]: { busy: true } }));
    try {
      const { request_id } = await apiAdmin.motorTestStart({ motor_id, action });
      setCards(s => ({ ...s, [motor_id]: { ...s[motor_id], requestId: request_id, busy: true } }));

      const poll = async () => {
        const st = await apiAdmin.motorTestStatus(request_id);
        setCards(s => ({ ...s, [motor_id]: { ...s[motor_id], status: st } }));
        if (st.stage === "succeeded" || st.stage === "failed") {
          setCards(s => ({ ...s, [motor_id]: { ...s[motor_id], busy: false } }));
          return;
        }
        window.setTimeout(poll, 300);
      };
      poll();
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "start failed";
      setCards(s => ({ ...s, [motor_id]: { busy: false, error: msg } }));
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {motorIds.map(id => {
        const c = cards[id];
        const stage = c.status?.stage ?? "idle";
        return (
          <div key={id} className="rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Motor {id}</div>
              <div className="text-xs opacity-70">{stage}</div>
            </div>

            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 rounded-xl border hover:bg-white/5 disabled:opacity-50"
                disabled={c.busy} onClick={() => start(id, "dispense")}>
                Test dispense
              </button>
              <button className="px-3 py-2 rounded-xl border hover:bg-white/5 disabled:opacity-50"
                disabled={c.busy} onClick={() => start(id, "return")}>
                Test return
              </button>
            </div>

            {c.busy ? <HardwareSpinner label="Waiting for ACK/OK/FAIL…" /> : null}
            {c.status?.error_code ? <div className="text-red-400 text-sm mt-2">{c.status.error_code}</div> : null}
            {c.error ? <div className="text-red-400 text-sm mt-2">{c.error}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
