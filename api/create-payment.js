import crypto from "node:crypto";
import {
  json, redis, requireEnv, slotKey, validSlot, bookingKey, writeBooking, releaseHold,
  MARKET_PRICES, SLOT_HOLD_SECONDS, PENDING_RECORD_SECONDS, LINK_LIFETIME_SECONDS, razorpay
} from "../lib/booking.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().slice(0, 200);
  const phone = String(body.phone || "").trim().slice(0, 32);
  const business = String(body.business || "").trim().slice(0, 120);
  const date = body.date;
  const time = body.time;
  const market = body.market;
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter your name and a valid email address." }, 400);
  }
  if (!MARKET_PRICES[market] || !validSlot(date, time)) {
    return json({ error: "That weekday or time is no longer bookable. Please choose another slot." }, 400);
  }
  try {
    requireEnv("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_URL");
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()) || [];
    const ip = forwarded[forwarded.length - 1] || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
    const rateKey = "ac:rate:" + ipHash;
    const hits = await redis("INCR", rateKey);
    await redis("EXPIRE", rateKey, 900);
    if (Number(hits) > 8) return json({ error: "Too many booking attempts. Please try again later." }, 429);

    const id = crypto.randomUUID();
    const reserved = await redis("SET", slotKey(date, time), id, "EX", SLOT_HOLD_SECONDS, "NX");
    if (reserved !== "OK") return json({ error: "That slot was just taken. Please choose another time." }, 409);

    const price = MARKET_PRICES[market];
    const booking = {
      id, name, email, phone, business, market, date, time,
      timezone: "Asia/Kolkata", duration_minutes: 45,
      amount: price.amount, currency: price.currency, price_label: price.label,
      status: "pending_payment", created_at: new Date().toISOString()
    };
    try {
      await writeBooking(id, booking, PENDING_RECORD_SECONDS);
      if (market === "United Kingdom") {
        const order = await razorpay("/orders", {
          method: "POST",
          body: JSON.stringify({
            amount: price.amount,
            currency: price.currency,
            receipt: id,
            notes: { booking_id: id, date, time_ist: time, market }
          })
        });
        if (!order.id || order.amount !== price.amount || order.currency !== price.currency) {
          throw new Error("Razorpay did not return the expected order.");
        }
        booking.razorpay_order_id = order.id;
        await writeBooking(id, booking, PENDING_RECORD_SECONDS);
        return json({
          booking_id: id,
          checkout: true,
          key_id: process.env.RAZORPAY_KEY_ID,
          order_id: order.id,
          amount: price.amount,
          currency: price.currency,
          name,
          email,
          phone
        }, 201);
      }

      const callback = new URL("/booking-result.html", process.env.SITE_URL);
      callback.searchParams.set("booking_id", id);
      const link = await razorpay("/payment_links", {
        method: "POST",
        body: JSON.stringify({
          amount: price.amount,
          currency: price.currency,
          accept_partial: false,
          reference_id: id,
          description: "45-minute initial consultation - " + market,
          customer: { name, email, ...(phone ? { contact: phone } : {}) },
          notify: { email: false, sms: false },
          reminder_enable: false,
          expire_by: Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS,
          callback_url: callback.toString(),
          callback_method: "get",
          notes: { booking_id: id, date, time_ist: time, market }
        })
      });
      if (!link.short_url || !link.id) throw new Error("Razorpay did not return a payment link.");
      booking.payment_link_id = link.id;
      await writeBooking(id, booking, PENDING_RECORD_SECONDS);
      return json({ booking_id: id, payment_url: link.short_url }, 201);
    } catch (error) {
      const description = String(error?.message || "Unknown error")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
        .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted phone]")
        .slice(0, 240);
      const providerStatus = Number.isInteger(error?.status) ? error.status : null;
      const providerCode = /^[A-Za-z0-9_.-]{1,80}$/.test(error?.code || "") ? error.code : null;
      console.error("Booking payment setup failed", {
        provider_status: providerStatus,
        provider_code: providerCode,
        description
      });
      await releaseHold(date, time, id).catch(() => {});
      await redis("DEL", bookingKey(id)).catch(() => {});
      const message = providerStatus === 401 || providerStatus === 403
        ? `Razorpay did not authorize the request (HTTP ${providerStatus}). Check that the Production Key ID and Key Secret are a matching Live pair, and that Payment Links are enabled.`
        : providerStatus === 400
          ? "Razorpay rejected the payment-link request. The Vercel function log contains its sanitized reason."
          : "The payment service could not create a payment link. Please try again; the Vercel function log contains a sanitized diagnostic.";
      return json({ error: message }, 502);
    }
  } catch (error) {
    const setupError = error.message?.startsWith("Server setup incomplete");
    return json({ error: setupError ? "Online booking is not configured yet. Please contact us or try again later." : "Booking is temporarily unavailable. Please try again." }, 503);
  }
}
