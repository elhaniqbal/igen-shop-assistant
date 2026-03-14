import { useMemo, useState } from "react";
import Login from "./pages/Login";
import AdminShell from "./pages/admin/AdminShell";
import { UserApp } from "./pages/user/UserApp";

export type Session = { role: "admin" | "user"; token?: string; userId?: string; name?: string };
type ViewMode = "user" | "admin";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("user");

  const onLogout = () => {
    setSession(null);
    setViewMode("user");
  };

  const view = useMemo(() => {
    if (!session) {
      return (
        <Login
          onLogin={(s) => {
            setSession(s);
            setViewMode("user");
          }}
        />
      );
    }

    const isAdmin = session.role === "admin";

    // Admin view is ONLY for admins. Non-admins trying to force it just see user mode.
    if (viewMode === "admin" && isAdmin) {
      return <AdminShell session={session} onLogout={onLogout} onUserMode={() => setViewMode("user")} />;
    }

    // User view is always available.
    return (
      <UserApp
        userId={session.userId ?? ""}
        displayName={session.name ?? "Student"}
        readerId="kiosk_1_reader_1"
        onLogout={onLogout}
        canAdminMode={isAdmin}
        onAdminMode={() => setViewMode("admin")}
      />
    );
  }, [session, viewMode]);

  return view;
}
