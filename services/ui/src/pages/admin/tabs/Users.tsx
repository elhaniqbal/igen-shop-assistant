import { useEffect, useMemo, useState } from "react";
import { getUsers } from "../../../lib/api";

export default function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [showDelinq, setShowDelinq] = useState(false);

  useEffect(() => { (async () => setRows(await getUsers()))(); }, []);

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      const hay = `${r.name} ${r.student_id} ${r.email} ${r.badge}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
    return showDelinq ? base.filter(r => r.status === "Delinquent") : base;
  }, [rows, q, showDelinq]);

  const delinqCount = rows.filter(r => r.status === "Delinquent").length;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">User Management</div>
          <div className="text-sm text-slate-600 mt-1">Add, remove, and monitor users</div>
        </div>
        <button className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold">
          + Add User
        </button>
      </div>

      <div className="mt-4 flex gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2"
          placeholder="Search by name, email, or student ID..."
        />
        <button
          onClick={() => setShowDelinq(s => !s)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
        >
          {showDelinq ? "Show All" : "Show Delinquent"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Total Users" value={rows.length} />
        <Stat title="Regular Users" value={rows.length - delinqCount} />
        <Stat title="Delinquent Users" value={delinqCount} tint="rose" />
      </div>

      <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Student ID</th>
              <th className="text-left p-4">Email</th>
              <th className="text-left p-4">Role</th>
              <th className="text-left p-4">Status</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r: any) => (
              <tr key={r.email} className="border-t border-slate-100">
                <td className="p-4">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-slate-500">ID: {r.badge}</div>
                </td>
                <td className="p-4"><span className="rounded-lg bg-slate-100 px-2 py-1">{r.student_id}</span></td>
                <td className="p-4">{r.email}</td>
                <td className="p-4">
                  <span className="rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-xs font-semibold">{r.role}</span>
                </td>
                <td className="p-4">
                  <span className={[
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    r.status === "Delinquent" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                  ].join(" ")}>
                    {r.status}
                  </span>
                </td>
                <td className="p-4 text-right text-slate-500">🗑️</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-slate-500">No users.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ title, value, tint }: { title: string; value: any; tint?: "rose" }) {
  const cls = tint === "rose" ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200";
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${cls}`}>
      <div className="text-slate-600 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}
