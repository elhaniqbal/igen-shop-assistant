import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { getAdminSummary, getWeeklyDispenses, getCategoryUsage } from "../../../lib/api";

export default function MachineUsage() {
  const [summary, setSummary] = useState<any>(null);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setSummary(await getAdminSummary());
      setWeekly(await getWeeklyDispenses());
      setCats(await getCategoryUsage());
    })();
  }, []);

  const card = (title: string, value: string | number) => (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="text-slate-600 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {card("Total Monthly Dispenses", summary?.monthly_dispenses ?? "—")}
        {card("Active Users", summary?.active_users ?? "—")}
        {card("Avg. Checkout Duration", summary ? `${summary.avg_checkout_hours}h` : "—")}
        {card("Current Checked Out", summary?.checked_out_now ?? "—")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="font-semibold">Weekly Tool Dispenses</div>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekly}>
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
          <div className="font-semibold">Usage by Category</div>
          <div className="h-64 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cats} dataKey="pct" nameKey="category" outerRadius={90} label />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 text-sm text-slate-600">
            {cats.map((c) => (
              <div key={c.category}>{c.category}: {c.pct}%</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
