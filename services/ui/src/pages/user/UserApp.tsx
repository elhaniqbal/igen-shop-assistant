import { useEffect, useMemo, useState } from "react";
import { DispenseModal } from "./DispenseModal";
import { ReturnModal } from "./ReturnModal";
import { BrandMark } from "../../components/BrandMark";
import type { InventoryRow, ToolModel } from "../../lib/api.admin";
import { apiUser, type CatalogRow, type LoanRow } from "../../lib/api.user";
import { CONFIG } from "../../lib/config";

function msg(e: any) {
  if (e && typeof e === "object") {
    if ("message" in e) return String((e as any).message);
    if ("detail" in e) return typeof (e as any).detail === "string" ? (e as any).detail : JSON.stringify((e as any).detail);
  }
  return "request failed";
}

type Tab = "browse" | "mytools" | "return";
type CartEntry = { tool_model_id: string; qty: number; label: string };

function fmtDT(s: string) {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : s;
}

const SESSION_CHECKED_OUT_KEY = "haven_session_checked_out_count";

function readSessionCheckedOutCount() {
  if (typeof window === "undefined") return 0;
  const raw = window.sessionStorage.getItem(SESSION_CHECKED_OUT_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeSessionCheckedOutCount(value: number) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SESSION_CHECKED_OUT_KEY, String(Math.max(0, value)));
}

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
  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQueue, setReturnQueue] = useState<LoanRow[]>([]);
  const [sessionCheckedOutCount, setSessionCheckedOutCount] = useState(0);

  const cartItems = useMemo(() => Object.values(cart).filter((x) => x.qty > 0), [cart]);
  const cartCount = useMemo(() => cartItems.reduce((a, x) => a + x.qty, 0), [cartItems]);
  const clearCart = () => setCart({});

  const refreshBrowse = async () => {
    const rows = await apiUser.catalog({ limit: 1000 });

    const models: ToolModel[] = rows.map((r: CatalogRow) => ({
      tool_model_id: r.tool_model_id,
      name: r.name,
      description: r.description ?? "",
      category: r.category ?? null,
    }));

    const invRows: Record<string, InventoryRow> = {};
    for (const r of rows) {
      invRows[r.tool_model_id] = {
        tool_model_id: r.tool_model_id,
        name: r.name,
        total: r.total,
        available: r.available,
        checked_out: r.checked_out,
      };
    }

    setToolModels(models);
    setInv(invRows);
  };

  const refreshLoans = async () => {
    const resp = await apiUser.loans();
    setLoans(resp.loans);
  };

  useEffect(() => {
    setSessionCheckedOutCount(readSessionCheckedOutCount());
    (async () => {
      try {
        setErr(null);
        await Promise.all([refreshBrowse(), refreshLoans()]);
      } catch (e: any) {
        setErr(msg(e));
      }
    })();
  }, []);

  useEffect(() => {
    writeSessionCheckedOutCount(sessionCheckedOutCount);
  }, [sessionCheckedOutCount]);

  const filteredModels = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return toolModels;
    return toolModels.filter((t) =>
      `${t.name} ${t.category ?? ""} ${inv[t.tool_model_id]?.available ?? ""}`.toLowerCase().includes(s)
    );
  }, [q, toolModels, inv]);

  const addToCart = (t: ToolModel) =>
    setCart((prev) => ({
      ...prev,
      [t.tool_model_id]: {
        tool_model_id: t.tool_model_id,
        qty: (prev[t.tool_model_id]?.qty ?? 0) + 1,
        label: t.name,
      },
    }));

  const decFromCart = (tool_model_id: string) =>
    setCart((prev) => {
      const cur = prev[tool_model_id];
      if (!cur) return prev;
      const nextQty = cur.qty - 1;
      const copy = { ...prev };
      if (nextQty <= 0) delete copy[tool_model_id];
      else copy[tool_model_id] = { ...cur, qty: nextQty };
      return copy;
    });

  const openReturnForLoan = (l: LoanRow) => {
    const sameModelLoans = loans
      .filter((x) => x.tool_model_id === l.tool_model_id)
      .sort((a, b) => new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime());
    setReturnQueue(sameModelLoans.length ? sameModelLoans : [l]);
    setReturnOpen(true);
  };

  const closeReturn = () => {
    setReturnOpen(false);
    setReturnQueue([]);
  };

  const ToolCard = ({ t }: { t: ToolModel }) => {
    const row = inv[t.tool_model_id];
    const total = row?.total ?? 0;
    const avail = row?.available ?? 0;
    const pct = total > 0 ? Math.round((avail / total) * 100) : 0;

    return (
      <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_16px_55px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700">⬢</div>
          <div className="flex-1">
            <div className="font-semibold text-slate-900">{t.name}</div>
            <div className="text-sm text-slate-600">{t.category ?? "—"}</div>
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
          className="mt-5 w-full rounded-2xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
          disabled={avail <= 0}
          onClick={() => addToCart(t)}
        >
          Add to Cart
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.10),_transparent_25%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_40%,#f8fafc_100%)]">
      <div className="border-b border-white/70 bg-white/82 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark size={52} spinning />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff2340]">HAVEN</div>
              <div className="text-sm text-slate-600">Welcome, {displayName}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canAdminMode ? (
              <button
                onClick={onAdminMode}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Admin Mode
              </button>
            ) : null}
            <button
              onClick={onLogout}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-3xl font-black text-slate-950">Student tool access</div>
            <div className="mt-2 text-slate-600">
              Browse inventory, dispense tools, and return checked-out items through one guided flow.
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
            <div className="text-right text-xs text-slate-500">
              <div>Checked Out</div>
              <div className="text-lg font-bold text-slate-900">{sessionCheckedOutCount}</div>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 font-bold text-white">
              {sessionCheckedOutCount}
            </div>
          </div>
        </div>

        {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div> : null}

        {cartCount > 0 ? (
          <div className="mt-4 rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-slate-900">Cart</div>
                <div className="text-sm text-slate-600">{cartCount} item(s)</div>
              </div>

              <div className="flex gap-2">
                <button className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50" onClick={clearCart}>
                  Clear
                </button>
                <button
                  className="rounded-2xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                  onClick={() => setCartOpen(true)}
                >
                  Dispense Cart
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {cartItems.map((ci) => (
                <div key={ci.tool_model_id} className="flex items-center justify-between rounded-2xl border bg-slate-50 p-3">
                  <div>
                    <div className="font-semibold text-slate-900">{ci.label}</div>
                    <div className="text-xs text-slate-500">Qty: {ci.qty}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="rounded-xl border px-3 py-1" onClick={() => decFromCart(ci.tool_model_id)}>
                      –
                    </button>
                    <div className="w-8 text-center font-semibold">{ci.qty}</div>
                    <button
                      className="rounded-xl border px-3 py-1"
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

        <div className="mt-6 flex gap-6 border-b border-slate-200">
          {([
            ["browse", "Browse Tools", null],
            ["mytools", "My Tools", sessionCheckedOutCount > 0 ? sessionCheckedOutCount : null],
            ["return", "Return Tools", null],
          ] as const).map(([id, label, badge]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative -mb-px flex items-center gap-2 border-b-2 px-2 py-3 text-sm font-medium ${
                tab === id ? "border-rose-600 text-rose-700" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
              {badge ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span> : null}
            </button>
          ))}
        </div>

        {tab === "browse" ? (
          <div className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div>
                <div className="flex items-center gap-3">
                  <input
                    className="flex-1 rounded-2xl border bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-200"
                    placeholder="Search tools..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <button
                    className="rounded-2xl border px-4 py-3 text-sm hover:bg-slate-50"
                    onClick={() => refreshBrowse().catch((e) => setErr(msg(e)))}
                  >
                    Refresh
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {filteredModels.map((t) => (
                    <ToolCard key={t.tool_model_id} t={t} />
                  ))}
                  {filteredModels.length === 0 ? <div className="rounded-2xl border bg-white p-6 text-slate-600">No tools found.</div> : null}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm">
                <div className="text-lg font-bold text-slate-900">Need another tool?</div>
                <div className="mt-2 text-sm leading-7 text-slate-600">
                  Don’t see what you want? Scan this QR code to request stock or suggest additions.
                </div>
                <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-4">
                  <img src="/stock_request_qr.png" alt="Stock request QR" className="mx-auto h-56 w-56 rounded-2xl bg-white p-2" />
                  <a
                    href={CONFIG.stockRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 block text-center text-sm font-semibold text-rose-700 underline underline-offset-4"
                  >
                    Open stock request site
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "mytools" ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">Your active loans.</div>
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => refreshLoans().catch((e) => setErr(msg(e)))}
              >
                Refresh
              </button>
            </div>

            {loans.length === 0 ? (
              <div className="rounded-[28px] border bg-white p-6 text-slate-600">No active loans.</div>
            ) : (
              loans.map((l) => (
                <div key={l.loan_id} className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-100 text-rose-700">⬢</div>
                      <div>
                        <div className="font-semibold text-slate-900">{l.tool_name}</div>
                        <div className="text-sm text-slate-600">{l.tool_category ?? "—"}</div>
                        <div className="mt-3 text-sm text-slate-500">
                          Issued: {fmtDT(l.issued_at)}
                          <br />
                          Due: {fmtDT(l.due_at)}
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-sm ${l.status === "overdue" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>
                      {l.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "return" ? (
          <div className="mt-6">
            <div className="mx-auto max-w-3xl rounded-[30px] border border-white/80 bg-white/90 p-8 shadow-sm">
              <div className="text-xl font-bold text-slate-900">Return tools</div>
              <div className="mt-2 text-sm text-slate-600">
                Select a checked-out item to start. If you have multiple identical tools checked out, the scanner will let you return them in either order.
              </div>

              {loans.length === 0 ? (
                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-slate-600">No active loans to return.</div>
              ) : (
                <div className="mt-5 space-y-3">
                  {loans.map((l) => (
                    <div key={l.loan_id} className="flex items-center justify-between rounded-2xl border p-4">
                      <div>
                        <div className="font-semibold">{l.tool_name}</div>
                        <div className="text-xs text-slate-500">{l.tool_category ?? "—"}</div>
                        <div className="mt-1 text-xs text-slate-500">Due: {fmtDT(l.due_at)}</div>
                      </div>
                      <button
                        className="rounded-2xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                        onClick={() => openReturnForLoan(l)}
                      >
                        Return
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <DispenseModal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cartItems={cartItems}
        userId={userId}
        readerId={readerId}
        onDispenseCompleted={async () => {
          const dispensedCount = cartItems.reduce((a, x) => a + x.qty, 0);
          setSessionCheckedOutCount((n) => n + dispensedCount);
          await refreshLoans();
          await refreshBrowse();
          setTab("mytools");
          clearCart();
          setCartOpen(false);
        }}
      />

      <ReturnModal
        open={returnOpen}
        onClose={closeReturn}
        userId={userId}
        readerId={readerId}
        queue={returnQueue.map((loan) => ({
          loan_id: loan.loan_id,
          tool_item_id: loan.tool_item_id,
          tool_name: loan.tool_name,
          tool_category: loan.tool_category ?? undefined,
          due_at: loan.due_at,
          expected_tool_tag: loan.tool_tag_id,
        }))}
        onAllDone={async () => {
          setSessionCheckedOutCount((n) => Math.max(0, n - returnQueue.length));
          await refreshLoans();
          await refreshBrowse();
          closeReturn();
        }}
      />
    </div>
  );
}
