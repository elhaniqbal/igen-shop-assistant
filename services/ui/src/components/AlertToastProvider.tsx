import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastSeverity = "critical" | "error" | "warning" | "info" | "success";

export type AlertToast = {
  id: string;
  title: string;
  message: string;
  severity: ToastSeverity;
  sticky?: boolean;
  createdAt?: string;
};

type AlertToastContextValue = {
  toasts: AlertToast[];
  pushToast: (toast: AlertToast) => void;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
  hasSeen: (id: string) => boolean;
};

const AlertToastContext = createContext<AlertToastContextValue | null>(null);

const severityClasses: Record<ToastSeverity, string> = {
  critical: "bg-black text-white border-neutral-800",
  error: "bg-red-700 text-white border-red-900",
  warning: "bg-amber-500 text-black border-amber-700",
  info: "bg-slate-800 text-white border-slate-900",
  success: "bg-emerald-600 text-white border-emerald-800",
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: AlertToast;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-2xl border shadow-xl ${severityClasses[toast.severity]} overflow-hidden`}
      role="status"
      aria-live={toast.severity === "critical" ? "assertive" : "polite"}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold tracking-wide">{toast.title}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium hover:bg-white/10"
              aria-label="Dismiss alert"
            >
              Dismiss
            </button>
          </div>

          <p className="mt-2 text-sm leading-5 opacity-95">{toast.message}</p>

          {toast.createdAt ? (
            <p className="mt-2 text-[11px] opacity-75">
              {new Date(toast.createdAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AlertToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  // Any alert created before this provider mounted is considered historical
  // and should not produce a toast on login / initial page load.
  const sessionStartMsRef = useRef<number>(Date.now());

  const dismissToast = useCallback((id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const hasSeen = useCallback((id: string) => {
    return seenIds.current.has(id);
  }, []);

  const pushToast = useCallback((toast: AlertToast) => {
    if (seenIds.current.has(toast.id)) return;

    const createdAtMs =
      toast.createdAt && Number.isFinite(new Date(toast.createdAt).getTime())
        ? new Date(toast.createdAt).getTime()
        : null;

    // Suppress stale/historical alerts from becoming pop-up notifications.
    // Still mark them as seen so repeated polling won't try again.
    if (createdAtMs !== null && createdAtMs < sessionStartMsRef.current) {
      seenIds.current.add(toast.id);
      return;
    }

    seenIds.current.add(toast.id);
    setToasts((curr) => [toast, ...curr].slice(0, 6));

    const shouldAutoDismiss =
      !toast.sticky && toast.severity !== "critical" && toast.severity !== "error";

    if (shouldAutoDismiss) {
      window.setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== toast.id));
      }, 5000);
    }
  }, []);

  const value = useMemo(
    () => ({ toasts, pushToast, dismissToast, dismissAll, hasSeen }),
    [toasts, pushToast, dismissToast, dismissAll, hasSeen]
  );

  return (
    <AlertToastContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] mx-auto flex w-full max-w-7xl justify-center px-2 sm:top-4 sm:justify-end sm:px-4">
        <div className="flex w-full max-w-sm flex-col gap-3">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
      </div>
    </AlertToastContext.Provider>
  );
}

export function useAlertToastContext() {
  const ctx = useContext(AlertToastContext);
  if (!ctx) {
    throw new Error("useAlertToastContext must be used inside AlertToastProvider");
  }
  return ctx;
}