import { useEffect, useState } from "react";
import { getCheckedOut } from "../../../lib/api";

export default function CheckedOutTools() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { (async () => setRows(await getCheckedOut()))(); }, []);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 font-semibold">Checked Out Tools</div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-4">Tool</th>
              <th className="text-left p-4">Tool ID</th>
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Checked Out</th>
              <th className="text-left p-4">Expected Return</th>
              <th className="text-left p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-4 font-medium">{r.tool}</td>
                <td className="p-4"><span className="rounded-lg bg-slate-100 px-2 py-1">{r.tool_id}</span></td>
                <td className="p-4">{r.user}</td>
                <td className="p-4">{r.out}</td>
                <td className="p-4">{r.due}</td>
                <td className="p-4">
                  <span className={[
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    r.status === "Overdue" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                  ].join(" ")}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-6 text-slate-500" colSpan={6}>No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
