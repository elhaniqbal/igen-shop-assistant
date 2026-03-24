
class CaptureBridgeMixin:
    def _publish(self, topic, payload, qos=1):
        self.published.append({"topic": topic, "payload": payload, "qos": qos})


def test_serial_ack_transitions_dispense_to_in_progress(backend_modules):
    class CaptureBridge(CaptureBridgeMixin, backend_modules.bridge.Bridge):
        def __init__(self, cfg):
            super().__init__(cfg)
            self.published = []

    bridge = CaptureBridge(backend_modules.bridge.BridgeConfig(mode="SIM", serial_port="/dev/null", serial_baud=115200, ack_timeout_ms=1000, done_timeout_ms=1000))
    bridge._start_pending("dispense", "req_1")

    bridge._handle_serial_line("ACK req_1")

    assert bridge.published[-1]["topic"] == backend_modules.bridge.TOPIC_EVT_DISPENSE
    assert bridge.published[-1]["payload"]["stage"] == "in_progress"


def test_serial_completion_publishes_return_success(backend_modules):
    class CaptureBridge(CaptureBridgeMixin, backend_modules.bridge.Bridge):
        def __init__(self, cfg):
            super().__init__(cfg)
            self.published = []

    bridge = CaptureBridge(backend_modules.bridge.BridgeConfig(mode="SIM", serial_port="/dev/null", serial_baud=115200, ack_timeout_ms=1000, done_timeout_ms=1000))
    bridge._start_pending("return", "ret_1")

    bridge._handle_serial_line("RETURN_OK ret_1")

    assert bridge.published[-1]["topic"] == backend_modules.bridge.TOPIC_EVT_RETURN
    assert bridge.published[-1]["payload"]["stage"] == "succeeded"


def test_admin_test_completion_uses_admin_topic(backend_modules):
    class CaptureBridge(CaptureBridgeMixin, backend_modules.bridge.Bridge):
        def __init__(self, cfg):
            super().__init__(cfg)
            self.published = []

    bridge = CaptureBridge(backend_modules.bridge.BridgeConfig(mode="SIM", serial_port="/dev/null", serial_baud=115200, ack_timeout_ms=1000, done_timeout_ms=1000))
    bridge._start_pending("admin_test", "adm_1")

    bridge._handle_serial_line("DISPENSE_FAIL adm_1 JAM_GANTRY")

    assert bridge.published[-1]["topic"] == backend_modules.bridge.TOPIC_EVT_ADMIN_TEST
    assert bridge.published[-1]["payload"]["stage"] == "failed"
    assert bridge.published[-1]["payload"]["error_code"] == "JAM_GANTRY"


def test_zero_ok_routes_to_cake_home_topic(backend_modules):
    class CaptureBridge(CaptureBridgeMixin, backend_modules.bridge.Bridge):
        def __init__(self, cfg):
            super().__init__(cfg)
            self.published = []

    bridge = CaptureBridge(backend_modules.bridge.BridgeConfig(mode="SIM", serial_port="/dev/null", serial_baud=115200, ack_timeout_ms=1000, done_timeout_ms=1000))
    bridge._start_pending("cake_home", "zero_1")

    bridge._handle_serial_line("ZERO_OK zero_1")

    assert bridge.published[-1]["topic"] == backend_modules.bridge.TOPIC_EVT_CAKE_HOME
    assert bridge.published[-1]["payload"]["stage"] == "succeeded"
