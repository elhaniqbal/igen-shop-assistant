
def test_mqtt_topic_registry_dispatches_handler(db_session, backend_modules):
    called = {}

    @backend_modules.mqtt.mqtt_topic("igen/test/topic")
    def handler(db, payload):
        called["payload"] = payload
        called["db_bound"] = db is db_session

    backend_modules.mqtt.dispatch_mqtt(db_session, "igen/test/topic", {"hello": "world"})

    assert called == {"payload": {"hello": "world"}, "db_bound": True}
