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
    } catch {
      await releaseHold(date, time, id).catch(() => {});
      await redis("DEL", bookingKey(id)).catch(() => {});
      return json({ error: "Could not start payment. Please check your Razorpay setup and try again." }, 502);
    }
  } catch (error) {
    const setupError = error.message?.startsWith("Server setup incomplete");
    return json({ error: setupError ? "Online booking is not configured yet. Please contact us or try again later." : "Booking is temporarily unavailable. Please try again." }, 503);
  }
}
