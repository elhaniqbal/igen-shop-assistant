import json, os
import paho.mqtt.client as mqtt
from app.schemas import DispenseRequest

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
TOPIC_CMD_DISPENSE = "shop/cmd/dispense"

_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
_client.connect(MQTT_HOST, 1883, 60)

def publish_dispense(req: DispenseRequest):
    _client.publish(TOPIC_CMD_DISPENSE, json.dumps(req.model_dump()), qos=1)