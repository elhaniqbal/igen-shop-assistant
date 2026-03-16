import { useEffect, useMemo, useState } from "react";
import {
  apiAdmin,
  type AxisName,
  type ManualCommandResp,
  type ManualControlStatus,
} from "../../../lib/api.admin";

const LINEAR_STEP_OPTIONS = [1, 5, 10, 25, 50, 100];
const CAKE_STEP_OPTIONS = [1, 5, 10, 25, 50, 100];
const CAKE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

const CAMERA_URL = "";

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      <div className="p-5">{children}</div>
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
                "rounded-xl border px-3 py-2 text-sm transition-colors",
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
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
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
        "rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm transition-all active:scale-[0.99]",
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
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">
        {value === undefined || value === null || value === "" ? "—" : value}
      </div>
    </div>
  );
}

export default function ManualControl() {
  const [linearStep, setLinearStep] = useState(10);
  const [cakeStep, setCakeStep] = useState(10);
  const [selectedCake, setSelectedCake] = useState(1);

  const [loading, setLoading] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  const [lastResult, setLastResult] = useState<ManualCommandResp | null>(null);
  const [machineStatus, setMachineStatus] = useState<ManualControlStatus | null>(null);
  const [error, setError] = useState("");

  const statusText = useMemo(() => {
    if (loading) return "Sending command...";
    if (refreshingStatus) return "Refreshing machine status...";
    if (error) return error;
    if (lastResult?.message) return lastResult.message;
    return "Ready";
  }, [loading, refreshingStatus, error, lastResult]);

  async function runCommand(fn: () => Promise<ManualCommandResp>) {
    try {
      setLoading(true);
      setError("");
      const result = await fn();
      setLastResult(result);
      await refreshStatusSilently();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Manual control command failed");
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    try {
      setRefreshingStatus(true);
      setError("");
      const result = await apiAdmin.manualStatus();
      setMachineStatus(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Could not fetch machine status");
    } finally {
      setRefreshingStatus(false);
    }
  }

  async function refreshStatusSilently() {
    try {
      const result = await apiAdmin.manualStatus();
      setMachineStatus(result);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  function handleLinearJog(axis: AxisName, direction: "positive" | "negative") {
    void runCommand(() =>
      apiAdmin.manualJogAxis({
        axis,
        direction,
        step: linearStep,
      })
    );
  }

  function handleCakeMove() {
    void runCommand(() =>
      apiAdmin.manualMoveCake({
        cake_id: selectedCake,
        step: cakeStep,
      })
    );
  }

  function handleHomeAll() {
    void runCommand(() => apiAdmin.manualHomeAll());
  }

  function handleGoToDoor() {
    void runCommand(() => apiAdmin.manualGoToDoor());
  }

  function handleStop() {
    void runCommand(() => apiAdmin.manualStop());
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-6 items-start">
        <div className="space-y-6">
          <Card
            title="Machine Actions"
            subtitle="High-level admin actions for homing, door position, and stopping motion"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ActionButton
                label="Home All"
                onClick={handleHomeAll}
                disabled={loading}
                variant="primary"
              />
              <ActionButton
                label="Go to Door"
                onClick={handleGoToDoor}
                disabled={loading}
              />
              <ActionButton
                label="Emergency Stop"
                onClick={handleStop}
                disabled={loading}
                variant="danger"
              />
            </div>
          </Card>

          <Card
            title="XY Jog Controls"
            subtitle="Jog the horizontal and vertical axes using fixed step sizes"
          >
            <div className="space-y-5">
              <StepSelector
                label="Linear step"
                value={linearStep}
                options={LINEAR_STEP_OPTIONS}
                onChange={setLinearStep}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Horizontal</div>
                  <div className="grid grid-cols-2 gap-3">
                    <ActionButton
                      label="← Left"
                      onClick={() => handleLinearJog("horizontal", "negative")}
                      disabled={loading}
                    />
                    <ActionButton
                      label="Right →"
                      onClick={() => handleLinearJog("horizontal", "positive")}
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Vertical</div>
                  <div className="grid grid-cols-2 gap-3">
                    <ActionButton
                      label="↑ Up"
                      onClick={() => handleLinearJog("vertical", "positive")}
                      disabled={loading}
                    />
                    <ActionButton
                      label="↓ Down"
                      onClick={() => handleLinearJog("vertical", "negative")}
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Cake Manual Move"
            subtitle="Select a cake and move it using a fixed step amount"
          >
            <div className="space-y-5">
              <StepSelector
                label="Cake step"
                value={cakeStep}
                options={CAKE_STEP_OPTIONS}
                onChange={setCakeStep}
              />

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Cake selector</div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {CAKE_OPTIONS.map((cake) => {
                    const active = selectedCake === cake;
                    return (
                      <button
                        key={cake}
                        onClick={() => setSelectedCake(cake)}
                        className={[
                          "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
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

              <div className="flex flex-wrap items-center gap-3">
                <ActionButton
                  label="Move Selected Cake"
                  onClick={handleCakeMove}
                  disabled={loading}
                  variant="primary"
                />
                <div className="text-sm text-slate-500">
                  Selected: <span className="font-medium text-slate-700">Cake {selectedCake}</span>
                  {" · "}
                  Step: <span className="font-medium text-slate-700">{cakeStep}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="Machine Status"
            subtitle="Live machine state and last known positions"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Horizontal" value={machineStatus?.horizontal_position} />
                <StatTile label="Vertical" value={machineStatus?.vertical_position} />
                <StatTile label="Active Cake" value={machineStatus?.active_cake_id} />
                <StatTile label="State" value={machineStatus?.state} />
              </div>

              <div className="flex flex-wrap gap-3">
                <ActionButton
                  label={refreshingStatus ? "Refreshing..." : "Refresh Status"}
                  onClick={() => void refreshStatus()}
                  disabled={refreshingStatus || loading}
                />
              </div>
            </div>
          </Card>

          <Card
            title="Command Status"
            subtitle="Most recent backend response"
          >
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-1 text-sm text-slate-500">Current status</div>
              <div className={["text-sm font-medium", error ? "text-red-600" : "text-slate-800"].join(" ")}>
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

        <div className="space-y-6">
          <Card
            title="Camera View"
            subtitle="Embedded Crowsnest stream"
          >
            <div className="space-y-3">
              <div className="aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <iframe
                  src={CAMERA_URL}
                  title="Machine Camera"
                  className="h-full w-full"
                />
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="break-all text-slate-500">{CAMERA_URL}</div>
                <a
                  href={CAMERA_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
                >
                  Open feed
                </a>
              </div>

              <div className="text-xs text-slate-500">
                If the iframe is blank, the stream is probably blocking embedding headers.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}