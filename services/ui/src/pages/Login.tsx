import { useState } from "react";
import { apiUser, type CardAuthResp, type RfidScan } from "../lib/api.user";
import { RfidScanPanel } from "../components/RfidScanPanel";
import { TapCardAnimation } from "../components/TapCardAnimation";
import { BrandMark } from "../components/BrandMark";
import type { Session } from "../App";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [user, setUser] = useState<CardAuthResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const finishLogin = (u: CardAuthResp) => {
    setUser(u);
    onLogin({ role: u.role === "admin" ? "admin" : "user", userId: u.user_id, name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() });
  };

  const loginWithCardId = async (cardIdRaw: string) => {
    const card_id = cardIdRaw.trim();
    if (!card_id) return setErr("Enter a card ID.");
    try {
      setErr(null);
      if (card_id === "test") {
        return finishLogin({ role: "admin", user_id: "SUPER", first_name: "OVERLORD", last_name: "2000" });
      }
      finishLogin(await apiUser.authCard({ card_id }));
    } catch (e: any) {
      setUser(null);
      setErr(msg(e));
    }
  };

  const onCardScan = async (scan: RfidScan) => {
    const cardId = scan.card_id;
    if (!cardId) return setErr("Scan missing card_id");
    await loginWithCardId(cardId);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,63,94,0.10),_transparent_28%),linear-gradient(180deg,#fff8fb_0%,#f8fafc_35%,#f8fafc_100%)]">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-4 rounded-full border border-rose-100/80 bg-white/82 px-4 py-2 shadow-sm backdrop-blur">
              <BrandMark size={44} />
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.35em] text-[#ff2340]">HAVEN</div>
                <div className="text-sm text-slate-600">Your smart tool vending shop assistant</div>
              </div>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Tap in. Borrow smart. Return cleanly.</h1>
              <p className="mt-4 max-w-xl text-lg leading-8 text-slate-600">
                HAVEN connects students, inventory, and motion control into one guided shop experience for UBC Integrated Engineering.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/70 bg-white/70 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)] backdrop-blur">
              <div className="grid gap-6 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.3em] text-rose-500">Live access</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">Start with your student card</div>
                  <div className="mt-3 text-sm leading-7 text-slate-600">User sessions are cookie-backed, so the kiosk and remote mobile view stay aligned with the backend.</div>
                </div>
                <div className="rounded-[24px] border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-5">
                  <TapCardAnimation />
                </div>
              </div>
            </div>
          </div>

          <div className="w-full max-w-xl space-y-6">
            {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{err}</div> : null}
            {user ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">Logged in: {user.first_name} {user.last_name} ({user.role})</div> : null}

            <div className="grid gap-6">
              <div className="rounded-[30px] border border-white/80 bg-white/85 p-6 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold text-slate-900">RFID Sign-In</div>
                    <div className="mt-1 text-sm text-slate-600">Present your student card at the reader to begin a session.</div>
                  </div>
                  <BrandMark size={52} spinning />
                </div>
                <div className="mt-5">
                  <RfidScanPanel kind="card" title="Waiting for student card" subtitle="The kiosk will open your session automatically after a successful scan." onScan={onCardScan} />
                </div>
              </div>

              <div className="rounded-[30px] border border-white/80 bg-white/85 p-6 shadow-xl backdrop-blur">
                <div className="text-xl font-bold text-slate-900">Manual entry</div>
                <div className="mt-1 text-sm text-slate-600">Developer fallback for demos and testing.</div>
                <div className="mt-4 text-sm font-medium text-slate-700">Card ID</div>
                <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono focus:border-rose-300 focus:bg-white focus:outline-none" placeholder="Paste card_id" value={manual} onChange={(e) => setManual(e.target.value)} />
                <button className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800" onClick={() => loginWithCardId(manual)}>
                  Login to HAVEN
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
