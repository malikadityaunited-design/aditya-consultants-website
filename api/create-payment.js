import crypto from "node:crypto";
import {
  json, redis, requireEnv, slotKey, validSlot, bookingKey, writeBooking, releaseHold,
  MARKET_PRICES, SLOT_HOLD_SECONDS, PENDING_RECORD_SECONDS, LINK_LIFETIME_SECONDS, razorpay, cashfree, cashfreeMode
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
  if (market === "India" && !phone) return json({ error: "Enter a phone number for your Cashfree payment." }, 400);
  try {
    requireEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_URL");
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
      if (market === "India") {
        requireEnv("CASHFREE_CLIENT_ID", "CASHFREE_CLIENT_SECRET");
        const orderId = "ac_" + id.replaceAll("-", "");
        const returnUrl = new URL("/booking-result.html", process.env.SITE_URL);
        returnUrl.searchParams.set("booking_id", id);
        const order = await cashfree("/orders", {
          method: "POST",
          headers: { "x-idempotency-key": id },
          body: JSON.stringify({
            order_id: orderId,
            order_amount: price.amount / 100,
            order_currency: "INR",
            customer_details: {
              customer_id: id.replaceAll("-", "").slice(0, 24),
              customer_name: name,
              customer_email: email,
              ...(phone ? { customer_phone: phone } : {})
            },
            order_note: "Initial consultation booking",
            order_expiry_time: new Date(Date.now() + 27 * 60 * 1000).toISOString(),
            order_meta: { return_url: returnUrl.toString() },
            order_tags: { booking_id: id, market: "India" }
          })
        });
        if (order.order_id !== orderId || !order.payment_session_id
          || Number(order.order_amount) !== price.amount / 100 || order.order_currency !== "INR") {
          throw new Error("Cashfree did not return the expected order.");
        }
        booking.cashfree_order_id = order.order_id;
        await writeBooking(id, booking, PENDING_RECORD_SECONDS);
        return json({
          booking_id: id,
          checkout_provider: "cashfree",
          payment_session_id: order.payment_session_id,
          mode: cashfreeMode()
        }, 201);
      }

      if (market === "United Kingdom") {
        requireEnv("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET");
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
      const providerStatus = Number.isInteger(error?.status) ? error.status : null;
      const providerCode = /^[A-Za-z0-9_.-]{1,80}$/.test(error?.code || "") ? error.code : null;
      const provider = error?.provider === "cashfree" || market === "India" ? "Cashfree" : "Razorpay";
      console.error(`${provider} booking payment setup failed`, {
        provider_status: providerStatus,
        provider_code: providerCode
      });
      await releaseHold(date, time, id).catch(() => {});
      await redis("DEL", bookingKey(id)).catch(() => {});
      const message = providerStatus === 401 || providerStatus === 403
        ? `${provider} did not authorize the request (HTTP ${providerStatus}). Check that the API credentials match the selected environment.`
        : providerStatus === 400
          ? `${provider} rejected the payment request. Check the Vercel function log for its status and error code.`
          : `The payment service could not prepare ${provider} checkout. Please try again.`;
      return json({ error: message }, 502);
    }
  } catch (error) {
    const setupError = error.message?.startsWith("Server setup incomplete");
    return json({ error: setupError ? "Online booking is not configured yet. Please contact us or try again later." : "Booking is temporarily unavailable. Please try again." }, 503);
  }
}
