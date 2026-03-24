import { useEffect, useMemo, useState } from "react";
import {
  apiAdmin,
  type AxisName,
  type CakeMoveDirection,
  type CalibrationSetReq,
  type HomeMode,
  type MachineAlert,
  type PendingHardwareWait,
  type MachineStatus,
  type ManualCommandResp,
  type ManualControlStatus,
} from "../../../lib/api.admin";

const LINEAR_STEP_OPTIONS = [1, 5, 10, 25, 50, 100];
const CAKE_STEP_OPTIONS = [1, 2, 3, 4, 5, 6];
const CAKE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const CAMERA_URL = "";

function Card({
  title,
  subtitle,
  children,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={[
        "rounded-2xl border bg-white shadow-sm",
        tone === "danger" ? "border-red-300" : "border-slate-200",
      ].join(" ")}
    >
      <div
        className={[
          "border-b px-4 py-4 sm:px-5",
          tone === "danger" ? "border-red-200 bg-red-50/70" : "border-slate-100",
        ].join(" ")}
      >
        <div className="text-base font-semibold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function StepSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={[
                "min-h-[44px] rounded-xl border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-rose-600 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = "default",
  fullWidth = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  fullWidth?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "border-rose-700 bg-rose-700 text-white hover:bg-rose-800"
      : variant === "danger"
      ? "border-red-700 bg-red-700 text-white hover:bg-red-800"
      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "min-h-[46px] rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm transition-all active:scale-[0.99]",
        fullWidth ? "w-full" : "",
        disabled ? "cursor-not-allowed opacity-50" : styles,
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-4",
        tone === "danger"
          ? "border-red-200 bg-red-50"
          : tone === "success"
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-slate-50",
      ].join(" ")}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900 break-words">
        {value === undefined || value === null || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}

