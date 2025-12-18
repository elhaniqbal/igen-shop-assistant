import { useState } from "react";
import { login } from "../lib/api";
import type { Session } from "../App";

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [userId, setUserId] = useState("ADMIN-001");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr(null);
    setLoading(true);
    try {
      const r = await login(userId.trim(), password);
      onLogin({ role: r.role, token: r.token });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-700 to-rose-800 flex flex-col items-center justify-center p-6">
      <div className="flex flex-col items-center mb-6">
        <div className="h-14 w-14 rounded-2xl bg-rose-400/40 border border-white/20 grid place-items-center text-white text-2xl font-semibold shadow-sm">
          H
        </div>
        <div className="mt-3 text-white text-lg font-semibold">Haven Kiosk</div>
        <div className="text-white/80 text-sm">Machine Shop Tool Tracking System</div>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-white/30 overflow-hidden">
        <div className="p-8">
          <div className="text-center text-rose-700 font-semibold mb-6">Sign In</div>

          <label className="block text-sm font-medium text-slate-700">User ID / Badge Number</label>
          <div className="mt-2">
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-xl border border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-400 px-4 py-3"
              placeholder="ADMIN-001"
            />
          </div>

          <label className="block text-sm font-medium text-slate-700 mt-5">Password</label>
          <div className="mt-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-400 px-4 py-3"
              placeholder="••••••••"
            />
          </div>

          {err && <div className="mt-4 text-sm text-rose-700">{err}</div>}

          <button
            disabled={loading}
            onClick={submit}
            className="mt-6 w-full rounded-xl bg-rose-600 hover:bg-rose-700 text-white py-3 font-semibold shadow-sm disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="mt-6 text-center text-slate-500 text-sm">Demo Credentials:</div>
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
              <div><span className="text-slate-500">User:</span> <span className="text-rose-700 font-semibold">EMP-1001</span></div>
              <div><span className="text-slate-500">Pass:</span> <span className="text-slate-800">user123</span></div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
              <div><span className="text-slate-500">Admin:</span> <span className="text-rose-700 font-semibold">ADMIN-001</span></div>
              <div><span className="text-slate-500">Pass:</span> <span className="text-slate-800">admin123</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
