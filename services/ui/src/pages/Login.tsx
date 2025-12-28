import { useState } from "react";
import { apiUser, type CardAuthResp, type RfidScan } from "../lib/api.user";
import { RfidScanPanel } from "../components/RfidScanPanel";
import TapCardAnimation from "../components/TapCardAnimation";
import type { Session } from "../App";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [user, setUser] = useState<CardAuthResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const loginWithCardId = async (cardIdRaw: string) => {
    const card_id = cardIdRaw.trim();
    if (!card_id) {
      setErr("Enter a card ID.");
      return;
    }
    try {
      setErr(null);
      const u = await apiUser.authCard({ card_id });
      setUser(u);
      onLogin({
        role: u.role === "admin" ? "admin" : "user",
        userId: u.user_id,
        name: `${u.first_name} ${u.last_name}`,
      });
    } catch (e: any) {
      setUser(null);
      setErr(msg(e));
    }
  };

  const onCardScan = async (scan: RfidScan) => {
    const cardId = scan.tag_id ?? scan.uid;
    if (!cardId) {
      setErr("Scan missing tag_id/uid");
      return;
    }
    await loginWithCardId(cardId);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-rose-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 font-bold">H</div>
            <div>
              <div className="text-sm opacity-90">Haven Kiosk</div>
              <div className="text-xs opacity-80">Tap card or enter ID</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="text-2xl font-semibold text-slate-900">Login</div>
        <div className="mt-1 text-sm text-slate-600">Student card login (no password).</div>

        {err ? <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-rose-700">{err}</div> : null}

        {user ? (
          <div className="mt-4 rounded-xl border bg-emerald-50 p-3 text-emerald-800">
            Logged in: {user.first_name} {user.last_name} ({user.role})
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Tap Card</div>
                <div className="text-sm text-slate-600 mt-1">Use RFID reader</div>
              </div>
              <div className="opacity-90 -translate-y-2 scale-120">
                <TapCardAnimation />
              </div>
            </div>

            <div className="mt-4">
              <RfidScanPanel
                kind="card"
                title="Tap student card"
                subtitle="Waiting for scan…"
                onScan={onCardScan}
              />
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="font-semibold">Manual Entry</div>
            <div className="text-sm text-slate-600 mt-1">Dev/testing fallback</div>

            <div className="mt-4 text-sm font-medium text-slate-700">Card ID</div>
            <input
              className="mt-2 w-full rounded-xl border px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-rose-200"
              placeholder="Paste card_id/uid"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />

            <button
              className="mt-4 w-full rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800"
              onClick={() => loginWithCardId(manual)}
            >
              Login
            </button>
          </div>
        </div>

        <div className="mt-6 text-xs text-slate-500">
          If tapping doesn’t work, your RFID sidecar isn’t publishing card scans to MQTT topic{" "}
          <span className="font-mono">igen/evt/rfid/card_scan</span>.
        </div>
      </div>
    </div>
  );
}
