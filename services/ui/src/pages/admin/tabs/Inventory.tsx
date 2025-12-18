import { useEffect, useState } from "react";
import { getInventory } from "../../../lib/api";

export default function Inventory() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { (async () => setRows(await getInventory()))(); }, []);

  const toggle = (name: string) => setOpen((p) => ({ ...p, [name]: !p[name] }));

  const totals = rows.reduce((a, r) => {
    a.total += r.total ?? 0;
    a.available += r.available ?? 0;
    a.checked += r.checked_out ?? 0;
    return a;
  }, { total: 0, available: 0, checked: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat title="Total Tools" value={totals.total || 24} />
        <Stat title="Available" value={totals.available || 19} tint="emerald" />
        <Stat title="Checked Out" value={totals.checked || 5} tint="rose" />
        <Stat title="Low Stock Items" value={0} tint="amber" />
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="font-semibold">Inventory Overview</div>
            <div className="text-sm text-slate-600">Aggregated view of all tools. Click to expand and see individual locations.</div>
          </div>
          <button className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold">
            + Add New Tool
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-4 w-12"></th>
                <th className="text-left p-4">Tool Name</th>
                <th className="text-left p-4">Locations</th>
                <th className="text-left p-4">Category</th>
                <th className="text-left p-4">Available</th>
                <th className="text-left p-4">Total</th>
                <th className="text-left p-4">Checked Out</th>
                <th className="text-left p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = !!open[r.name];
                return (
                  <>
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="p-4">
                        <button onClick={() => toggle(r.name)} className="text-slate-500 hover:text-slate-900">
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="p-4 font-medium">{r.name}</td>
                      <td className="p-4">
                        <div className="flex gap-2 flex-wrap">
                          {(r.locations ?? []).slice(0,3).map((l: string) => (
                            <span key={l} className="rounded-lg bg-rose-600 text-white px-2 py-1 text-xs font-semibold">{l}</span>
                          ))}
                          {(r.locations ?? []).length > 3 && (
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs">+{(r.locations.length - 3)}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">{r.category}</td>
                      <td className="p-4">{r.available}</td>
                      <td className="p-4">{r.total}</td>
                      <td className="p-4">{r.checked_out}</td>
                      <td className="p-4">
                        <span className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-xs font-semibold">
                          {r.status ?? "In Stock"}
                        </span>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-t border-slate-100 bg-slate-50/40">
                        <td colSpan={8} className="p-4">
                          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="text-left p-3 w-44">Tool Item</th>
                                  <th className="text-left p-3 w-28">Loc</th>
                                  <th className="text-left p-3">State</th>
                                  <th className="text-right p-3 w-16"> </th>
                                </tr>
                              </thead>
                              <tbody>
                                {(r.items ?? []).map((it: any) => (
                                  <tr key={it.tool_item_id} className="border-t border-slate-100">
                                    <td className="p-3 text-slate-700">{it.tool_item_id}</td>
                                    <td className="p-3">
                                      <span className="rounded-lg bg-rose-100 text-rose-700 px-2 py-1 text-xs font-semibold">{it.loc}</span>
                                    </td>
                                    <td className="p-3">
                                      <span className={it.state === "Checked Out"
                                        ? "text-rose-700 font-semibold"
                                        : "text-emerald-700 font-semibold"}>
                                        {it.state}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right text-slate-500">🗑️</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-slate-500">No tools.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value, tint }: { title: string; value: any; tint?: "emerald"|"rose"|"amber" }) {
  const cls =
    tint === "emerald" ? "bg-emerald-50 border-emerald-200"
    : tint === "rose" ? "bg-rose-50 border-rose-200"
    : tint === "amber" ? "bg-amber-50 border-amber-200"
    : "bg-white border-slate-200";

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${cls}`}>
      <div className="text-slate-600 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}
