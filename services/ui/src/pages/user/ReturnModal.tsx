import { useEffect, useMemo, useRef, useState } from "react";
import { HardwareSpinner } from "../../components/RotarySpinner";
import { apiUser } from "../../lib/api.user";
import type { ToolItem, ToolModel } from "../../lib/api.admin";

type ReturnQueueItem = {
  loan_id: string;
  tool_item_id: string;
  tool_name: string;
  tool_category?: string;
  due_at: string;
};

type Phase = "idle" | "verify_scan" | "returning" | "done" | "failed";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function ReturnModal({
  open,
  onClose,
  userId,
  readerId,
  queue,
  toolItemsById,
  onAllDone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  readerId: string;

  // items the user selected to return (names only, no IDs shown in UI except internal)
  queue: ReturnQueueItem[];

  // used to get expected tool_tag_id (DB truth)
  toolItemsById: Record<string, ToolItem>;

  onAllDone: () => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [idx, setIdx] = useState(0);

  const [scanInput, setScanInput] = useState("");
  const [scanAttempts, setScanAttempts] = useState(0);

  const [adminManual, setAdminManual] = useState("");
  const [showAdminBox, setShowAdminBox] = useState(false);

  const [err, setErr] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  const current = useMemo(() => queue[idx] ?? null, [queue, idx]);

  const expectedTag = useMemo(() => {
    if (!current) return null;
    const it = toolItemsById[current.tool_item_id];
    return it?.tool_tag_id ?? null;
  }, [current, toolItemsById]);

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    if (!open) return;

    setPhase(queue.length ? "verify_scan" : "idle");
    setIdx(0);
    setScanInput("");
    setScanAttempts(0);
    setAdminManual("");
    setShowAdminBox(false);
    setErr(null);

    return () => stopPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!queue.length) return;

    setPhase("verify_scan");
    setScanInput("");
    setScanAttempts(0);
    setAdminManual("");
    setShowAdminBox(false);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const waitForToolScan = async () => {
    try {
      setErr(null);

      await apiUser.rfidSetMode({ reader_id: readerId, mode: "tool" });

      for (let i = 0; i < 30; i++) {
        const r = await apiUser.rfidConsume(readerId, "tool");
        if (r.ok && r.scan) {
          const tag = r.scan.tag_id ?? r.scan.uid;
          if (tag) {
            setScanInput(tag);
            return;
          }
        }
        await sleep(250);
      }

      setErr("No scan received. Tap the tool tag again.");
    } catch (e: any) {
      setErr(msg(e));
    }
  };

  const verifyTagOrCountFail = async (entered: string) => {
    const tag = entered.trim();
    if (!tag) {
      setErr("Tap the tool tag (or enter it).");
      return false;
    }

    if (!expectedTag) {
      // This is a data/setup problem: admin didn’t assign tool_tag_id for this tool_item.
      setErr("This tool is missing a tag in the system. Contact an admin.");
      setShowAdminBox(true);
      return false;
    }

    if (tag !== expectedTag) {
      const next = scanAttempts + 1;
      setScanAttempts(next);
      setErr("Wrong tool scanned. Tap the correct tool.");

      if (next >= 5) {
        setErr("Scan failed 5 times. Contact an admin to manually enter the tool tag.");
        setShowAdminBox(true);
      }

      return false;
    }

    // correct tag
    setErr(null);
    return true;
  };

  const doReturnCurrent = async () => {
    if (!current) return;

    setPhase("returning");
    setErr(null);
    stopPoll();

    try {
      const resp = await apiUser.doReturn({
        user_id: userId,
        items: [{ tool_item_id: current.tool_item_id }],
      });

      const poll = async () => {
        const st = await apiUser.returnStatus(resp.batch_id);
        const done = st.items.every((x: any) => x.hw_status === "return_ok" || x.hw_status === "failed");

        if (!done) return;

        stopPoll();

        const ok = st.items.some((x: any) => x.hw_status === "return_ok");
        if (!ok) {
          setErr("Return failed. Contact an admin.");
          setPhase("failed");
          setShowAdminBox(true);
          return;
        }

        // next item
        if (idx + 1 >= queue.length) {
          setPhase("done");
          await onAllDone();
          return;
        }

        setIdx((i) => i + 1);
      };

      await poll();
      pollRef.current = window.setInterval(() => poll().catch((e) => setErr(msg(e))), 800);
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
      setShowAdminBox(true);
    }
  };

  const submitScan = async () => {
    if (!current) return;

    const ok = await verifyTagOrCountFail(scanInput);
    if (!ok) return;

    // tag verified
    await doReturnCurrent();
  };

  const submitAdminManual = async () => {
    if (!current) return;

    const ok = await verifyTagOrCountFail(adminManual);
    if (!ok) return;

    await doReturnCurrent();
  };

  const close = () => {
    stopPoll();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="text-lg font-semibold">Return Tools</div>
          <button className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100" onClick={close}>
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          {!queue.length ? (
            <div className="rounded-xl border bg-slate-50 p-4 text-slate-700">No tools selected.</div>
          ) : (
            <>
              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-slate-600">Returning</div>
                    <div className="text-base font-semibold text-slate-900">
                      {current?.tool_name ?? "Tool"}
                      {current?.tool_category ? <span className="text-slate-600 font-medium"> — {current.tool_category}</span> : null}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Due: {current?.due_at ?? "—"}</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {idx + 1} / {queue.length}
                  </div>
                </div>
              </div>

              {err ? <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-rose-700 text-sm">{err}</div> : null}

              {phase === "verify_scan" ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Tap the tool tag to verify you’re returning the correct tool.
                  </div>

                  <div className="text-sm font-medium text-slate-700">Tool Scan</div>
                  <input
                    className="w-full rounded-xl border px-4 py-3 font-mono"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="Tap tool tag (or type)"
                  />

                  <div className="flex items-center gap-3">
                    <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={waitForToolScan}>
                      Wait for scan
                    </button>

                    <button
                      className="ml-auto rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800"
                      onClick={submitScan}
                    >
                      Verify & Return
                    </button>
                  </div>

                  <div className="text-xs text-slate-500">
                    Attempts: <span className="font-mono">{scanAttempts}</span> / 5 — Reader:{" "}
                    <span className="font-mono">{readerId}</span>
                  </div>

                  {!showAdminBox ? (
                    <button
                      className="text-sm text-slate-600 underline underline-offset-4 hover:text-slate-900"
                      onClick={() => setShowAdminBox(true)}
                    >
                      Contact admin / manual entry
                    </button>
                  ) : null}

                  {showAdminBox ? (
                    <div className="mt-3 rounded-2xl border p-4">
                      <div className="text-sm font-semibold text-slate-900">Admin manual entry</div>
                      <div className="text-xs text-slate-600 mt-1">
                        If RFID scan is failing, an admin can type the tool tag. It must match what’s in the system.
                      </div>

                      <div className="mt-3">
                        <input
                          className="w-full rounded-xl border px-4 py-3 font-mono"
                          value={adminManual}
                          onChange={(e) => setAdminManual(e.target.value)}
                          placeholder="Admin: enter tool tag"
                        />
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                          onClick={submitAdminManual}
                        >
                          Admin Confirm & Return
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {phase === "returning" ? (
                <div className="mt-5">
                  <HardwareSpinner label="Returning..." />
                  <div className="mt-3 text-sm text-slate-600">
                    Please place the tool in the return slot and follow the kiosk instructions.
                  </div>
                </div>
              ) : null}

              {phase === "failed" ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl border bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Return failed. Contact an admin.
                  </div>
                  <div className="flex justify-end gap-3">
                    <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={close}>
                      Close
                    </button>
                    <button
                      className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800"
                      onClick={() => {
                        // allow retry of scan/verify (not bypass)
                        setPhase("verify_scan");
                        setErr(null);
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}

              {phase === "done" ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Return complete ✅
                  </div>
                  <div className="flex justify-end">
                    <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={close}>
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
