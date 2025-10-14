import os, time
import paho.mqtt.client as mqtt

host = os.getenv("MQTT_HOST", "broker")
port = int(os.getenv("MQTT_PORT", "1883"))
topic = os.getenv("MQTT_TOPIC", "rfid/scan")
tag = os.getenv("TEST_TAG", "TEST-123")

print(f"[rfid-sim] Waiting for broker {host}:{port} ...")
time.sleep(2)
c = mqtt.Client()
c.connect(host, port, 60)
print(f"[rfid-sim] Publishing tag '{tag}' to {topic}")
c.publish(topic, tag, qos=1, retain=False)
c.disconnect()
