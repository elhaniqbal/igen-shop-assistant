import { useState } from "react";
import { apiAdmin, type MotorAction, type MotorTestStatusResp } from "../../../lib/api.admin";
import { HardwareSpinner } from "../../../components/RotarySpinner";

const CAKE_IDS = [1, 2, 3, 4, 5, 6] as const;

type RunState = {
  busy: boolean;
  requestId?: string;
  status?: MotorTestStatusResp;
  error?: string;
};

function stageTone(stage: string) {
  switch (stage) {
    case "succeeded":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "accepted":
    case "in_progress":
    case "queued":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function TestTab() {
  const [cakeId, setCakeId] = useState<number>(1);
  const [run, setRun] = useState<RunState>({ busy: false });

  const start = async (action: MotorAction) => {
    setRun({ busy: true, error: undefined, status: undefined, requestId: undefined });
    try {
      const { request_id } = await apiAdmin.motorTestStart({ motor_id: cakeId, action });
      setRun((s) => ({ ...s, requestId: request_id, busy: true }));

      const poll = async () => {
        const st = await apiAdmin.motorTestStatus(request_id);
        setRun((s) => ({ ...s, status: st }));
        if (st.stage === "succeeded" || st.stage === "failed") {
          setRun((s) => ({ ...s, busy: false }));
          return;
        }
        window.setTimeout(poll, 400);
      };

      await poll();
    } catch (e) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "start failed";
      setRun({ busy: false, error: msg });
    }
  };

  const stage = run.status?.stage ?? (run.busy ? "queued" : "idle");

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-lg font-semibold">Sequence Test</div>
          <div className="mt-1 text-sm text-slate-600">
            Runs a pure motion test for the selected encoder cake. No tool or DB state is changed.
          </div>
        </div>

        <div className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${stageTone(stage)}`}>
          {stage}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-end">
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">Encoder cake</div>
          <select
            className="w-full rounded-xl border px-3 py-3 text-sm"
            value={cakeId}
            onChange={(e) => setCakeId(Number(e.target.value))}
            disabled={run.busy}
          >
            {CAKE_IDS.map((id) => (
              <option key={id} value={id}>
                Cake {id}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-xl border px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={run.busy}
            onClick={() => start("dispense")}
          >
            Test dispense
          </button>
          <button
            className="rounded-xl border px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={run.busy}
            onClick={() => start("return")}
          >
            Test return
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Selected cake</div>
            <div className="mt-1 font-mono text-sm">{cakeId}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Request ID</div>
            <div className="mt-1 break-all font-mono text-sm">{run.requestId ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
            <div className="mt-1 font-mono text-sm">{stage}</div>
          </div>
        </div>

        {run.busy ? <div className="mt-4"><HardwareSpinner label="Running motion sequence…" /></div> : null}
        {run.status?.error_code ? <div className="mt-4 text-sm text-rose-600">{run.status.error_code}</div> : null}
        {run.error ? <div className="mt-4 text-sm text-rose-600">{run.error}</div> : null}
      </div>
    </div>
  );
}
