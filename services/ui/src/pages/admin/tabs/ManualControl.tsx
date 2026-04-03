import { useEffect, useMemo, useState } from "react";
import { CONFIG } from "../../../lib/config";
import { apiAdmin, type HomeMode, type MachineAlert, type PendingHardwareWait } from "../../../lib/api.admin";
import { BrandMark } from "../../../components/BrandMark";

const LINEAR_STEP_OPTIONS = [100, 500, 1000, 5000, 10000];
const CAKE_STEP_OPTIONS = [1, 2, 3, 4, 5, 6];
const CAKE_OPTIONS = [1, 2, 3, 4, 5, 6];

function Card({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_14px_50px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  const styles =
    variant === "primary"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : variant === "danger"
      ? "bg-slate-950 text-white hover:bg-black"
      : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-40 ${styles}`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function safePositiveInt(value: string, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.round(n));
}

export default function ManualControl() {
  const [linearStep, setLinearStep] = useState(1000);
  const [linearCustomStep, setLinearCustomStep] = useState("1000");

  const [cakeStep, setCakeStep] = useState(1);
  const [cakeCustomStep, setCakeCustomStep] = useState("1");

  const [selectedCake, setSelectedCake] = useState(1);
  const [cakeDirection, setCakeDirection] = useState<"cw" | "ccw">("cw");
  const [homeMode, setHomeMode] = useState<HomeMode>("python_assisted");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [alerts, setAlerts] = useState<MachineAlert[]>([]);
  const [waits, setWaits] = useState<PendingHardwareWait[]>([]);
  const [lastMessage, setLastMessage] = useState("Ready");
  const [editorFile, setEditorFile] = useState<"vars.cfg" | "steppers.cfg">("vars.cfg");
  const [editorContent, setEditorContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);

  async function refresh() {
    const [st, al, wa] = await Promise.all([
      apiAdmin.machineStatus(),
      apiAdmin.machineAlerts(),
      apiAdmin.hardwareWaits(),
    ]);
    setStatus(st);
    setAlerts(al);
    setWaits(wa.waits ?? []);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
    loadEditorFile("vars.cfg").catch(() => undefined);
    const id = window.setInterval(() => refresh().catch(() => undefined), 5000);
    return () => window.clearInterval(id);
  }, []);

  async function run(fn: () => Promise<any>) {
    try {
      setLoading(true);
      const res = await fn();
      setLastMessage(res?.message || "Command queued");
      await refresh();
    } catch (e: any) {
      setLastMessage(e?.message || "Command failed");
    } finally {
      setLoading(false);
    }
  }

  async function pingKlipper() {
    try {
      setLoading(true);
      const st = await apiAdmin.machineStatus();
      setStatus(st);

      if (st?.reachable === false) {
        setLastMessage("Klipper unreachable");
      } else if (st?.busy) {
        setLastMessage(`Klipper reachable, machine busy (${st?.state || st?.klipper_state || "unknown"})`);
      } else if (st?.homed === false) {
        setLastMessage("Klipper reachable, machine not homed");
      } else {
        setLastMessage(`Klipper ready (${st?.state || st?.klipper_state || "idle"})`);
      }
    } catch (e: any) {
      setLastMessage(e?.message || "Klipper ping failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadEditorFile(name: "vars.cfg" | "steppers.cfg") {
    try {
      setEditorLoading(true);
      const res = await apiAdmin.getKlipperFile(name);
      setEditorFile(name);
      setEditorContent(res?.content ?? "");
      setLastMessage(`Loaded ${name}`);
    } catch (e: any) {
      setLastMessage(e?.message || `Failed to load ${name}`);
    } finally {
      setEditorLoading(false);
    }
  }

  async function saveEditorFile() {
    try {
      setEditorLoading(true);
      const res = await apiAdmin.saveKlipperFile(editorFile, editorContent);
      setLastMessage(res?.message || `Saved ${editorFile}`);
    } catch (e: any) {
      setLastMessage(e?.message || `Failed to save ${editorFile}`);
    } finally {
      setEditorLoading(false);
    }
  }

  async function saveAndRestart(mode: "restart_klipper" | "firmware_restart") {
    try {
      setEditorLoading(true);
      const saveRes = await apiAdmin.saveKlipperFile(editorFile, editorContent);
      const restartRes = await apiAdmin.restartKlipper(mode);
      setLastMessage(
        `${saveRes?.message || `Saved ${editorFile}`} · ${restartRes?.message || "Restart queued"}`
      );
      await refresh();
    } catch (e: any) {
      setLastMessage(e?.message || "Save + restart failed");
    } finally {
      setEditorLoading(false);
    }
  }

  const readyText = useMemo(() => {
    if (!status) return "Unknown";
    if (status.reachable === false) return "Offline";
    if (status.homed === false) return "Unhomed";
    if (status.busy) return "Busy";
    return status.state || status.klipper_state || "Ready";
  }, [status]);

  const currentCakeSlot = Number(status?.active_cake_slot ?? 0) || 0;

  const applyLinearCustomStep = () => {
    const next = safePositiveInt(linearCustomStep, linearStep);
    setLinearStep(next);
    setLinearCustomStep(String(next));
  };

  const applyCakeCustomStep = () => {
    const next = safePositiveInt(cakeCustomStep, cakeStep);
    setCakeStep(next);
    setCakeCustomStep(String(next));
  };

  return (
    <div className="space-y-5">
      {waits.length > 0 ? (
        <Card title="Pending door confirmations" subtitle="Continue or cancel requests waiting on human confirmation.">
          <div className="space-y-3">
            {waits.map((w) => (
              <div key={`${w.request_id}-${w.stage}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="font-semibold text-amber-950">
                  {w.action || "request"} · {w.stage || "waiting"}
                </div>
                <div className="mt-1 text-sm text-amber-900">
                  {w.message || "Waiting for user confirmation at the door."}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    label="Confirm & Continue"
                    variant="primary"
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.hardwareConfirmRequest(w.request_id))}
                  />
                  <ActionButton
                    label="Cancel Request"
                    variant="danger"
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.hardwareCancelRequest(w.request_id))}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <Card
            title="Mission Control"
            subtitle="High-utility actions for homing, safety, and machine positioning."
            right={<BrandMark size={64} spinning />}
          >
            <div className="grid gap-3 md:grid-cols-5">
              <ActionButton
                label="Home Machine"
                variant="primary"
                disabled={loading}
                onClick={() => run(() => apiAdmin.manualHomeAll(homeMode))}
              />
              <ActionButton
                label="Go To Door"
                disabled={loading}
                onClick={() => run(() => apiAdmin.manualGoToDoor())}
              />
              <ActionButton
                label="Refresh Status"
                disabled={loading}
                onClick={() => run(() => apiAdmin.machineQueryStatus())}
              />
              <ActionButton
                label="Ping Klipper"
                disabled={loading}
                onClick={pingKlipper}
              />
              <ActionButton
                label="Emergency Stop"
                variant="danger"
                disabled={loading}
                onClick={() => run(() => apiAdmin.machineEmergencyStop())}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(["python_assisted", "true_synced", "manual_independent"] as HomeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setHomeMode(mode)}
                  className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                    homeMode === mode ? "bg-rose-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Machine" value={readyText} />
              <Stat label="Homed" value={status?.homed ? "Yes" : "No"} />
              <Stat label="Horizontal" value={status?.horizontal_position ?? "—"} />
              <Stat label="Vertical" value={status?.vertical_position ?? "—"} />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {lastMessage}
            </div>
          </Card>

          <Card title="Linear axes" subtitle="Use large touch-friendly jog buttons for gantry and horizontal movement.">
            <div className="mb-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {LINEAR_STEP_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setLinearStep(opt);
                      setLinearCustomStep(String(opt));
                    }}
                    className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                      linearStep === opt ? "bg-rose-600 text-white" : "border border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={linearCustomStep}
                  onChange={(e) => setLinearCustomStep(e.target.value)}
                  className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800"
                  placeholder="Custom step"
                />
                <ActionButton label="Use Custom" disabled={loading} onClick={applyLinearCustomStep} />
                <div className="text-sm text-slate-500">Current jog: {linearStep}</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-800">Vertical sync</div>
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton
                    label={`Up +${linearStep}`}
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.manualJogAxis({ axis: "vertical", direction: "positive", step: linearStep }))}
                  />
                  <ActionButton
                    label={`Down -${linearStep}`}
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.manualJogAxis({ axis: "vertical", direction: "negative", step: linearStep }))}
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-800">Horizontal</div>
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton
                    label={`Left +${linearStep}`}
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.manualJogAxis({ axis: "horizontal", direction: "positive", step: linearStep }))}
                  />
                  <ActionButton
                    label={`Right -${linearStep}`}
                    disabled={loading}
                    onClick={() => run(() => apiAdmin.manualJogAxis({ axis: "horizontal", direction: "negative", step: linearStep }))}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card title="Cake positioning" subtitle="Move the selected cake by slot count using backend-managed current slot state.">
            <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-700">Cake</div>
                  <div className="flex flex-wrap gap-2">
                    {CAKE_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setSelectedCake(c)}
                        className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                          selectedCake === c ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        Cake {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-700">Slot count</div>
                  <div className="flex flex-wrap gap-2">
                    {CAKE_STEP_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setCakeStep(opt);
                          setCakeCustomStep(String(opt));
                        }}
                        className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                          cakeStep === opt ? "bg-rose-600 text-white" : "border border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={cakeCustomStep}
                    onChange={(e) => setCakeCustomStep(e.target.value)}
                    className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800"
                    placeholder="Custom slots"
                  />
                  <ActionButton label="Use Custom" disabled={loading} onClick={applyCakeCustomStep} />
                  <div className="text-sm text-slate-500">Current move: {cakeStep} slot{cakeStep > 1 ? "s" : ""}</div>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#fff5f8)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Current backend slot</div>
                    <div className="mt-1 text-3xl font-black text-slate-950">{currentCakeSlot}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setCakeDirection("ccw")}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                        cakeDirection === "ccw" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      CCW
                    </button>
                    <button
                      onClick={() => setCakeDirection("cw")}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                        cakeDirection === "cw" ? "bg-rose-600 text-white" : "border border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      CW
                    </button>
                  </div>
                </div>

                <div className="mt-4 text-sm text-slate-600">
                  Manual cake moves use backend slot state, so the bridge receives current and target slot cleanly.
                </div>

                <div className="mt-5">
                  <ActionButton
                    label={`Move Cake ${selectedCake} by ${cakeStep} slot${cakeStep > 1 ? "s" : ""}`}
                    variant="primary"
                    disabled={loading}
                    onClick={() =>
                      run(() =>
                        apiAdmin.manualMoveCake({
                          cake_id: selectedCake,
                          step: cakeStep,
                          direction: cakeDirection,
                        })
                      )
                    }
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card title="Klipper files" subtitle="Raw editor for host-mounted vars.cfg and steppers.cfg.">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => loadEditorFile("vars.cfg")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                    editorFile === "vars.cfg"
                      ? "bg-rose-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  vars.cfg
                </button>
                <button
                  onClick={() => loadEditorFile("steppers.cfg")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                    editorFile === "steppers.cfg"
                      ? "bg-rose-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  steppers.cfg
                </button>
                <ActionButton
                  label="Reload"
                  disabled={editorLoading}
                  onClick={() => loadEditorFile(editorFile)}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Editing <span className="font-mono font-semibold text-slate-900">{editorFile}</span>
              </div>

              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck={false}
                className="min-h-[360px] w-full rounded-[24px] border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100"
              />

              <div className="flex flex-wrap gap-2">
                <ActionButton
                  label="Save"
                  variant="primary"
                  disabled={editorLoading}
                  onClick={saveEditorFile}
                />
                <ActionButton
                  label="Save + Restart Klipper"
                  disabled={editorLoading}
                  onClick={() => saveAndRestart("restart_klipper")}
                />
                <ActionButton
                  label="Save + Firmware Restart"
                  variant="danger"
                  disabled={editorLoading}
                  onClick={() => saveAndRestart("firmware_restart")}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Saves are atomic and the previous file is backed up as <span className="font-mono">.bak</span>.
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Live camera" subtitle="Embedded crowsnest stream for remote supervision.">
            <div className="aspect-[4/5] overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950">
              {CONFIG.cameraStreamUrl ? (
                <img src={CONFIG.cameraStreamUrl} alt="Crowsnest stream" className="h-full w-full bg-black object-cover" />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-300">
                  Set VITE_CAMERA_STREAM_URL or serve the stream at <span className="mx-1 font-mono">/stream</span>.
                </div>
              )}
            </div>
          </Card>

          <Card title="Alert stack" subtitle="Recent machine alerts surfaced from the backend.">
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No active alerts.
                </div>
              ) : (
                alerts.slice(0, 5).map((a, idx) => {
                  const ts =
                    a.createdAt || a.created_at || a.ts || a.timestamp || null;

                  return (
                    <div
                      key={a.alert_id || a.event_id || idx}
                      className={`rounded-2xl border p-4 ${
                        a.severity === "critical" || a.severity === "error"
                          ? "border-rose-200 bg-rose-50"
                          : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold text-slate-900">{a.code || "ALERT"}</div>
                        {ts ? (
                          <div className="shrink-0 text-[11px] text-slate-500">
                            {new Date(ts).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{a.message}</div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}