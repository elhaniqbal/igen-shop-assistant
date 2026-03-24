import { useMemo, useRef, useState } from "react";
import { apiAdmin, type ReadEepromResp, type CakeHomeStatusResp } from "../../../lib/api.admin";

type EepromModalState =
  | null
  | {
      cakeId: number;
      resp: ReadEepromResp | null;
    };

type HomeUiState = {
  request_id: string;
  stage: CakeHomeStatusResp["stage"];
  error_code?: string | null;
  error_reason?: string | null;
};

type EncoderCake = {
  cakeId: number;
  muxChannel: number;
};

function prettyJson(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function stageLabel(s: CakeHomeStatusResp["stage"]) {
  switch (s) {
    case "queued":
      return "Queued";
    case "accepted":
      return "Accepted";
    case "in_progress":
      return "In progress";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return s;
  }
}

function stagePillClass(s: CakeHomeStatusResp["stage"]) {
  switch (s) {
    case "succeeded":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "failed":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "queued":
    case "accepted":
    case "in_progress":
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export default function Cakes() {
  const cakes = useMemo<EncoderCake[]>(() => Array.from({ length: 6 }, (_, i) => ({ cakeId: i + 1, muxChannel: i })), []);
  const [busyCake, setBusyCake] = useState<number | null>(null);
  const [homeBusyCake, setHomeBusyCake] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [eepromModal, setEepromModal] = useState<EepromModalState>(null);
  const [homeByCake, setHomeByCake] = useState<Record<number, HomeUiState | null>>({});
  const pollRefByCake = useRef<Record<number, number | null>>({});

  const stopPoll = (cakeId: number) => {
    const t = pollRefByCake.current[cakeId];
    if (t) window.clearInterval(t);
    pollRefByCake.current[cakeId] = null;
  };

  const readEeprom = async (cakeId: number) => {
    try {
      setErr(null);
      setBusyCake(cakeId);
      setEepromModal({ cakeId, resp: null });
      const resp = await apiAdmin.readCakeEeprom(cakeId);
      setEepromModal({ cakeId, resp });
    } catch (e: any) {
      setErr(e?.message ?? "read eeprom failed");
      setEepromModal({ cakeId, resp: { ok: false, cake_id: cakeId, eeprom: null, headers: {} } });
    } finally {
      setBusyCake(null);
    }
  };

  const setHome = async (cakeId: number) => {
    try {
      setErr(null);
      setHomeBusyCake(cakeId);
      stopPoll(cakeId);
      setHomeByCake((prev) => ({ ...prev, [cakeId]: { request_id: "starting...", stage: "queued" } }));
      const start = await apiAdmin.cakeSetHome(cakeId);
      setHomeByCake((prev) => ({ ...prev, [cakeId]: { request_id: start.request_id, stage: "queued" } }));

      const pollOnce = async () => {
        const st = await apiAdmin.cakeSetHomeStatus(start.request_id);
        setHomeByCake((prev) => ({
          ...prev,
          [cakeId]: {
            request_id: st.request_id,
            stage: st.stage,
            error_code: st.error_code ?? null,
            error_reason: st.error_reason ?? null,
          },
        }));

        if (st.stage === "succeeded" || st.stage === "failed") {
          stopPoll(cakeId);
          setHomeBusyCake((cur) => (cur === cakeId ? null : cur));
        }
      };

      await pollOnce();
      pollRefByCake.current[cakeId] = window.setInterval(() => {
        pollOnce().catch((e: any) => {
          setErr(e?.message ?? "set home status poll failed");
          stopPoll(cakeId);
          setHomeBusyCake((cur) => (cur === cakeId ? null : cur));
        });
      }, 600);
    } catch (e: any) {
      setErr(e?.message ?? "set home failed");
      setHomeBusyCake((cur) => (cur === cakeId ? null : cur));
      stopPoll(cakeId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-lg font-semibold">Encoder Cakes</div>
        <div className="mt-1 text-sm text-slate-600">
          Encoder-only cake map for the mux setup. Assumed mapping is Cake 1–6 to mux channels 0–5.
        </div>
        {err ? <div className="mt-3 rounded-xl border bg-rose-50 p-3 text-sm text-rose-700">{err}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cakes.map(({ cakeId, muxChannel }) => {
          const home = homeByCake[cakeId];
          const homeDisabled = homeBusyCake === cakeId;
          return (
            <div key={cakeId} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Cake {cakeId}</div>
                  <div className="mt-1 text-sm text-slate-500">Encoder mux channel {muxChannel}</div>
                </div>
                <div className="rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  CH {muxChannel}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">EEPROM</div>
                  <div className="mt-1 text-slate-700">Read current payload</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Home</div>
                  <div className="mt-1 text-slate-700">Zero encoder / set logical home</div>
                </div>
              </div>

              {home ? (
                <div className="mt-4 rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-500">Last home request</div>
                    <div className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stagePillClass(home.stage)}`}>
                      {stageLabel(home.stage)}
                    </div>
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-slate-600">{home.request_id}</div>
                  {home.error_reason ? <div className="mt-2 text-xs text-rose-600">{home.error_reason}</div> : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  disabled={busyCake === cakeId}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => readEeprom(cakeId)}
                >
                  {busyCake === cakeId ? "Reading..." : "Read EEPROM"}
                </button>

                <button
                  disabled={homeDisabled}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                  onClick={() => setHome(cakeId)}
                >
                  {homeDisabled ? "Setting Home..." : "Set Home"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {eepromModal ? <EepromModal cakeId={eepromModal.cakeId} resp={eepromModal.resp} onClose={() => setEepromModal(null)} /> : null}
    </div>
  );
}

function EepromModal({
  cakeId,
  resp,
  onClose,
}: {
  cakeId: number;
  resp: ReadEepromResp | null;
  onClose: () => void;
}) {
  const headers = resp?.headers ?? {};
  const headerLines = Object.keys(headers).length
    ? Object.entries(headers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
        : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">EEPROM — Cake {cakeId}</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {!resp ? (
            <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">Reading EEPROM…</div>
          ) : (
            <>
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Headers</div>
                <div className="mt-2 whitespace-pre-wrap font-mono text-xs">
                  {headerLines || "No EEPROM headers yet."}
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Body</div>
                <div className="mt-2 whitespace-pre-wrap font-mono text-xs">
                  {resp.eeprom ? prettyJson(resp.eeprom) : "No EEPROM body yet."}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
