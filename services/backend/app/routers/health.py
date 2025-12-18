from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["health"])

@router.get("/healthz", response_class=PlainTextResponse)
def healthz():
    return "ok"
