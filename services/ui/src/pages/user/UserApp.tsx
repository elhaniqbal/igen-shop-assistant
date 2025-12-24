import { useEffect, useMemo, useState } from "react";
import { DispenseModal } from "./DispenseModal";
import { apiAdmin, type ToolModel, type InventoryRow } from "../../lib/api.admin";
import { apiUser, type LoanRow } from "../../lib/api.user";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

type Tab = "browse" | "mytools" | "return";

type CartEntry = { tool_model_id: string; qty: number; label: string };

export function UserApp({
  userId,
  readerId,
  displayName,
  onLogout,
  canAdminMode,
  onAdminMode,
}: {
  userId: string;
  readerId: string;
  displayName: string;
  onLogout: () => void;
  canAdminMode: boolean;
  onAdminMode: () => void;
}) {
  const [tab, setTab] = useState<Tab>("browse");
  const [toolModels, setToolModels] = useState<ToolModel[]>([]);
  const [inv, setInv] = useState<Record<string, InventoryRow>>({});
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // -------- CART --------
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [cartOpen, setCartOpen] = useState(false);

  const cartItems = useMemo(() => Object.values(cart).filter((x) => x.qty > 0), [cart]);
  const cartCount = useMemo(() => cartItems.reduce((a, x) => a + x.qty, 0), [cartItems]);

  const clearCart = () => setCart({});

  const addToCart = (t: ToolModel) => {
    setCart((prev) => {
      const cur = prev[t.tool_model_id];
      const nextQty = (cur?.qty ?? 0) + 1;
      return { ...prev, [t.tool_model_id]: { tool_model_id: t.tool_model_id, qty: nextQty, label: t.name } };
    });
  };

  const decFromCart = (tool_model_id: string) => {
    setCart((prev) => {
      const cur = prev[tool_model_id];
      if (!cur) return prev;
      const nextQty = cur.qty - 1;
      const copy = { ...prev };
      if (nextQty <= 0) delete copy[tool_model_id];
      else copy[tool_model_id] = { ...cur, qty: nextQty };
      return copy;
    });
  };

  const refreshBrowse = async () => {
    const [models, invRows] = await Promise.all([apiAdmin.listToolModels({ limit: 500 }), apiAdmin.inventory()]);
    setToolModels(models);
    const map: Record<string, InventoryRow> = {};
    for (const r of invRows) map[r.tool_model_id] = r;
    setInv(map);
  };

  const refreshLoans = async () => {
    const resp = await apiUser.loans(userId);
    setLoans(resp.loans);
  };

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        await Promise.all([refreshBrowse(), refreshLoans()]);
      } catch (e: any) {
        setErr(msg(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const checkedOutCount = loans.filter((l) => !l.returned_at).length;

  const filteredModels = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return toolModels;
    return toolModels.filter((t) => {
      const row = inv[t.tool_model_id];
      const hay = `${t.name} ${t.category ?? ""} ${t.tool_model_id} ${row?.available ?? ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [q, toolModels, inv]);

  const doReturnToolItemId = async (tool_item_id: string) => {
    try {
      setErr(null);

      const resp = await apiUser.doReturn({
        user_id: userId,
        items: [{ tool_item_id }],
      });

      // simple poll (your old logic)
      const poll = async () => {
        const st = await apiUser.returnStatus(resp.batch_id);
        const done = st.items.every((x: any) => x.hw_status === "return_ok" || x.hw_status === "failed");
        if (done) {
          await refreshLoans();
          await refreshBrowse();
        } else {
          setTimeout(poll, 800);
        }
      };

      await poll();
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  const ToolCard = ({ t }: { t: ToolModel }) => {
    const row = inv[t.tool_model_id];
    const total = row?.total ?? 0;
    const avail = row?.available ?? 0;
    const pct = total > 0 ? Math.round((avail / total) * 100) : 0;

    return (
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-rose-100 text-rose-700">⬢</div>
          <div className="flex-1">
            <div className="font-semibold text-slate-900">{t.name}</div>
            <div className="text-sm text-slate-600">{t.category ?? "—"}</div>
            <div className="text-xs text-slate-500 font-mono mt-1">{t.tool_model_id}</div>
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span>Available</span>
            <span className="font-semibold">
              {avail} of {total}
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <button
          className="mt-5 w-full rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
          disabled={avail <= 0}
          onClick={() => addToCart(t)}
        >
          Add to Cart
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-rose-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 font-bold">H</div>
            <div>
              <div className="text-sm opacity-90">Haven Kiosk</div>
              <div className="text-xs opacity-80">Welcome, {displayName}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canAdminMode ? (
              <button onClick={onAdminMode} className="rounded-xl bg-white/15 px-4 py-2 text-sm hover:bg-white/20">
                Admin Mode
              </button>
            ) : null}

            <button onClick={onLogout} className="rounded-xl bg-white/15 px-4 py-2 text-sm hover:bg-white/20">
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">Tool Management</div>
            <div className="text-sm text-slate-600">Browse, checkout, and manage your tools</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-slate-600">
              <div>Checked Out</div>
              <div className="font-semibold">{checkedOutCount}</div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full border-2 border-rose-300 bg-white font-semibold text-slate-800">
              {checkedOutCount}
            </div>
          </div>
        </div>

        {err ? <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-rose-700">{err}</div> : null}

        {/* CART BAR */}
        {cartCount > 0 ? (
          <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">Cart</div>
                <div className="text-sm text-slate-600">{cartCount} item(s)</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={clearCart}>
                  Clear
                </button>
                <button
                  className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                  onClick={() => setCartOpen(true)}
                >
                  Dispense Cart
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {cartItems.map((ci) => (
                <div key={ci.tool_model_id} className="rounded-xl border bg-slate-50 p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{ci.label}</div>
                    <div className="text-xs font-mono text-slate-500 truncate">{ci.tool_model_id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="rounded-lg border px-3 py-1 hover:bg-white" onClick={() => decFromCart(ci.tool_model_id)}>
                      –
                    </button>
                    <div className="w-10 text-center font-semibold">{ci.qty}</div>
                    <button
                      className="rounded-lg border px-3 py-1 hover:bg-white"
                      onClick={() => {
                        const t = toolModels.find((x) => x.tool_model_id === ci.tool_model_id);
                        if (t) addToCart(t);
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 border-b">
          <div className="flex gap-6">
            <TabButton active={tab === "browse"} onClick={() => setTab("browse")} label="Browse Tools" badge={null} />
            <TabButton active={tab === "mytools"} onClick={() => setTab("mytools")} label="My Tools" badge={checkedOutCount} />
            <TabButton active={tab === "return"} onClick={() => setTab("return")} label="Return Tool" badge={null} />
          </div>
        </div>

        {tab === "browse" && (
          <div className="mt-6">
            <div className="flex items-center gap-3">
              <input
                className="flex-1 rounded-xl border bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-200"
                placeholder="Search tools..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button className="rounded-xl border px-4 py-3 text-sm hover:bg-slate-50" onClick={() => refreshBrowse().catch((e) => setErr(msg(e)))}>
                Refresh
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
              {filteredModels.map((t) => (
                <ToolCard key={t.tool_model_id} t={t} />
              ))}
              {filteredModels.length === 0 && (
                <div className="rounded-2xl border bg-white p-6 text-slate-600">No tools found. Admin needs to add tool models/items.</div>
              )}
            </div>
          </div>
        )}

        {tab === "mytools" && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">Active loans from DB.</div>
              <button className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={() => refreshLoans().catch((e) => setErr(msg(e)))}>
                Refresh
              </button>
            </div>

            {loans.length === 0 ? (
              <div className="rounded-2xl border bg-white p-6 text-slate-600">No active loans.</div>
            ) : (
              loans.map((l) => (
                <div key={l.loan_id} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-rose-100 text-rose-700">⬢</div>
                      <div>
                        <div className="font-semibold text-slate-900">Tool Item</div>
                        <div className="text-sm text-slate-600 font-mono">{l.tool_item_id}</div>
                        <div className="mt-2 text-xs text-slate-500">loan_id: {l.loan_id}</div>
                        <div className="mt-3 text-sm text-slate-700">
                          <div className="text-slate-500">Issued: {l.issued_at}</div>
                          <div className="text-slate-500">Due: {l.due_at}</div>
                          <div className="text-slate-500">Status: {l.status}</div>
                        </div>
                      </div>
                    </div>
                    <div className={["rounded-full px-3 py-1 text-sm", l.status === "overdue" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"].join(" ")}>
                      {l.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "return" && (
          <div className="mt-6">
            <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-8 shadow-sm">
              <div className="text-lg font-semibold">Return a Tool</div>
              <div className="mt-1 text-sm text-slate-600">Return by selecting one of your active loans.</div>

              {loans.length === 0 ? (
                <div className="mt-5 rounded-xl border bg-slate-50 p-4 text-slate-600">No active loans to return.</div>
              ) : (
                <div className="mt-5 space-y-3">
                  {loans.map((l) => (
                    <div key={l.loan_id} className="rounded-xl border p-4 flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm">{l.tool_item_id}</div>
                        <div className="text-xs text-slate-500">loan_id: {l.loan_id.slice(0, 10)}…</div>
                      </div>
                      <button className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800" onClick={() => doReturnToolItemId(l.tool_item_id)}>
                        Return
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 text-xs text-slate-500">
                Reader: <span className="font-mono">{readerId}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BATCH DISPENSE MODAL */}
      <DispenseModal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cartItems={cartItems}
        userId={userId}
        readerId={readerId}
        onDispenseCompleted={async () => {
          await refreshLoans();
          await refreshBrowse();
          setTab("mytools");
          clearCart();
          setCartOpen(false);
        }}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge: number | null;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-2 border-b-2 px-2 py-3 text-sm font-medium ${
        active ? "border-rose-600 text-rose-700" : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
      {badge !== null && badge > 0 && (
        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span>
      )}
    </button>
  );
}
