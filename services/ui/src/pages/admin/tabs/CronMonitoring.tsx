import React, { useEffect, useMemo, useState } from "react";
import {
  apiAdmin,
  type AlertRecipient,
  type CronJobConfig,
  type MachineStatus,
} from "../../../lib/api.admin";

function StatusBadge({
  tone,
  children,
}: {
  tone: "green" | "yellow" | "red" | "slate";
  children: React.ReactNode;
}) {
  const tones = {
    green: "bg-emerald-100 text-emerald-800 border-emerald-200",
    yellow: "bg-amber-100 text-amber-800 border-amber-200",
    red: "bg-red-100 text-red-800 border-red-200",
    slate: "bg-slate-100 text-slate-800 border-slate-200",
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function CronMonitoring() {
  const [machineStatus, setMachineStatus] = useState<MachineStatus | null>(null);
  const [jobs, setJobs] = useState<CronJobConfig[]>([]);
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthcheckBusy, setHealthcheckBusy] = useState(false);
  const [emailTestBusy, setEmailTestBusy] = useState(false);
  const [lastActionMessage, setLastActionMessage] = useState<string>("");

  const refreshAll = async () => {
    setLoading(true);
    try {
      const [statusRes, jobsRes, recipientsRes] = await Promise.all([
        apiAdmin.machineStatus(),
        apiAdmin.cronJobs(),
        apiAdmin.cronAlertRecipients(),
      ]);
      setMachineStatus(statusRes);
      setJobs(jobsRes);
      setRecipients(recipientsRes);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const timer = window.setInterval(refreshAll, 7000);
    return () => window.clearInterval(timer);
  }, []);

  const machineTone = useMemo(() => {
    if (!machineStatus?.reachable) return "red";
    if (!machineStatus?.homed) return "yellow";
    if (machineStatus?.busy) return "yellow";
    return "green";
  }, [machineStatus]);

  const runHealthcheck = async () => {
    setHealthcheckBusy(true);
    setLastActionMessage("");
    try {
      const res = await apiAdmin.cronRunHealthcheck();
      setLastActionMessage(res.message || "Healthcheck triggered.");
      await refreshAll();
    } finally {
      setHealthcheckBusy(false);
    }
  };

  const runEmailTest = async () => {
    setEmailTestBusy(true);
    setLastActionMessage("");
    try {
      const res = await apiAdmin.cronRunEmailTest();
      setLastActionMessage(res.message || "Test email triggered.");
      await refreshAll();
    } finally {
      setEmailTestBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Cron & Monitoring</h2>
          <p className="mt-1 text-sm text-slate-600">
            Hardware health checks, alert recipients, and scheduled monitoring status.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={runHealthcheck}
            disabled={healthcheckBusy}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {healthcheckBusy ? "Running..." : "Run Healthcheck"}
          </button>

          <button
            type="button"
            onClick={runEmailTest}
            disabled={emailTestBusy}
            className="rounded-xl bg-red-700 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
          >
            {emailTestBusy ? "Sending..." : "Send Test Email"}
          </button>
        </div>
      </div>

      {lastActionMessage ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
          {lastActionMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Machine Monitor">
          {loading ? (
            <p className="text-sm text-slate-500">Loading machine status...</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-600">Overall</span>
                <StatusBadge tone={machineTone as "green" | "yellow" | "red" | "slate"}>
                  {!machineStatus?.reachable
                    ? "Offline"
                    : machineStatus?.busy
                      ? "Busy"
                      : machineStatus?.homed
                        ? "Healthy"
                        : "Unhomed"}
                </StatusBadge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">Reachable</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {machineStatus?.reachable ? "Yes" : "No"}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">Homed</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {machineStatus?.homed ? "Yes" : "No"}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">Busy</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {machineStatus?.busy ? "Yes" : "No"}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-slate-500">State</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {machineStatus?.state || "Unknown"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Klipper Message</p>
                <p className="mt-1 break-words font-medium text-slate-900">
                  {machineStatus?.klipper_state_message || "No message"}
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card title="Scheduled Jobs">
          {loading ? (
            <p className="text-sm text-slate-500">Loading cron jobs...</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-slate-500">No cron jobs returned by backend.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{job.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{job.description || job.schedule}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={job.enabled ? "green" : "slate"}>
                        {job.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>

                      <StatusBadge
                        tone={
                          job.last_status === "ok"
                            ? "green"
                            : job.last_status === "error"
                              ? "red"
                              : "slate"
                        }
                      >
                        {job.last_status || "unknown"}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-500">
                    Last run: {job.last_run_ts ? new Date(job.last_run_ts).toLocaleString() : "Never"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Alert Recipients">
          {loading ? (
            <p className="text-sm text-slate-500">Loading recipients...</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-slate-500">No alert recipients configured.</p>
          ) : (
            <div className="space-y-3">
              {recipients.map((recipient, idx) => (
                <div key={`${recipient.email}-${idx}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium text-slate-900">{recipient.email}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={recipient.enabled ? "green" : "slate"}>
                        {recipient.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                      <StatusBadge tone="yellow">
                        {recipient.severity_threshold || "warning"}+
                      </StatusBadge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}