export const EP = {
  rfidSetMode: "/rfid/set-mode",
  rfidConsume: (readerId: string, kind: "card" | "tool") =>
    `/rfid/consume?reader_id=${encodeURIComponent(readerId)}&kind=${kind}`,
  authCard: "/auth/card",

  dispense: "/dispense",
  dispenseStatus: (batchId: string) => `/dispense/${encodeURIComponent(batchId)}/status`,
  dispenseConfirm: "/rfid/tool-confirm",

  loans: (userId: string) => `/loans?user_id=${encodeURIComponent(userId)}`,
  doReturn: "/return",
  returnStatus: (batchId: string) => `/return/${encodeURIComponent(batchId)}/status`,

  adminUsers: "/admin/users",
  adminUser: (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
  adminAssignUserCard: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/card`,

  adminToolModels: "/admin/tool-models",
  adminToolModel: (id: string) => `/admin/tool-models/${encodeURIComponent(id)}`,

  adminToolItems: "/admin/tool-items",
  adminToolItem: (id: string) => `/admin/tool-items/${encodeURIComponent(id)}`,

  adminAssignToolTag: (toolItemId: string) => `/admin/tools/items/${encodeURIComponent(toolItemId)}/tag`,

  adminLoans: "/admin/loans",
  adminLoan: (loanId: string) => `/admin/loans/${encodeURIComponent(loanId)}`,
  adminLoanSendOverdueEmail: (loanId: string) => `/admin/loans/${encodeURIComponent(loanId)}/send-overdue-email`,

  adminEvents: "/admin/events",
  adminEvent: (eventId: number) => `/admin/events/${eventId}`,

  adminUsage: "/admin/metrics/usage",
  adminInventory: "/admin/inventory",

  adminMotorTestStart: "/admin/test/motor",
  adminMotorTestStatus: (requestId: string) =>
    `/admin/test/motor/${encodeURIComponent(requestId)}/status`,

  adminManualStatus: "/admin/manual/status",
  adminManualHomeAll: "/admin/manual/home-all",
  adminManualGoToDoor: "/admin/manual/go-to-door",
  adminManualStop: "/admin/manual/stop",
  adminManualJogAxis: "/admin/manual/jog-axis",
  adminManualMoveCake: "/admin/manual/move-cake",

  adminMachineStatus: "/admin/machine/status",
  adminMachineQueryStatus: "/admin/machine/query-status",
  adminMachineRestartKlipper: "/admin/machine/restart-klipper",
  adminMachineFirmwareRestart: "/admin/machine/firmware-restart",
  adminMachineEmergencyStop: "/admin/machine/emergency-stop",
  adminMachineAlerts: "/admin/machine/alerts",

  adminCalibrationStatus: "/admin/calibration/status",
  adminCalibrationSet: "/admin/calibration/set",

 adminCronJobs: "/admin/cron/jobs",
adminCronRunHealthcheck: "/admin/cron/run-healthcheck",
adminCronRunEmailTest: "/admin/cron/run-email-test",
adminCronAlertRecipients: "/admin/cron/alert-recipients",
};
