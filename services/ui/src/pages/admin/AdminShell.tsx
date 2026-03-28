import { useMemo, useState } from "react";
import type { Session } from "../../App";
import MachineUsage from "./tabs/MachineUsage";
import CheckedOutTools from "./tabs/CheckedOutTools";
import OverdueTools from "./tabs/OverdueTools";
import Inventory from "./tabs/Inventory";
import Users from "./tabs/Users";
import TestTab from "./tabs/TestTab";
import Cakes from "./tabs/Cakes";
import ManualControl from "./tabs/ManualControl";
import CronMonitoring from "./tabs/CronMonitoring";
import { useAdminAlertToasts } from "../../hooks/useAdminAlertToasts";
import { AlertToastProvider } from "../../components/AlertToastProvider";
import { BrandMark } from "../../components/BrandMark";

function AdminAlertToastBridge() {
  useAdminAlertToasts({ enabled: true, intervalMs: 4000 });
  return null;
}

type Tab = "usage" | "checked" | "overdue" | "inventory" | "users" | "tests" | "cakes" | "manual" | "cron";

export default function AdminShell({ session, onLogout, onUserMode }: { session: Session; onLogout: () => void; onUserMode: () => void }) {
  const [tab, setTab] = useState<Tab>("manual");
  const displayName = useMemo(() => session.name?.trim() || "Admin", [session.name]);
  const tabs: { id: Tab; label: string }[] = [
    { id: "manual", label: "Manual Control" },
    { id: "cakes", label: "Cakes" },
    { id: "tests", label: "Hardware Tests" },
    { id: "inventory", label: "Inventory" },
    { id: "checked", label: "Checked Out" },
    { id: "overdue", label: "Overdue" },
    { id: "usage", label: "Usage" },
    { id: "users", label: "Users" },
    { id: "cron", label: "Cron & Alerts" },
  ];

  return (
    <AlertToastProvider>
      <AdminAlertToastBridge />
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.10),_transparent_25%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_40%,#f8fafc_100%)]">
        <div className="border-b border-white/70 bg-white/80 shadow-sm backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <BrandMark size={60} spinning />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.32em] text-rose-600">HAVEN Admin Console</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">Machine operations, inventory, and alerts</div>
                  <div className="mt-1 text-sm text-slate-600">Signed in as {displayName}. Optimized for desktop, phone, and kiosk touchscreen control.</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={onUserMode} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-[radial-gradient(circle_at_top,_rgba(255,61,87,0.10),_transparent_18%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_32%,#eef2ff_100%)]">User Mode</button>
                <button onClick={onLogout} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Logout</button>
              </div>
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className={[
                  "whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-medium transition",
                  tab === t.id ? "bg-rose-600 text-white shadow" : "border border-slate-200 bg-white text-slate-700 hover:bg-[radial-gradient(circle_at_top,_rgba(255,61,87,0.10),_transparent_18%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_32%,#eef2ff_100%)]",
                ].join(" ")}>{t.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {tab === "usage" && <MachineUsage />}
          {tab === "checked" && <CheckedOutTools />}
          {tab === "overdue" && <OverdueTools />}
          {tab === "inventory" && <Inventory />}
          {tab === "users" && <Users />}
          {tab === "tests" && <TestTab />}
          {tab === "cakes" && <Cakes />}
          {tab === "manual" && <ManualControl />}
          {tab === "cron" && <CronMonitoring />}
        </div>
      </div>
    </AlertToastProvider>
  );
}
