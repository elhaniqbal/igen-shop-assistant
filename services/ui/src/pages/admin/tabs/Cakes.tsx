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

function prettyJson(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  const cakes = useMemo(() => Array.from({ length: 9 }, (_, i) => i + 2), []);
  const [busyCake, setBusyCake] = useState<number | null>(null); // EEPROM busy
  const [homeBusyCake, setHomeBusyCake] = useState<number | null>(null); // Set Home busy (per-cake)
  const [err, setErr] = useState<string | null>(null);
  const [eepromModal, setEepromModal] = useState<EepromModalState>(null);

  // per-cake Set Home status
  const [homeByCake, setHomeByCake] = useState<Record<number, HomeUiState | null>>({});

  // polling timers per cake
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

      // open modal immediately (responsive)
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

      // optimistic UI
      setHomeByCake((prev) => ({
        ...prev,
        [cakeId]: { request_id: "starting...", stage: "queued" },
      }));

      const start = await apiAdmin.cakeSetHome(cakeId);

      setHomeByCake((prev) => ({
        ...prev,
        [cakeId]: { request_id: start.request_id, stage: "queued" },
      }));

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

      // immediate poll, then interval
      await pollOnce();
      pollRefByCake.current[cakeId] = window.setInterval(() => {
        pollOnce().catch((e: any) => {
          setErr(e?.message ?? "set home status poll failed");
          stopPoll(cakeId);
          setHomeBusyCake((cur) => (cur === cakeId ? null : cur));
          setHomeByCake((prev) => ({
            ...prev,
            [cakeId]: prev[cakeId]
              ? {
                  ...prev[cakeId]!,
                  stage: "failed",
                  error_code: "POLL_FAILED",
                  error_reason: e?.message ?? "poll failed",
                }
              : {
                  request_id: "unknown",
                  stage: "failed",
                  error_code: "POLL_FAILED",
                  error_reason: e?.message ?? "poll failed",
                },
          }));
        });
      }, 800);
    } catch (e: any) {
      setErr(e?.message ?? "set home failed");
      setHomeBusyCake((cur) => (cur === cakeId ? null : cur));
      setHomeByCake((prev) => ({
        ...prev,
        [cakeId]: {
          request_id: prev[cakeId]?.request_id ?? "unknown",
          stage: "failed",
          error_code: "START_FAILED",
          error_reason: e?.message ?? "set home failed",
        },
      }));
    }
  };

  return (
    <div className="space-y-6">
      {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Cakes</div>
            <div className="text-sm text-slate-600 mt-1">
              Admin controls for cake controllers (2–10). EEPROM popup is wired.{" "}
              <span className="font-semibold">Set Home</span> sends serial <span className="font-mono">ZERO</span> via MQTT bridge.
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {cakes.map((cakeId) => {
            const hs = homeByCake[cakeId] ?? null;
            const homeDisabled = homeBusyCake === cakeId;

            return (
              <div key={cakeId} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2">
                    Cake {cakeId}
                    {hs ? (
                      <span className={["text-xs px-2 py-0.5 rounded-full border", stagePillClass(hs.stage)].join(" ")}>
                        {stageLabel(hs.stage)}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-slate-500">ESP32</span>
                </div>

                {hs?.stage === "failed" ? (
                  <div className="mt-2 text-xs text-rose-700">
                    {hs.error_code ? <span className="font-mono">{hs.error_code}</span> : "FAILED"}
                    {hs.error_reason ? ` — ${hs.error_reason}` : ""}
                  </div>
                ) : null}

                {hs?.request_id && hs.request_id !== "starting..." ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    req: <span className="font-mono">{hs.request_id}</span>
                  </div>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-2">
                  <button
                    disabled={busyCake === cakeId}
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => readEeprom(cakeId)}
                  >
                    Read EEPROM
                  </button>

                  <button
                    disabled={homeDisabled}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                    onClick={() => setHome(cakeId)}
                    title="Sets cake home (serial ZERO)"
                  >
                    {homeDisabled ? "Setting Home..." : "Set Home"}
                  </button>

                  <button
                    disabled
                    className="rounded-xl border px-4 py-2 text-sm text-slate-400 cursor-not-allowed"
                    title="Implement later"
                  >
                    Burn EEPROM (later)
                  </button>
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Set Home publishes <span className="font-mono">igen/cmd/cake/home</span> and listens for{" "}
                  <span className="font-mono">igen/evt/cake/home</span>.
                </div>
              </div>
            );
          })}
        </div>
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

        <div className="px-6 py-5 space-y-4">
          {!resp ? (
            <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">Reading EEPROM…</div>
          ) : (
            <>
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Headers (future EEPROM source)</div>
                <div className="mt-2 font-mono text-xs whitespace-pre-wrap">
                  {headerLines || "No EEPROM headers yet (backend will populate later)."}
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Body (optional)</div>
                <div className="mt-2 font-mono text-xs whitespace-pre-wrap">
                  {resp.eeprom ? prettyJson(resp.eeprom) : "No EEPROM body yet (optional)."}
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
