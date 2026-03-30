import { useEffect, useMemo, useRef, useState } from "react";
import { HardwareSpinner } from "../../components/RotarySpinner";
import { apiUser } from "../../lib/api.user";

type ReturnQueueItem = {
  loan_id: string;
  tool_item_id: string;
  tool_name: string;
  tool_category?: string;
  due_at: string;
  expected_tool_tag?: string | null;
};

type Phase = "idle" | "verify_scan" | "confirm_insert" | "returning" | "done" | "failed";

function msg(e: any) {
  return e && typeof e === "object" && "message" in e ? String((e as any).message) : "request failed";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function ReturnModal({
  open,
  onClose,
  readerId,
  queue,
  onAllDone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  readerId: string;
  queue: ReturnQueueItem[];
  onAllDone: () => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanInput, setScanInput] = useState("");
  const [scanAttempts, setScanAttempts] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [activeLoanId, setActiveLoanId] = useState<string | null>(null);
  const [completedLoanIds, setCompletedLoanIds] = useState<string[]>([]);

  const pollRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  const remainingQueue = useMemo(
    () => queue.filter((item) => !completedLoanIds.includes(item.loan_id)),
    [queue, completedLoanIds]
  );

  const current = useMemo(() => {
    if (activeLoanId) return queue.find((item) => item.loan_id === activeLoanId) ?? null;
    return remainingQueue[0] ?? null;
  }, [queue, remainingQueue, activeLoanId]);

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const stopConfirmTimer = () => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
  };

  const startPoll = (currentBatchId: string, loanId: string) => {
    stopPoll();
    pollRef.current = window.setInterval(() => {
      poll(currentBatchId, loanId).catch((e) => setErr(msg(e)));
    }, 800);
  };

  useEffect(() => {
    if (!open) return;

    setPhase(queue.length ? "verify_scan" : "idle");
    setScanInput("");
    setScanAttempts(0);
    setErr(null);
    setBatchId(null);
    setPendingRequestId(null);
    setActiveLoanId(null);
    setCompletedLoanIds([]);

    return () => {
      stopPoll();
      stopConfirmTimer();
    };
  }, [open, queue.length]);

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

  const findMatchForTag = (entered: string): ReturnQueueItem | null => {
    const tag = entered.trim();
    if (!tag) {
      setErr("Tap the tool tag (or enter it).");
      return null;
    }

    const exact = remainingQueue.find((item) => (item.expected_tool_tag ?? "").trim() === tag);
    if (exact) {
      setErr(null);
      return exact;
    }

    setScanAttempts((n) => n + 1);
    if (remainingQueue.some((item) => !item.expected_tool_tag)) {
      setErr("This return queue is missing a tool tag in the system. Ask an admin to fix the inventory tag mapping.");
    } else {
      setErr("Wrong tool scanned. Scan one of the tools from this return group.");
    }
    return null;
  };

  const startReturnForItem = async (item: ReturnQueueItem) => {
    setActiveLoanId(item.loan_id);
    setPhase("returning");
    setErr(null);
    setPendingRequestId(null);
    stopPoll();
    stopConfirmTimer();

    try {
      const resp: any = await apiUser.doReturn({
        items: [{ tool_item_id: item.tool_item_id }],
      });

      const currentBatchId = String(resp.batch_id);
      const requestId =
        Array.isArray(resp?.request_ids) && resp.request_ids.length > 0
          ? String(resp.request_ids[0])
          : null;

      setBatchId(currentBatchId);

      // CRITICAL FIX:
      // We already know the request_id from the return batch response.
      // Do not wait for status propagation just to know what to confirm.
      if (requestId) {
        setPendingRequestId(requestId);
        console.log("[ReturnModal] latched request_id from batch response =", requestId);
      }

      // Give the machine a short moment to move to the door, then show the button.
      // This avoids the race where /status has not yet reflected waiting_user_insert.
      confirmTimerRef.current = window.setTimeout(() => {
        setPhase((prev) => {
          if (prev === "returning") {
            console.log("[ReturnModal] showing confirm_insert from local timer");
            return "confirm_insert";
          }
          return prev;
        });
      }, 1200);

      // Poll in background until we explicitly enter confirm_insert.
      startPoll(currentBatchId, item.loan_id);
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
    }
  };

  const poll = async (currentBatchId: string, loanId: string) => {
    const st = await apiUser.returnStatus(currentBatchId);

    const pending = st.items.find(
      (x: any) => String(x.hw_status || x.stage || "") === "waiting_user_insert"
    );

    if (pending) {
      const rid = String(pending.request_id);
      setPendingRequestId(rid);
      setPhase("confirm_insert");
      stopPoll();
      stopConfirmTimer();
      console.log("[ReturnModal] latched pendingRequestId from status =", rid);
      return;
    }

    const done = st.items.every((x: any) => x.hw_status === "return_ok" || x.hw_status === "failed");

    if (!done) {
      // Do not overwrite confirm_insert once we reached it.
      setPhase((prev) => (prev === "confirm_insert" ? prev : "returning"));
      return;
    }

    stopPoll();
    stopConfirmTimer();
    setPendingRequestId(null);

    const ok = st.items.some((x: any) => x.hw_status === "return_ok");
    if (!ok) {
      setErr("Return failed. Contact an admin.");
      setPhase("failed");
      return;
    }

    const nextCompleted = Array.from(new Set([...completedLoanIds, loanId]));
    setCompletedLoanIds(nextCompleted);
    setActiveLoanId(null);
    setScanInput("");

    if (nextCompleted.length >= queue.length) {
      setPhase("done");
      await onAllDone();
      return;
    }

    setPhase("verify_scan");
  };

  const confirmPendingStage = async () => {
    console.log("[ReturnModal] confirm click pendingRequestId =", pendingRequestId);

    if (!pendingRequestId) {
      setErr("Return confirmation is not ready yet. Please wait a moment and try again.");
      return;
    }

    try {
      const requestId = pendingRequestId;
      setErr(null);

      // Pause any state fights while the confirm is sent.
      stopPoll();
      stopConfirmTimer();

      await apiUser.returnConfirmRequest(requestId);

      setPendingRequestId(null);
      setPhase("returning");

      if (batchId && activeLoanId) {
        await poll(batchId, activeLoanId);
        startPoll(batchId, activeLoanId);
      }
    } catch (e: any) {
      setErr(msg(e));
      setPhase("failed");
    }
  };

  const submitScan = async () => {
    const item = findMatchForTag(scanInput);
    if (!item) return;
    await startReturnForItem(item);
  };

  const close = () => {
    stopPoll();
    stopConfirmTimer();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-[30px] bg-white shadow-2xl">
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
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-600">Returning</div>
                    <div className="text-base font-semibold text-slate-900">
                      {current?.tool_name ?? "Tool"}
                      {current?.tool_category ? (
                        <span className="font-medium text-slate-600"> — {current.tool_category}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Due: {current?.due_at ?? "—"}</div>
                    {remainingQueue.length > 1 ? (
                      <div className="mt-2 text-xs text-slate-500">
                        This return group contains multiple checked-out items. Scan whichever one you are physically returning first.
                      </div>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">
                    {completedLoanIds.length} returned / {queue.length}
                  </div>
                </div>
              </div>

              {err ? (
                <div className="mt-4 rounded-xl border bg-rose-50 p-3 text-sm text-rose-700">{err}</div>
              ) : null}

              {phase === "verify_scan" ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Tap the tool tag to verify the item you are returning. For identical tools, scan whichever one you are physically returning first.
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
                </div>
              ) : null}

              {phase === "confirm_insert" ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    The slice is at the door. Place the tool in the slice, then press the button below.
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                      onClick={confirmPendingStage}
                    >
                      I Placed the Tool
                    </button>
                  </div>
                </div>
              ) : null}

              {phase === "returning" ? (
                <div className="mt-5">
                  <HardwareSpinner label="Returning..." />
                  <div className="mt-3 text-sm text-slate-600">
                    Waiting for the machine to move through the return cycle.
                  </div>
                </div>
              ) : null}

              {phase === "failed" ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl border bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Return failed. Contact an admin if retry does not work.
                  </div>
                  <div className="flex justify-end gap-3">
                    <button className="rounded-xl border px-4 py-2 hover:bg-slate-50" onClick={close}>
                      Close
                    </button>
                    <button
                      className="rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800"
                      onClick={() => {
                        stopPoll();
                        stopConfirmTimer();
                        setPhase("verify_scan");
                        setErr(null);
                        setBatchId(null);
                        setPendingRequestId(null);
                        setActiveLoanId(null);
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