import { useEffect, useMemo, useState } from "react";
import Login from "./pages/Login";
import AdminShell from "./pages/admin/AdminShell";
import { UserApp } from "./pages/user/UserApp";
import { HavenSplash } from "./components/HavenSplash";
import { apiUser } from "./lib/api.user";

export type Session = { role: "admin" | "user"; token?: string; userId?: string; name?: string };
type ViewMode = "user" | "admin";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("user");
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let alive = true;
    const minDelay = new Promise((r) => setTimeout(r, 2200));
    (async () => {
      try {
        const me = await apiUser.sessionMe();
        if (alive && me?.user_id) {
          setSession({ role: me.role === "admin" ? "admin" : "user", userId: me.user_id, name: `${me.first_name} ${me.last_name}` });
        }
      } catch {
        // no existing session
      } finally {
        await minDelay;
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const onLogout = async () => {
    try { await apiUser.logout(); } catch {}
    setSession(null);
    setViewMode("user");
  };

  const view = useMemo(() => {
    if (!session) {
      return <Login onLogin={(s) => { setSession(s); setViewMode("user"); }} />;
    }
    const isAdmin = session.role === "admin";
    if (viewMode === "admin" && isAdmin) {
      return <AdminShell session={session} onLogout={onLogout} onUserMode={() => setViewMode("user")} />;
    }
    return <UserApp userId={session.userId ?? ""} displayName={session.name ?? "Student"} readerId="haven_1_reader_1" onLogout={onLogout} canAdminMode={isAdmin} onAdminMode={() => setViewMode("admin")} />;
  }, [session, viewMode]);

  return (
    <>
      {booting ? <HavenSplash /> : null}
      {view}
    </>
  );
}
