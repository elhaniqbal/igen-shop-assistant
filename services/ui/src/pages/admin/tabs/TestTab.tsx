import { useMemo, useState } from "react";
import { adminApi, type TestMotorAction } from "../../../lib/adminApi";

const MOTOR_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type MotorState = {
  busy: boolean;
  last?: { action: TestMotorAction; ok: boolean; msg?: string; ts: number };
};

export function TestTab() {
  const initial = useMemo(
    () => Object.fromEntries(MOTOR_IDS.map((id) => [id, { busy: false } as MotorState])) as Record<number, MotorState>,
    []
  );
  const [state, setState] = useState<Record<number, MotorState>>(initial);

  const run = async (motor_id: number, action: TestMotorAction) => {
    setState((s) => ({ ...s, [motor_id]: { ...s[motor_id], busy: true } }));
    try {
      await adminApi.testMotor({ motor_id, action });
      setState((s) => ({ ...s, [motor_id]: { busy: false, last: { action, ok: true, ts: Date.now() } } }));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        [motor_id]: {
          busy: false,
          last: { action, ok: false, msg: e?.detail ?? e?.message ?? "Unknown error", ts: Date.now() },
        },
      }));
    }
  };

  return (
    <div className="mt-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="text-lg font-semibold text-slate-900">Test</div>
        <div className="mt-1 text-sm text-slate-600">
          Motor test actions. For now they hit the same endpoint; later they’ll map to motor IDs 2–10.
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        {MOTOR_IDS.map((id) => {
          const st = state[id];
          const last = st.last;

          return (
            <div key={id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-slate-500">Motor</div>
                  <div className="text-2xl font-bold text-slate-900">{id}</div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    st.busy ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {st.busy ? "Running…" : "Idle"}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                <button
                  disabled={st.busy}
                  onClick={() => run(id, "dispense")}
                  className="w-full rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
                >
                  Test Dispense
                </button>

                <button
                  disabled={st.busy}
                  onClick={() => run(id, "return")}
                  className="w-full rounded-xl border px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Test Return
                </button>
              </div>

              <div className="mt-4 rounded-xl border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {!last ? (
                  <span>No recent test.</span>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        Last: <span className="font-mono">{last.action.toUpperCase()}</span>
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          last.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                        }`}
                        title={last.msg ?? ""}
                      >
                        {last.ok ? "OK" : "FAIL"}
                      </span>
                    </div>
                    {last.msg && (
                      <div className="mt-1 truncate text-rose-700" title={last.msg}>
                        {last.msg}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
