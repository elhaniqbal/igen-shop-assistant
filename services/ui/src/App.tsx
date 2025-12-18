import { useMemo, useState } from "react";
import Login from "./pages/Login";
import AdminShell from "./pages/admin/AdminShell";
import { UserApp } from "./pages/user/UserApp";

export type Session = { role: "admin" | "user"; token?: string; userId?: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  const onLogout = () => setSession(null);

  const view = useMemo(() => {
    if (!session) return <Login onLogin={setSession} />;
    if (session.role === "admin") return <AdminShell session={session} onLogout={onLogout} />;
      return <UserApp />;

  }, [session]);

  return view;
}
