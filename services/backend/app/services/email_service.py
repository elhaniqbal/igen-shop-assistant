from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from string import Template
from typing import Any

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "email_templates"
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "shopassistant@example.local")
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "1") == "1"
EMAIL_DRY_RUN = os.getenv("EMAIL_DRY_RUN", "1") == "1"


def list_templates() -> list[str]:
    if not TEMPLATE_DIR.exists():
        return []
    return sorted(p.stem for p in TEMPLATE_DIR.glob("*.txt"))


def render_template(name: str, context: dict[str, Any]) -> tuple[str, str]:
    path = TEMPLATE_DIR / f"{name}.txt"
    if not path.exists():
        raise ValueError(f"unknown_template:{name}")
    raw = path.read_text(encoding="utf-8")
    parts = raw.split("\n\n", 1)
    header = parts[0]
    body = parts[1] if len(parts) > 1 else ""
    subject = "Notification"
    if header.lower().startswith("subject:"):
        subject = header.split(":", 1)[1].strip()
    subject = Template(subject).safe_substitute(**context)
    body = Template(body).safe_substitute(**context)
    return subject, body


def send_email(*, to: str, subject: str, body: str) -> dict:
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    if EMAIL_DRY_RUN or not SMTP_HOST:
        return {"ok": True, "dry_run": True, "to": to, "subject": subject}

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
        if SMTP_STARTTLS:
            smtp.starttls()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASS)
        smtp.send_message(msg)
    return {"ok": True, "dry_run": False, "to": to, "subject": subject}


def send_template(*, to: str, template_name: str, context: dict[str, Any]) -> dict:
    subject, body = render_template(template_name, context)
    return send_email(to=to, subject=subject, body=body)
