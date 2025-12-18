import { http } from "./httpClient";

export type TestMotorAction = "dispense" | "return";

export type TestMotorReq = {
  motor_id: number;          // 2..10
  action: TestMotorAction;
};

export type TestMotorResp = {
  ok: true;
  motor_id: number;
  action: TestMotorAction;
};

export const adminApi = {
  testMotor: (body: TestMotorReq) =>
    http<TestMotorResp>("/admin/test/motor", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
