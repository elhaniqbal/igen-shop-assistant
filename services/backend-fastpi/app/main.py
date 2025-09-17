from fastapi import FastAPI, Depends
from app.schemas import DispenseRequest
from app.mqtt_handlers import publish_dispense

app = FastAPI(title="Shop Assistant Backend")

@app.post("/api/dispense")
def create_dispense(req: DispenseRequest):
    # TODO: validate limits against DB
    publish_dispense(req)
    return {"ok": True, "request_id": req.request_id}