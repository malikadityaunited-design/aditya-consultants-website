import crypto from "node:crypto";
import { redis, utcForIst } from "./booking.js";

const SUPPORT_EMAIL = "adityamalik@atomicmail.io";
const EMAIL_RETENTION_SECONDS = 400 * 24 * 60 * 60;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatAppointment(booking, appointment = booking, html = false) {
  const instant = new Date(utcForIst(appointment.date, appointment.time));
  const uk = booking.market === "United Kingdom";
  const local = new Intl.DateTimeFormat(uk ? "en-GB" : "en-IN", {
    timeZone: uk ? "Europe/London" : "Asia/Kolkata", weekday: "long", day: "numeric",
    month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZoneName: "short"
  }).format(instant);
  if (!uk) return `${local} (India time)`;
  const india = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short"
  }).format(instant);
  return html
    ? `${local} (UK local time)<br><span style="color:#777f8c;font-size:13px">${india} equivalent</span>`
    : `${local} (UK local time); ${india} equivalent`;
}

function contentFor(booking, event, previous) {
  const greeting = `<p style="margin:0 0 14px;color:#555e6a;font-size:15px;line-height:1.7">Hello ${escapeHtml(booking.name)},</p>`;
  const current = formatAppointment(booking, booking, true);
  if (event === "confirmed") return {
    subject: "Your consultation is confirmed", title: "Your session is confirmed",
    label: "YOUR APPOINTMENT",
    intro: `${greeting}<p style="margin:0;color:#555e6a;font-size:15px;line-height:1.7">We’ve received your payment and secured your consultation.</p>`,
    details: current,
    footer: "Your first consultation is approximately 45 minutes. We look forward to speaking with you."
  };
  if (event === "rescheduled") return {
    subject: "Your consultation time has changed", title: "Your session has been rescheduled",
    label: "NEW APPOINTMENT TIME",
    intro: `${greeting}<p style="margin:0;color:#555e6a;font-size:15px;line-height:1.7">We’ve updated your consultation time. Your payment remains attached to the booking.</p>`,
    details: `${current}<div style="margin-top:12px;color:#777f8c;font-size:13px">Previously: ${formatAppointment(booking, previous, true)}</div>`,
    footer: "Your consultation is approximately 45 minutes. Reply to this email if the change doesn’t look right."
  };
  return {
    subject: "Your consultation booking is cancelled", title: "Your session has been cancelled",
    label: "CANCELLED APPOINTMENT",
    intro: `${greeting}<p style="margin:0;color:#555e6a;font-size:15px;line-height:1.7">The appointment below has been cancelled and its time is available again.</p>`,
    details: current,
    footer: "As stated in the booking policy, consultations are final and non-refundable. No refund was issued when this booking was cancelled. Contact us if you have questions."
  };
}

function renderEmail(booking, content, siteUrl) {
  const url = escapeHtml(siteUrl);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;color:#121620;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.title)} — ADITYA CONSULTANTS</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ef;padding:34px 14px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e8e4db;border-radius:18px;overflow:hidden">
<tr><td style="padding:26px 34px;background:#10141b;border-bottom:2px solid #d6b775"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border:1px solid #d6b775;border-radius:50%;color:#f0d99d;font-family:Georgia,serif;font-size:22px;font-style:italic"><img src="${url}/brand-mark.svg" width="34" height="34" alt="A" style="display:block;width:34px;height:34px;border:0"></td><td style="padding-left:12px;color:#fff;font-size:13px;font-weight:bold;letter-spacing:2px">ADITYA<br><span style="font-size:9px;letter-spacing:3px;color:#c8cbd1;font-weight:normal">CONSULTANTS</span></td></tr></table></td></tr>
<tr><td style="padding:34px 34px 10px"><p style="margin:0 0 10px;color:#a98b50;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${escapeHtml(content.label)}</p><h1 style="margin:0 0 22px;color:#121620;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:normal;line-height:1.2">${escapeHtml(content.title)}</h1>${content.intro}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:25px 0 22px;background:#f7f5f0;border:1px solid #e9e3d6;border-left:3px solid #d6b775;border-radius:10px"><tr><td style="padding:19px 20px;color:#222833;font-size:16px;line-height:1.8">${content.details}</td></tr></table>
<p style="margin:0 0 24px;color:#727986;font-size:14px;line-height:1.7">${escapeHtml(content.footer)}</p><p style="margin:0 0 8px"><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:24px;background:#d6b775;color:#17191e;text-decoration:none;font-size:13px;font-weight:bold">Visit our website</a></p>
<p style="margin:22px 0 0;color:#727986;font-size:13px;line-height:1.7">Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#755f32">${SUPPORT_EMAIL}</a></p></td></tr>
<tr><td style="padding:20px 34px 26px;color:#8a8f98;font-size:11px;line-height:1.6;border-top:1px solid #efede8">ADITYA CONSULTANTS · International business consultancy<br><a href="${url}" style="color:#8a8f98;text-decoration:underline">adityaconsultants.vercel.app</a></td></tr></table><p style="margin:15px 0 0;color:#969ba3;font-size:10px">Automatic booking update sent to ${escapeHtml(booking.email)}.</p></td></tr></table></body></html>`;
}

function idempotencyKey(booking, event) {
  const revision = event === "rescheduled" ? booking.rescheduled_at
    : event === "cancelled" ? booking.cancelled_at : "confirmed";
  const digest = crypto.createHash("sha256").update(`${event}:${revision || booking.id}`).digest("hex").slice(0, 24);
  return `booking-${event}-${digest}`;
}

export async function sendBookingEmail(booking, event, previous = null) {
  if (!booking?.email || !["confirmed", "rescheduled", "cancelled"].includes(event)) return { status: "failed" };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  const siteUrl = process.env.SITE_URL || "https://adityaconsultants.vercel.app";
  if (!apiKey || !from) return { status: "not_configured" };

  const key = idempotencyKey(booking, event);
  const marker = `ac:email:${booking.id}:${key}`;
  const lock = `${marker}:lock`;
  try {
    if (await redis("GET", marker) === "sent") return { status: "sent" };
    if (await redis("SET", lock, "1", "EX", 120, "NX") !== "OK") return { status: "sending" };
    try {
      const content = contentFor(booking, event, previous);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          from, to: [booking.email], reply_to: SUPPORT_EMAIL, subject: content.subject,
          html: renderEmail(booking, content, siteUrl),
          text: `${content.title}\n\n${event === "rescheduled" ? `New appointment: ${formatAppointment(booking)}\nPreviously: ${formatAppointment(booking, previous)}\n` : `Appointment: ${formatAppointment(booking)}\n`}\n${content.footer}\n\nADITYA CONSULTANTS\n${SUPPORT_EMAIL}\n${siteUrl}`
        })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const code = detail?.name || detail?.code || "";
        console.error("Booking email delivery failed", {
          provider_status: response.status,
          provider_code: /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : null
        });
        return { status: "failed" };
      }
      await redis("SET", marker, "sent", "EX", EMAIL_RETENTION_SECONDS);
      return { status: "sent" };
    } finally {
      await redis("DEL", lock).catch(() => {});
    }
  } catch {
    console.error("Booking email could not be delivered");
    return { status: "failed" };
  }
}