function AlertChip({ alert }: { alert: MachineAlert }) {
  const tone =
    alert.style === "black" || alert.severity === "critical"
      ? "border-slate-900 bg-slate-950 text-white"
      : alert.style === "red" || alert.severity === "error"
      ? "border-red-700 bg-red-700 text-white"
      : alert.style === "amber" || alert.severity === "warning"
      ? "border-amber-300 bg-amber-100 text-amber-950"
      : "border-slate-200 bg-slate-100 text-slate-900";

  return (
    <div className={["rounded-2xl border p-3", tone].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{alert.code ?? "MACHINE_ALERT"}</div>
          <div className="mt-1 text-sm opacity-95">{alert.message ?? "No alert message"}</div>
        </div>
        {alert.ts ? <div className="shrink-0 text-[11px] opacity-80">{new Date(alert.ts).toLocaleTimeString()}</div> : null}
      </div>
      {(alert.source || alert.related_request_id) && (
        <div className="mt-2 text-xs opacity-80">
          {alert.source ? `Source: ${alert.source}` : ""}
          {alert.source && alert.related_request_id ? " · " : ""}
          {alert.related_request_id ? `Req: ${alert.related_request_id}` : ""}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-sm font-medium text-slate-700">{children}</div>;
}

function toFriendlyState(status?: ManualControlStatus | MachineStatus | null) {
  if (!status) return "Unknown";
  if (status.reachable === false) return "Offline";
  if (status.busy) return "Busy";
  if (status.homed === false) return "Unhomed";
  return status.state || status.klipper_state || "Ready";
}

function getStatusTone(status?: ManualControlStatus | MachineStatus | null): "default" | "danger" | "success" {
  if (!status) return "default";
  if (status.reachable === false || status.homed === false) return "danger";
  if (status.busy === false && status.reachable !== false) return "success";
  return "default";
}

export default function ManualControl() {
  const [linearStep, setLinearStep] = useState(10);
  const [cakeStep, setCakeStep] = useState(1);
  const [selectedCake, setSelectedCake] = useState(1);
  const [cakeDirection, setCakeDirection] = useState<CakeMoveDirection>("cw");
  const [homeMode, setHomeMode] = useState<HomeMode>("python_assisted");

  const [doorX, setDoorX] = useState("");
  const [doorZ, setDoorZ] = useState("");
  const [cakeCenter, setCakeCenter] = useState("");

  const [loading, setLoading] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [refreshingAlerts, setRefreshingAlerts] = useState(false);
  const [refreshingCalibration, setRefreshingCalibration] = useState(false);

  const [lastResult, setLastResult] = useState<ManualCommandResp | null>(null);
  const [manualStatus, setManualStatus] = useState<ManualControlStatus | null>(null);
  const [machineStatus, setMachineStatus] = useState<MachineStatus | null>(null);
  const [alerts, setAlerts] = useState<MachineAlert[]>([]);
  const [waits, setWaits] = useState<PendingHardwareWait[]>([]);
  const [error, setError] = useState("");

  const statusText = useMemo(() => {
    if (loading) return "Sending command...";
    if (refreshingStatus) return "Refreshing machine status...";
    if (refreshingAlerts) return "Refreshing machine alerts...";
    if (refreshingCalibration) return "Refreshing calibration...";
    if (error) return error;
    if (lastResult?.message) return lastResult.message;
    return "Ready";
  }, [loading, refreshingStatus, refreshingAlerts, refreshingCalibration, error, lastResult]);

  const criticalAlerts = useMemo(
    () => alerts.filter((a) => a.severity === "critical" || a.style === "black" || a.severity === "error" || a.style === "red"),
    [alerts]
  );

  async function refreshEverything({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setRefreshingStatus(true);
    try {
      const [manual, machine, nextAlerts, nextWaits] = await Promise.allSettled([
        apiAdmin.manualStatus(),
        apiAdmin.machineStatus(),
        apiAdmin.machineAlerts(),
        apiAdmin.hardwareWaits(),
      ]);

      if (manual.status === "fulfilled") setManualStatus(manual.value);
      if (machine.status === "fulfilled") setMachineStatus(machine.value);
      if (nextAlerts.status === "fulfilled") setAlerts(nextAlerts.value);
      if (nextWaits.status === "fulfilled") setWaits(nextWaits.value.waits ?? []);
    } catch (err) {
      console.error(err);
      if (!silent) setError(err instanceof Error ? err.message : "Could not refresh machine state");
    } finally {
      if (!silent) setRefreshingStatus(false);
    }
  }

  async function refreshAlerts() {
    try {
      setRefreshingAlerts(true);
      setError("");
      setAlerts(await apiAdmin.machineAlerts());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not fetch machine alerts");
    } finally {
      setRefreshingAlerts(false);
    }
  }

  async function refreshWaits() {
    try {
      const result = await apiAdmin.hardwareWaits();
      setWaits(result.waits ?? []);
    } catch (err) {
      console.error(err);
    }
  }

  async function refreshCalibration() {
    try {
      setRefreshingCalibration(true);
      setError("");
      const result = await apiAdmin.calibrationStatus();
      const vals = result?.values ?? result?.raw ?? {};
      const dx = vals["door_x"] ?? vals["door_distance"] ?? "";
      const dz = vals["door_z"] ?? "";
      const cc = vals[`cake_${selectedCake}_center`] ?? vals[`cake_${selectedCake}_center_x`] ?? "";
      setDoorX(dx === null || dx === undefined ? "" : String(dx));
      setDoorZ(dz === null || dz === undefined ? "" : String(dz));
      setCakeCenter(cc === null || cc === undefined ? "" : String(cc));
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshingCalibration(false);
    }
  }

  async function runCommand(fn: () => Promise<ManualCommandResp>) {
    try {
      setLoading(true);
      setError("");
      const result = await fn();
      setLastResult(result);
      await refreshEverything({ silent: true });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Manual control command failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshEverything();
    void refreshCalibration();
    void refreshWaits();
    const id = window.setInterval(() => {
      void refreshEverything({ silent: true });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void refreshCalibration();
  }, [selectedCake]);

  function handleLinearJog(axis: AxisName, direction: "positive" | "negative") {
    void runCommand(() => apiAdmin.manualJogAxis({ axis, direction, step: linearStep }));
  }

  function handleCakeMove() {
    void runCommand(() =>
      apiAdmin.manualMoveCake({
        cake_id: selectedCake,
        step: cakeStep,
        direction: cakeDirection,
      })
    );
  }

  function handleCalibration(req: CalibrationSetReq) {
    void runCommand(() => apiAdmin.calibrationSet(req));
  }

  const endstops = (machineStatus?.endstops ?? manualStatus?.endstops ?? {}) as Record<string, boolean | null>;
  const verticalTilted =
    (machineStatus?.vertical_tilted ?? manualStatus?.vertical_tilted) ??
    ((endstops.gantry1 ?? null) !== (endstops.gantry2 ?? null) && endstops.gantry1 != null && endstops.gantry2 != null);

  return (
    <div className="space-y-4 sm:space-y-6">
      {criticalAlerts.length > 0 && (
        <div className="space-y-2">
          {criticalAlerts.slice(0, 2).map((alert, idx) => (
            <AlertChip key={`${alert.alert_id ?? alert.event_id ?? idx}`} alert={alert} />
          ))}
        </div>
      )}

      {waits.length > 0 && (
        <Card title="Pending User Confirms" subtitle="Requests waiting at the door for admin intervention">
          <div className="space-y-3">
            {waits.map((w) => (
              <div key={`${w.request_id}-${w.stage}`} className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-950">
                  {w.action || "request"} · {w.stage || "waiting_user_confirm"}
                </div>
                <div className="mt-1 text-sm text-amber-900">
                  {w.message ?? "Waiting for user confirmation."}
                </div>
                <div className="mt-2 text-xs text-amber-800">
                  Request: {w.request_id} · Timeout: {w.timeout_s ?? 0}s
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ActionButton
                    label="Confirm & Continue"
                    onClick={() => void runCommand(() => apiAdmin.hardwareConfirmRequest(w.request_id))}
                    disabled={loading}
                    variant="primary"
                    fullWidth
                  />
                  <ActionButton
                    label="Cancel Request"
                    onClick={() => void runCommand(() => apiAdmin.hardwareCancelRequest(w.request_id))}
                    disabled={loading}
                    variant="danger"
                    fullWidth
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] xl:gap-6 items-start">
        <div className="space-y-4 sm:space-y-6">
          <Card
            title="Machine Actions"
            subtitle="Fast actions for homing, moving to the door, refreshing status, and stopping motion"
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["python_assisted", "true_synced", "manual_independent"] as HomeMode[]).map((mode) => (
                  <ActionButton
                    key={mode}
                    label={mode}
                    onClick={() => setHomeMode(mode)}
                    disabled={loading}
                    variant={homeMode === mode ? "primary" : "default"}
                    fullWidth
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ActionButton
                  label={`Home Machine (${homeMode})`}
                  onClick={() => void runCommand(() => apiAdmin.manualHomeAll(homeMode))}
                  disabled={loading}
                  variant="primary"
                  fullWidth
                />
                <ActionButton label="Home Horizontal" onClick={() => void runCommand(() => apiAdmin.manualHomeHorizontal())} disabled={loading} fullWidth />
                <ActionButton label="Home Vert Left" onClick={() => void runCommand(() => apiAdmin.manualHomeVerticalLeft())} disabled={loading} fullWidth />
                <ActionButton label="Home Vert Right" onClick={() => void runCommand(() => apiAdmin.manualHomeVerticalRight())} disabled={loading} fullWidth />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ActionButton label="Go to Door" onClick={() => void runCommand(() => apiAdmin.manualGoToDoor())} disabled={loading} fullWidth />
                <ActionButton label="Refresh Status" onClick={() => void refreshEverything()} disabled={loading || refreshingStatus} fullWidth />
                <ActionButton label="Restart Klipper" onClick={() => void runCommand(() => apiAdmin.machineRestartKlipper())} disabled={loading} fullWidth />
                <ActionButton label="Emergency Stop" onClick={() => void runCommand(() => apiAdmin.machineEmergencyStop())} disabled={loading} variant="danger" fullWidth />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ActionButton label="Firmware Restart" onClick={() => void runCommand(() => apiAdmin.machineFirmwareRestart())} disabled={loading} fullWidth />
                <ActionButton label="Query Status" onClick={() => void runCommand(() => apiAdmin.machineQueryStatus())} disabled={loading} fullWidth />
              </div>
            </div>
          </Card>

          <Card title="Axis Jog Controls" subtitle="Large touch-friendly jog buttons for Raspberry Pi touch screens and phones">
            <div className="space-y-5">
              <StepSelector label="Linear step" value={linearStep} options={LINEAR_STEP_OPTIONS} onChange={setLinearStep} />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Horizontal</div>
                  <div className="grid grid-cols-2 gap-3">
                    <ActionButton label="← Left" onClick={() => handleLinearJog("horizontal", "negative")} disabled={loading} fullWidth />
                    <ActionButton label="Right →" onClick={() => handleLinearJog("horizontal", "positive")} disabled={loading} fullWidth />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Vertical</div>
                  <div className="grid grid-cols-2 gap-3">
                    <ActionButton label="↑ Sync Up" onClick={() => handleLinearJog("vertical_sync", "positive")} disabled={loading} fullWidth />
                    <ActionButton label="↓ Sync Down" onClick={() => handleLinearJog("vertical_sync", "negative")} disabled={loading} fullWidth />
                    <ActionButton label="↑ Left Up" onClick={() => handleLinearJog("vertical_left", "positive")} disabled={loading} fullWidth />
                    <ActionButton label="↓ Left Down" onClick={() => handleLinearJog("vertical_left", "negative")} disabled={loading} fullWidth />
                    <ActionButton label="↑ Right Up" onClick={() => handleLinearJog("vertical_right", "positive")} disabled={loading} fullWidth />
                    <ActionButton label="↓ Right Down" onClick={() => handleLinearJog("vertical_right", "negative")} disabled={loading} fullWidth />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Cake Manual Move" subtitle="Rotate a selected cake in 60-degree increments">
            <div className="space-y-5">
              <StepSelector label="60° steps" value={cakeStep} options={CAKE_STEP_OPTIONS} onChange={setCakeStep} />

              <div>
                <SectionLabel>Cake selector</SectionLabel>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                  {CAKE_OPTIONS.map((cake) => {
                    const active = selectedCake === cake;
                    return (
                      <button
                        key={cake}
                        onClick={() => setSelectedCake(cake)}
                        className={[
                          "min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "border-rose-600 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {cake}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <SectionLabel>Direction</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton label="Clockwise" onClick={() => setCakeDirection("cw")} disabled={loading} variant={cakeDirection === "cw" ? "primary" : "default"} fullWidth />
                  <ActionButton label="Counter-clockwise" onClick={() => setCakeDirection("ccw")} disabled={loading} variant={cakeDirection === "ccw" ? "primary" : "default"} fullWidth />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="text-sm text-slate-600">
                  Selected: <span className="font-medium text-slate-800">Cake {selectedCake}</span>
                  {" · "}
                  Direction: <span className="font-medium uppercase text-slate-800">{cakeDirection}</span>
                  {" · "}
                  Steps: <span className="font-medium text-slate-800">{cakeStep}</span>
                </div>
                <ActionButton label="Move Selected Cake" onClick={handleCakeMove} disabled={loading} variant="primary" fullWidth />
              </div>
            </div>
          </Card>

          <Card title="Calibration" subtitle="Save persistent machine distances without editing vars.cfg directly">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <SectionLabel>Door X / distance</SectionLabel>
                  <input
                    value={doorX}
                    onChange={(e) => setDoorX(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none ring-0 focus:border-rose-500"
                    placeholder="e.g. 123.4"
                  />
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <ActionButton
                      label="Set door X"
                      onClick={() => handleCalibration({ action: "set_door_x", value: Number(doorX) })}
                      disabled={loading || !doorX}
                      fullWidth
                    />
                    <ActionButton
                      label="Set door distance"
                      onClick={() => handleCalibration({ action: "set_door_distance", value: Number(doorX) })}
                      disabled={loading || !doorX}
                      fullWidth
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <SectionLabel>Door Z</SectionLabel>
                  <input
                    value={doorZ}
                    onChange={(e) => setDoorZ(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none ring-0 focus:border-rose-500"
                    placeholder="e.g. 40.0"
                  />
                  <div className="mt-3">
                    <ActionButton
                      label="Set door Z"
                      onClick={() => handleCalibration({ action: "set_door_z", value: Number(doorZ) })}
                      disabled={loading || !doorZ}
                      fullWidth
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <SectionLabel>Cake {selectedCake} center</SectionLabel>
                  <input
                    value={cakeCenter}
                    onChange={(e) => setCakeCenter(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none ring-0 focus:border-rose-500"
                    placeholder="e.g. 88.0"
                  />
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <ActionButton
                      label="Set center"
                      onClick={() => handleCalibration({ action: "set_cake_center", cake_id: selectedCake, value: Number(cakeCenter) })}
                      disabled={loading || !cakeCenter}
                      fullWidth
                    />
                    <ActionButton
                      label="Set center X"
                      onClick={() => handleCalibration({ action: "set_cake_center_x", cake_id: selectedCake, value: Number(cakeCenter) })}
                      disabled={loading || !cakeCenter}
                      fullWidth
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <ActionButton label={refreshingCalibration ? "Refreshing..." : "Reload Calibration"} onClick={() => void refreshCalibration()} disabled={loading || refreshingCalibration} />
              </div>
            </div>
          </Card>

          <Card title="Machine Status" subtitle="Live machine state for troubleshooting and operations">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
                <StatTile label="State" value={toFriendlyState(machineStatus ?? manualStatus)} tone={getStatusTone(machineStatus ?? manualStatus)} />
                <StatTile label="Reachable" value={machineStatus?.reachable ?? manualStatus?.reachable} tone={(machineStatus?.reachable ?? manualStatus?.reachable) === false ? "danger" : "success"} />
                <StatTile label="Homed" value={machineStatus?.homed ?? manualStatus?.homed} tone={(machineStatus?.homed ?? manualStatus?.homed) === false ? "danger" : "success"} />
                <StatTile label="Busy" value={machineStatus?.busy ?? manualStatus?.busy} />
                <StatTile label="Active Cake" value={manualStatus?.active_cake_id} />
                <StatTile label="Horizontal" value={manualStatus?.horizontal_position} />
                <StatTile label="Vertical" value={manualStatus?.vertical_position} />
                <StatTile label="Klipper State" value={machineStatus?.klipper_state ?? manualStatus?.klipper_state} />
                <StatTile label="Horiz Endstop" value={endstops.horizontal} tone={endstops.horizontal ? "success" : "default"} />
                <StatTile label="Vert Left Endstop" value={endstops.gantry1} tone={endstops.gantry1 ? "success" : "default"} />
                <StatTile label="Vert Right Endstop" value={endstops.gantry2} tone={endstops.gantry2 ? "success" : "default"} />
                <StatTile label="Tilt" value={verticalTilted == null ? "Unknown" : verticalTilted ? "YES" : "No"} tone={verticalTilted ? "danger" : "success"} />
              </div>

              {verticalTilted && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  The two vertical endstops disagree, so the gantry is likely tilted. Either run the independent vertical home macro or jog gantry1 and gantry2 separately until both endstops match.
                </div>
              )}

              {(machineStatus?.klipper_state_message || manualStatus?.klipper_state_message) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {machineStatus?.klipper_state_message ?? manualStatus?.klipper_state_message}
                </div>
              )}
            </div>
          </Card>

          <Card title="Command Status" subtitle="Most recent backend response and machine command result">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-1 text-sm text-slate-500">Current status</div>
              <div className={["text-sm font-medium break-words", error ? "text-red-600" : "text-slate-800"].join(" ")}>
                {statusText}
              </div>

              {lastResult ? (
                <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
                  {JSON.stringify(lastResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-4 sm:space-y-6">
          <Card
            title="Machine Alerts"
            subtitle="Critical alerts are rendered in black or red so they stand out on small touch displays"
            tone={criticalAlerts.length > 0 ? "danger" : "default"}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <ActionButton
                  label={refreshingAlerts ? "Refreshing..." : "Refresh Alerts"}
                  onClick={() => void refreshAlerts()}
                  disabled={loading || refreshingAlerts}
                />
                <ActionButton
                  label="Query Machine Status"
                  onClick={() => void runCommand(() => apiAdmin.machineQueryStatus())}
                  disabled={loading}
                />
              </div>

              <div className="space-y-3">
                {alerts.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No machine alerts yet.
                  </div>
                ) : (
                  alerts.slice(0, 12).map((alert, idx) => (
                    <AlertChip key={`${alert.alert_id ?? alert.event_id ?? idx}`} alert={alert} />
                  ))
                )}
              </div>
            </div>
          </Card>

          <Card title="Camera View" subtitle="Embedded Crowsnest stream for quick machine monitoring">
            <div className="space-y-3">
              <div className="aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                {CAMERA_URL ? (
                  <iframe src={CAMERA_URL} title="Machine Camera" className="h-full w-full" />
                ) : (
                  <div className="grid h-full place-items-center p-4 text-center text-sm text-slate-500">
                    Add your camera stream URL to enable the live feed.
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="break-all text-slate-500">{CAMERA_URL || "No camera URL configured"}</div>
                {CAMERA_URL ? (
                  <a
                    href={CAMERA_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    Open feed
                  </a>
                ) : null}
              </div>

              <div className="text-xs text-slate-500">
                On some streams, the iframe may be blank because the camera server blocks embedding headers.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
