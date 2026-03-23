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

type Tab =
  | "usage"
  | "checked"
  | "overdue"
  | "inventory"
  | "users"
  | "tests"
  | "cakes"
  | "manual";

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
        "min-h-[42px] whitespace-nowrap rounded-t-xl px-3 py-2 text-sm font-medium border-b-2 transition-colors",
        tab === id
          ? "border-rose-600 text-rose-700"
          : "border-transparent text-slate-600 hover:text-slate-900",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-rose-700 text-white shadow-sm">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 font-semibold">H</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Haven Kiosk</div>
              <div className="text-xs text-white/80">Welcome, {displayName}</div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button onClick={onUserMode} className="min-h-[42px] rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/20">
              User Mode
            </button>
            <button onClick={onLogout} className="min-h-[42px] rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/20">
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="text-xl font-semibold text-slate-900 sm:text-2xl">Admin Dashboard</div>
        <div className="mt-1 text-sm text-slate-600 sm:text-base">
          Monitor tool usage, manage inventory, and control the machine from desktop, phones, or a 7-inch touch display.
        </div>

        <div className="mt-5 overflow-x-auto border-b border-slate-200">
          <div className="flex min-w-max gap-2 sm:gap-4">
            <TabBtn id="usage" label="Machine Usage" />
            <TabBtn id="checked" label="Checked Out Tools" />
            <TabBtn id="overdue" label="Overdue Tools" />
            <TabBtn id="inventory" label="Inventory" />
            <TabBtn id="users" label="Users" />
            <TabBtn id="tests" label="Hardware Tests" />
            <TabBtn id="cakes" label="Cakes" />
            <TabBtn id="manual" label="Manual Control" />
          </div>
        </div>

        <div className="mt-5 sm:mt-6">
          {tab === "usage" && <MachineUsage />}
          {tab === "checked" && <CheckedOutTools />}
          {tab === "overdue" && <OverdueTools />}
          {tab === "inventory" && <Inventory />}
          {tab === "users" && <Users />}
          {tab === "tests" && <TestTab />}
          {tab === "cakes" && <Cakes />}
          {tab === "manual" && <ManualControl />}
        </div>
      </div>
    </div>
  );
}
