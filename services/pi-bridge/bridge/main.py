import json, os, serial, threading
import paho.mqtt.client as mqtt
from .framing import encode_frame, decode_frames

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
UART_PORT = os.getenv("UART_PORT", "/dev/ttyUSB0")
UART_BAUD = int(os.getenv("UART_BAUD", "115200"))

TOPIC_CMD_DISPENSE = "shop/cmd/dispense"
TOPIC_EVT_RESULT   = "shop/evt/dispense_result"

ser = serial.Serial(UART_PORT, UART_BAUD, timeout=0.1)
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.connect(MQTT_HOST, 1883, 60)

# MQTT→UART
def on_message(_c, _ud, msg):
    if msg.topic == TOPIC_CMD_DISPENSE:
        payload = json.loads(msg.payload)
        frame = encode_frame({"t":"DISPENSE", "d": payload})
        ser.write(frame)

client.on_message = on_message
client.subscribe([(TOPIC_CMD_DISPENSE, 1)])
client.loop_start()

# UART→MQTT (controller responses)
rx_buf = bytearray()

def uart_rx_loop():
    while True:
        rx = ser.read(512)
        if rx:
            rx_buf.extend(rx)
            for obj in decode_frames(bytes(rx_buf)):
                if obj.get("t") == "DISPENSE_RESULT":
                    client.publish(TOPIC_EVT_RESULT, json.dumps(obj["d"]))
            # simple: clear buffer on parse attempt
            rx_buf.clear()

threading.Thread(target=uart_rx_loop, daemon=True).start()

print("Pi Bridge running.")