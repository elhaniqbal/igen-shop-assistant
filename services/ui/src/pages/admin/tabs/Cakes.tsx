import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiAdmin,
  type CakeHomeStatusResp,
  type CakeOverview,
  type ReadAngleResp,
  type ReadEepromResp,
} from "../../../lib/api.admin";

function prettyJson(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export default function Cakes() {
  const [cakes, setCakes] = useState<CakeOverview[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [busyCake, setBusyCake] = useState<number | null>(null);
  const [angleBusyCake, setAngleBusyCake] = useState<number | null>(null);
  const [homeBusyCake, setHomeBusyCake] = useState<number | null>(null);

  const [eepromModal, setEepromModal] = useState<{ cakeId: number; resp: ReadEepromResp | null } | null>(null);
  const [angleModal, setAngleModal] = useState<{ cakeId: number; resp: ReadAngleResp | null } | null>(null);

  const [homeByCake, setHomeByCake] = useState<Record<number, CakeHomeStatusResp | null>>({});
  const pollRefByCake = useRef<Record<number, number | null>>({});

  const stopPoll = (cakeId: number) => {
    const t = pollRefByCake.current[cakeId];
    if (t) window.clearInterval(t);
    pollRefByCake.current[cakeId] = null;
  };

  const load = async () => {
    try {
      setErr(null);
      setCakes(await apiAdmin.cakesOverview());
    } catch (e: any) {
      setErr(e?.message || "Could not load cakes");
    }
  };

  useEffect(() => {
    load();
    return () => {
      Object.keys(pollRefByCake.current).forEach((k) => {
        const id = Number(k);
        if (!Number.isNaN(id)) stopPoll(id);
      });
    };
  }, []);

  const readEeprom = async (cakeId: number) => {
    try {
      setErr(null);
      setBusyCake(cakeId);
      setEepromModal({ cakeId, resp: null });

      await apiAdmin.queueCakeReadEeprom(cakeId);

      let last: ReadEepromResp | null = null;
      for (let i = 0; i < 6; i++) {
        await sleep(i === 0 ? 250 : 500);
        const resp = await apiAdmin.readCakeEeprom(cakeId);
        last = resp;
        if (resp?.eeprom) {
          setEepromModal({ cakeId, resp });
          return;
        }
      }

      setEepromModal({ cakeId, resp: last });
    } catch (e: any) {
      setErr(e?.message || "Read EEPROM failed");
    } finally {
      setBusyCake(null);
    }
  };

  const readAngle = async (cakeId: number) => {
    try {
      setErr(null);
      setAngleBusyCake(cakeId);
      setAngleModal({ cakeId, resp: null });

      await apiAdmin.queueCakeReadAngle(cakeId);

      let last: ReadAngleResp | null = null;
      for (let i = 0; i < 6; i++) {
        await sleep(i === 0 ? 250 : 500);
        const resp = await apiAdmin.readCakeAngle(cakeId);
        last = resp;
        if (resp?.reading) {
          setAngleModal({ cakeId, resp });
          return;
        }
      }

      setAngleModal({ cakeId, resp: last });
    } catch (e: any) {
      setErr(e?.message || "Read angle failed");
    } finally {
      setAngleBusyCake(null);
    }
  };

  const setHome = async (cakeId: number) => {
    try {
      setErr(null);
      setHomeBusyCake(cakeId);
      stopPoll(cakeId);

      const start = await apiAdmin.cakeSetHome(cakeId);

      const poll = async () => {
        const st = await apiAdmin.cakeSetHomeStatus(start.request_id);
        setHomeByCake((prev) => ({ ...prev, [cakeId]: st }));
        if (st.stage === "succeeded" || st.stage === "failed") {
          stopPoll(cakeId);
          setHomeBusyCake(null);
          await load();
        }
      };

      await poll();
      pollRefByCake.current[cakeId] = window.setInterval(() => {
        poll().catch((e: any) => setErr(e?.message || "Home poll failed"));
      }, 750);
    } catch (e: any) {
      setErr(e?.message || "Set home failed");
      setHomeBusyCake(null);
    }
  };

  const filledCounts = useMemo(
    () => Object.fromEntries(cakes.map((c) => [c.cake_id, c.slots.filter((s) => !!s.tool_item_id).length])),
    [cakes]
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_14px_50px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">Cakes & slot state</div>
            <div className="mt-1 text-sm text-slate-600">
              This view bridges encoder tooling and the backend slot allocator. The user flow depends on these current-slot values.
            </div>
          </div>
          <button
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={load}
          >
            Refresh
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {err}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cakes.map((cake) => {
          const cakeId =
            Number(String(cake.cake_id).replace(/\D/g, "")) || Number(cake.cake_id);
          const home = homeByCake[cakeId];

          return (
            <div
              key={cake.cake_id}
              className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_14px_50px_rgba(15,23,42,0.08)] backdrop-blur"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-slate-900">{cake.cake_id}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Current slot: <span className="font-semibold text-slate-900">{cake.current_slot}</span>
                  </div>
                </div>
                <div className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  {filledCounts[cake.cake_id] || 0} / {cake.slots.length} filled
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {cake.slots.map((slot) => (
                  <div
                    key={slot.slot_index}
                    className={`rounded-2xl border p-3 text-center ${
                      slot.tool_item_id ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Slot</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">{slot.slot_index}</div>
                    <div className="mt-2 truncate text-[11px] text-slate-600">{slot.tool_item_id || "Open"}</div>
                  </div>
                ))}
              </div>

              {home ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Home request: <span className="font-semibold">{home.stage}</span>
                  {home.error_reason ? ` — ${home.error_reason}` : ""}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  disabled={busyCake === cakeId}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => readEeprom(cakeId)}
                >
                  {busyCake === cakeId ? "Reading EEPROM…" : "Read EEPROM"}
                </button>

                <button
                  disabled={angleBusyCake === cakeId}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => readAngle(cakeId)}
                >
                  {angleBusyCake === cakeId ? "Reading Angle…" : "Read Angle"}
                </button>

                <button
                  disabled={homeBusyCake === cakeId}
                  className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                  onClick={() => setHome(cakeId)}
                >
                  {homeBusyCake === cakeId ? "Setting Home…" : "Set Home"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {eepromModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-xl font-bold">EEPROM — Cake {eepromModal.cakeId}</div>
              <button onClick={() => setEepromModal(null)} className="rounded-xl border px-3 py-1.5">
                Close
              </button>
            </div>
            <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap text-xs text-slate-700">
                {eepromModal.resp ? prettyJson(eepromModal.resp.eeprom ?? {}) : "Reading…"}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {angleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-xl font-bold">Live Angle — Cake {angleModal.cakeId}</div>
              <button onClick={() => setAngleModal(null)} className="rounded-xl border px-3 py-1.5">
                Close
              </button>
            </div>
            <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap text-xs text-slate-700">
                {angleModal.resp ? prettyJson(angleModal.resp.reading ?? {}) : "Reading…"}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}