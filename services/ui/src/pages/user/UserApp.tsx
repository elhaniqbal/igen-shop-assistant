import { useMemo, useState } from "react";
import { DispenseModal } from "./DispenseModal";
import { INITIAL_LOANS, TOOL_MODELS, type Loan, type ToolModel } from "./mockData";

type Tab = "browse" | "mytools" | "return";

export function UserApp() {
  const [tab, setTab] = useState<Tab>("browse");
  const [tools, setTools] = useState<ToolModel[]>(TOOL_MODELS);
  const [loans, setLoans] = useState<Loan[]>(INITIAL_LOANS);

  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolModel | null>(null);

  const [studentAuthed, setStudentAuthed] = useState(false);
  const [returnInput, setReturnInput] = useState("");

  const checkedOutCount = loans.filter((l) => true).length;

  const openDispense = (t: ToolModel) => {
    setSelectedTool(t);
    setDispenseOpen(true);
  };

  const onDispenseDone = (tool_item_id: string, loan_hours: number) => {
    // dummy: decrement availability, add loan
    setTools((prev) =>
      prev.map((x) => (x.tool_model_id === selectedTool?.tool_model_id ? { ...x, available: Math.max(0, x.available - 1) } : x))
    );

    const now = "2025-11-22 13:00";
    const due = `+${loan_hours}h`;
    setLoans((prev) => [
      ...prev,
      {
        loan_id: `loan_${prev.length + 1}`,
        tool_item_id,
        name: selectedTool?.name ?? "Tool",
        category: selectedTool?.category ?? "Category",
        issued_at: now,
        due_at: due,
      },
    ]);
    setTab("mytools");
  };

  const returnTool = () => {
    if (!studentAuthed) return;

    const id = returnInput.trim().toUpperCase();
    if (!id) return;

    // dummy: remove loan with matching tool_item_id
    setLoans((prev) => prev.filter((l) => l.tool_item_id.toUpperCase() !== id));
    setReturnInput("");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-rose-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 font-bold">H</div>
            <div>
              <div className="text-sm opacity-90">Haven Kiosk</div>
              <div className="text-xs opacity-80">Welcome, John Martinez</div>
            </div>
          </div>
          <button className="rounded-xl bg-white/15 px-4 py-2 text-sm hover:bg-white/20">Logout</button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">Tool Management</div>
            <div className="text-sm text-slate-600">Browse, checkout, and manage your tool inventory</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-slate-600">
              <div>Checked Out</div>
              <div className="font-semibold">{checkedOutCount} / 3</div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full border-2 border-rose-300 bg-white font-semibold text-slate-800">
              {checkedOutCount}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 border-b">
          <div className="flex gap-6">
            <TabButton active={tab === "browse"} onClick={() => setTab("browse")} label="Browse Tools" badge={null} />
            <TabButton active={tab === "mytools"} onClick={() => setTab("mytools")} label="My Tools" badge={checkedOutCount} />
            <TabButton active={tab === "return"} onClick={() => setTab("return")} label="Return Tool" badge={null} />
          </div>
        </div>

        {/* Content */}
        {tab === "browse" && (
          <div className="mt-6">
            <input
              className="w-full rounded-xl border bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-rose-200"
              placeholder="Search tools… (dummy)"
            />
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
              {tools.map((t) => (
                <div key={t.tool_model_id} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-rose-100 text-rose-700">⬢</div>
                    <div className="flex-1">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-sm text-slate-600">{t.category}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Available</span>
                      <span className="font-semibold">
                        {t.available} of {t.total}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.round((t.available / Math.max(1, t.total)) * 100)}%` }}
                      />
                    </div>
                  </div>

                  <button
                    className="mt-5 w-full rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
                    disabled={t.available <= 0}
                    onClick={() => openDispense(t)}
                  >
                    Dispense Tool
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "mytools" && (
          <div className="mt-6 space-y-6">
            {checkedOutCount > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                You have {checkedOutCount} tools checked out. Remember to return them to the kiosk when finished.
              </div>
            )}

            {loans.map((l) => (
              <div key={l.loan_id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-rose-100 text-rose-700">⬢</div>
                    <div>
                      <div className="font-semibold text-slate-900">{l.name}</div>
                      <div className="text-sm text-slate-600">{l.category}</div>
                      <div className="mt-3 text-sm text-slate-700">
                        <div>Tool ID: <span className="font-mono">{l.tool_item_id}</span></div>
                        <div className="text-slate-500">Checked out: {l.issued_at}</div>
                        <div className="text-slate-500">Expected return: {l.due_at}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">
                    4h 0m remaining
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "return" && (
          <div className="mt-6">
            <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 shadow-sm">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-100 text-rose-700 text-xl">
                ⌁
              </div>
              <div className="mt-4 text-center text-lg font-semibold">Return a Tool</div>
              <div className="mt-1 text-center text-sm text-slate-600">
                Tap your student card first, then scan/enter the Tool ID to process the return.
              </div>

              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  className="rounded-xl border px-4 py-2 hover:bg-slate-50"
                  onClick={() => setStudentAuthed(true)}
                >
                  Simulate Student Card Tap
                </button>
                <span className={`text-sm ${studentAuthed ? "text-emerald-700" : "text-slate-500"}`}>
                  {studentAuthed ? "RFID OK ✅" : "Waiting for RFID…"}
                </span>
              </div>

              <div className="mt-6 text-sm font-medium text-slate-700">Tool ID</div>
              <input
                className="mt-2 w-full rounded-xl border px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:bg-slate-50"
                value={returnInput}
                onChange={(e) => setReturnInput(e.target.value)}
                disabled={!studentAuthed}
                placeholder="TOOL-001-A"
              />

              <button
                className="mt-4 w-full rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
                disabled={!studentAuthed || !returnInput.trim()}
                onClick={returnTool}
              >
                Return Tool
              </button>

              {!studentAuthed && (
                <div className="mt-4 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Return is locked until a student card tap is received.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <DispenseModal
        open={dispenseOpen}
        tool={selectedTool}
        onClose={() => setDispenseOpen(false)}
        onDispenseDone={onDispenseDone}
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
