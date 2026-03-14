import { useEffect, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { apiAdmin, type UsagePoint } from "../../../lib/api.admin";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

export default function MachineUsage() {
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState<UsagePoint[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async (d: number) => {
    try {
      setErr(null);
      setRows(await apiAdmin.usage(d));
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Machine Usage</div>
          <div className="text-sm text-slate-600 mt-1">Succeeded dispense/return events per day</div>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-xl border px-3 py-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={() => load(days)}>
            Refresh
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

      <div className="h-72 mt-5">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="dispenses" />
            <Bar dataKey="returns" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
