from __future__ import annotations

import os
from typing import Any

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Mail,
    From,
    To,
    Subject,
    PlainTextContent,
    HtmlContent,
)

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "").strip()
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL", " havenkiosk.alerts@gmail.com").strip()
SENDGRID_FROM_NAME = os.getenv("SENDGRID_FROM_NAME", "UBC HAVEN Alerts").strip()


def _require_sendgrid_config():
    if not SENDGRID_API_KEY:
        raise RuntimeError("SENDGRID_API_KEY is not set")
    if not SENDGRID_FROM_EMAIL:
        raise RuntimeError("SENDGRID_FROM_EMAIL is not set")


def send_email(to: str, subject: str, body: str, *, html: str | None = None) -> dict[str, Any]:
    _require_sendgrid_config()

    message = Mail(
        from_email=From(SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME),
        to_emails=To(to),
        subject=Subject(subject),
        plain_text_content=PlainTextContent(body),
    )

    if html:
        message.html_content = HtmlContent(html)

    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)
        return {
            "ok": 200 <= int(response.status_code) < 300,
            "status_code": int(response.status_code),
            "message": "Email sent" if 200 <= int(response.status_code) < 300 else "Email request returned non-2xx",
            "body": response.body.decode("utf-8", errors="replace")
            if isinstance(response.body, (bytes, bytearray))
            else str(response.body),
            "headers": dict(response.headers),
        }
    except Exception as e:
        raise RuntimeError(f"SendGrid send failed: {e}")


def send_template(to: str, template_name: str, context: dict | None = None) -> dict[str, Any]:
    context = context or {}

    if template_name == "alert_generic":
        code = str(context.get("code", "ALERT"))
        message = str(context.get("message", ""))
        payload = str(context.get("payload", "{}"))

        subject = f"[HAVEN Alert] {code}"
        body = (
            f"Code: {code}\n"
            f"Message: {message}\n\n"
            f"Payload:\n{payload}"
        )
        html = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">
          <h2 style="margin-bottom:8px;">HAVEN Alert</h2>
          <p><strong>Code:</strong> {code}</p>
          <p><strong>Message:</strong> {message}</p>
          <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;">{payload}</pre>
        </div>
        """
        return send_email(to=to, subject=subject, body=body, html=html)

    if template_name == "overdue_loan_notice":
        user_name = str(context.get("user_name", "there"))
        tool_name = str(context.get("tool_name", "your tool"))
        tool_item_id = str(context.get("tool_item_id", ""))
        loan_id = str(context.get("loan_id", ""))
        due_at = str(context.get("due_at", ""))
        overdue_hours = str(context.get("overdue_hours", ""))
        support_email = str(context.get("support_email", SENDGRID_FROM_EMAIL))

        subject = f"Overdue tool reminder: {tool_name}"
        body = (
            f"Hello {user_name},\n\n"
            f"This is a reminder that the following loan is overdue.\n\n"
            f"Tool: {tool_name}\n"
            f"Tool Item ID: {tool_item_id}\n"
            f"Loan ID: {loan_id}\n"
            f"Due At: {due_at}\n"
            f"Hours Overdue: {overdue_hours}\n\n"
            f"Please return the item as soon as possible, or contact {support_email} if you need help.\n\n"
            f"— HAVEN Tool System"
        )
        html = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">
          <h2 style="margin-bottom:8px;">Overdue tool reminder</h2>
          <p>Hello {user_name},</p>
          <p>This is a reminder that the following loan is overdue.</p>

          <table style="border-collapse:collapse;margin:16px 0;">
            <tr>
              <td style="padding:6px 12px 6px 0;"><strong>Tool</strong></td>
              <td>{tool_name}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;"><strong>Tool Item ID</strong></td>
              <td><code>{tool_item_id}</code></td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;"><strong>Loan ID</strong></td>
              <td><code>{loan_id}</code></td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;"><strong>Due At</strong></td>
              <td>{due_at}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;"><strong>Hours Overdue</strong></td>
              <td>{overdue_hours}</td>
            </tr>
          </table>

          <p>Please return the item as soon as possible, or contact {support_email} if you need help.</p>
          <p>— HAVEN Tool System</p>
        </div>
        """
        return send_email(to=to, subject=subject, body=body, html=html)

    raise ValueError(f"unknown_template:{template_name}")


def list_templates() -> list[str]:
    return [
        "alert_generic",
        "overdue_loan_notice",
    ]