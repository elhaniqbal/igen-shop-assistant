import { useEffect, useMemo, useState } from "react";
import { apiAdmin, type User } from "../../../lib/api.admin";
import { apiUser } from "../../../lib/api.user";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

export default function Users() {
  const [rows, setRows] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [showOnlyBad, setShowOnlyBad] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [modal, setModal] = useState<null | { kind: "create" } | { kind: "edit"; user: User } | { kind: "card"; user: User }>(null);

  const load = async () => {
    try {
      setErr(null);
      setRows(await apiAdmin.listUsers({ limit: 500 }));
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const base = rows.filter((r) => {
      const hay = `${r.first_name} ${r.last_name} ${r.user_id} ${r.student_number ?? ""} ${r.card_id ?? ""} ${r.role} ${r.status}`.toLowerCase();
      return hay.includes(ql);
    });
    return showOnlyBad ? base.filter((r) => r.status !== "active" && r.status !== "good") : base;
  }, [rows, q, showOnlyBad]);

  const flaggedCount = rows.filter((r) => r.status !== "active" && r.status !== "good").length;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">User Management</div>
          <div className="text-sm text-slate-600 mt-1">Create users, edit status, assign cards</div>
        </div>
        <button
          className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-sm font-semibold"
          onClick={() => setModal({ kind: "create" })}
        >
          + Add User
        </button>
      </div>

      {err ? <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-rose-700">{err}</div> : null}

      <div className="mt-4 flex gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2"
          placeholder="Search name, student #, card_id, role, status..."
        />
        <button
          onClick={() => setShowOnlyBad((s) => !s)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
        >
          {showOnlyBad ? "Show All" : "Show Flagged"}
        </button>
        <button
          onClick={load}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Total Users" value={rows.length} />
        <Stat title="Students" value={rows.filter((r) => r.role === "student").length} />
        <Stat title="Flagged Status" value={flaggedCount} tint="rose" />
      </div>

      <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Student #</th>
              <th className="text-left p-4">Card ID</th>
              <th className="text-left p-4">Role</th>
              <th className="text-left p-4">Status</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.user_id} className="border-t border-slate-100">
                <td className="p-4">
                  <div className="font-medium">{r.first_name} {r.last_name}</div>
                  <div className="text-xs text-slate-500 font-mono">user_id: {r.user_id}</div>
                </td>
                <td className="p-4">{r.student_number ?? "—"}</td>
                <td className="p-4 font-mono">{r.card_id ?? "—"}</td>
                <td className="p-4">
                  <span className="rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-xs font-semibold">{r.role}</span>
                </td>
                <td className="p-4">
                  <span
                    className={[
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      (r.status === "active" || r.status === "good") ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
                    ].join(" ")}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="p-4 text-right space-x-2">
                  <button className="rounded-lg border px-3 py-1 hover:bg-slate-50" onClick={() => setModal({ kind: "card", user: r })}>
                    Assign Card
                  </button>
                  <button className="rounded-lg border px-3 py-1 hover:bg-slate-50" onClick={() => setModal({ kind: "edit", user: r })}>
                    Edit
                  </button>
                  <button
                    className="rounded-lg border px-3 py-1 hover:bg-rose-50 text-rose-700"
                    onClick={async () => {
                      if (!confirm("Delete user?")) return;
                      await apiAdmin.deleteUser(r.user_id);
                      await load();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-slate-500">No users.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal?.kind === "create" ? (
        <UserModal
          title="Create User"
          initial={{ first_name: "", last_name: "", student_number: "", role: "student", status: "active" }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            await apiAdmin.createUser({
              first_name: v.first_name,
              last_name: v.last_name,
              student_number: v.student_number || null,
              role: v.role,
              status: v.status,
              card_id: null,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "edit" ? (
        <UserModal
          title="Edit User"
          initial={{
            first_name: modal.user.first_name,
            last_name: modal.user.last_name,
            student_number: modal.user.student_number ?? "",
            role: modal.user.role,
            status: modal.user.status,
          }}
          onClose={() => setModal(null)}
          onSave={async (v) => {
            await apiAdmin.patchUser(modal.user.user_id, {
              first_name: v.first_name,
              last_name: v.last_name,
              student_number: v.student_number || null,
              role: v.role,
              status: v.status,
            });
            setModal(null);
            await load();
          }}
        />
      ) : null}

      {modal?.kind === "card" ? (
        <AssignCardModal
          open={true}
          user={modal.user}
          readerId="kiosk_1_reader_1"
          onClose={() => setModal(null)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}

function Stat({ title, value, tint }: { title: string; value: number; tint?: "rose" }) {
  const cls = tint === "rose" ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200";
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${cls}`}>
      <div className="text-slate-600 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}

function UserModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: { first_name: string; last_name: string; student_number: string; role: string; status: string };
  onClose: () => void;
  onSave: (v: typeof initial) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>

        <div className="px-6 py-5 space-y-3">
          {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="First name">
              <input className="w-full rounded-xl border px-3 py-2" value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} />
            </Field>
            <Field label="Last name">
              <input className="w-full rounded-xl border px-3 py-2" value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} />
            </Field>
          </div>

          <Field label="Student #">
            <input className="w-full rounded-xl border px-3 py-2 font-mono" value={v.student_number} onChange={(e) => setV({ ...v, student_number: e.target.value })} />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Role">
              <select className="w-full rounded-xl border px-3 py-2" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
                {["student", "admin", "staff"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="w-full rounded-xl border px-3 py-2" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
                {["active", "good", "delinquent", "disabled"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={onClose}>Cancel</button>
            <button
              disabled={busy}
              className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
              onClick={async () => {
                try {
                  setBusy(true);
                  setErr(null);
                  await onSave(v);
                } catch (e: any) {
                  setErr(msg(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function AssignCardModal({
  open,
  user,
  readerId,
  onClose,
  onDone,
}: {
  open: boolean;
  user: User;
  readerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCard("");
    setErr(null);
    setBusy(false);
  }, [open]);

  const waitForTap = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiUser.rfidSetMode({ reader_id: readerId, mode: "card" });
      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "card");
        if (r.ok && r.scan) {
          const id = r.scan.tag_id ?? r.scan.uid;
          if (id) { setCard(id); return; }
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      setErr("No tap received. Tap again or paste ID.");
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    const card_id = card.trim();
    if (!card_id) { setErr("Card ID is empty."); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiAdmin.assignUserCard(user.user_id, card_id);
      onDone();
      onClose();
    } catch (e: any) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">Assign Card</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="rounded-xl border bg-slate-50 p-4">
            <div className="font-semibold">{user.first_name} {user.last_name}</div>
            <div className="text-xs text-slate-500 font-mono">user_id: {user.user_id}</div>
            <div className="text-xs text-slate-500">current: <span className="font-mono">{user.card_id ?? "—"}</span></div>
          </div>

          {err ? <div className="rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

          <div className="text-sm font-medium text-slate-700">Card ID</div>
          <input className="w-full rounded-xl border px-4 py-3 font-mono" value={card} onChange={(e) => setCard(e.target.value)} placeholder="Tap or paste UID" />

          <div className="flex items-center gap-3">
            <button disabled={busy} className="rounded-xl border px-4 py-2 hover:bg-slate-50 disabled:opacity-40" onClick={waitForTap}>
              Wait for tap
            </button>
            <button disabled={busy} className="ml-auto rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800 disabled:opacity-40" onClick={assign}>
              Assign
            </button>
          </div>

          <div className="text-xs text-slate-500">Reader: <span className="font-mono">{readerId}</span></div>
        </div>
      </div>
    </div>
  );
}
