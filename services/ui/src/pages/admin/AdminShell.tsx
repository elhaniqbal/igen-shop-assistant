import { useMemo, useState } from "react";
import type { Session } from "../../App";
import MachineUsage from "./tabs/MachineUsage";
import CheckedOutTools from "./tabs/CheckedOutTools";
import OverdueTools from "./tabs/OverdueTools";
import Inventory from "./tabs/Inventory";
import Users from "./tabs/Users";
import TestTab from "./tabs/TestTab";

type Tab = "usage" | "checked" | "overdue" | "inventory" | "users" | "tests";

export default function AdminShell({
  session,
  onLogout,
  onUserMode,
}: {
  session: Session;
  onLogout: () => void;
  onUserMode: () => void;
}) {
  const [tab, setTab] = useState<Tab>("usage");

  const displayName = useMemo(() => session.name?.trim() || "Admin", [session.name]);

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={[
        "px-3 py-2 text-sm font-medium border-b-2",
        tab === id ? "border-rose-600 text-rose-700" : "border-transparent text-slate-600 hover:text-slate-900",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-14 bg-rose-700 text-white flex items-center justify-between px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/15 grid place-items-center font-semibold">H</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Haven Kiosk</div>
            <div className="text-xs text-white/80">Welcome, {displayName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onUserMode} className="rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/20">
            User Mode
          </button>
          <button onClick={onLogout} className="rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/20">
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="text-2xl font-semibold text-slate-900">Admin Dashboard</div>
        <div className="text-slate-600 mt-1">Monitor tool usage, track overdue items, and manage inventory</div>

        <div className="mt-6 border-b border-slate-200 flex gap-6">
          <TabBtn id="usage" label="Machine Usage" />
          <TabBtn id="checked" label="Checked Out Tools" />
          <TabBtn id="overdue" label="Overdue Tools" />
          <TabBtn id="inventory" label="Inventory" />
          <TabBtn id="users" label="Users" />
          <TabBtn id="tests" label="Hardware Tests" />
        </div>

        <div className="mt-6">
          {tab === "usage" && <MachineUsage />}
          {tab === "checked" && <CheckedOutTools />}
          {tab === "overdue" && <OverdueTools />}
          {tab === "inventory" && <Inventory />}
          {tab === "users" && <Users />}
          {tab === "tests" && <TestTab />}
        </div>
      </div>
    </div>
  );
}
