import crypto from "node:crypto";
import { json, readBooking, razorpay, confirmPaidOrder, requireEnv } from "../lib/booking.js";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const id = String(body.booking_id || "");
  const paymentId = String(body.razorpay_payment_id || "");
  const orderId = String(body.razorpay_order_id || "");
  const signature = String(body.razorpay_signature || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^pay_[A-Za-z0-9]+$/.test(paymentId)
    || !/^order_[A-Za-z0-9]+$/.test(orderId) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return json({ error: "Payment verification details are incomplete." }, 400);
  }
  try {
    requireEnv("RAZORPAY_KEY_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    const booking = await readBooking(id);
    if (!booking || booking.razorpay_order_id !== orderId) return json({ error: "Booking reference did not match the payment." }, 400);
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId).digest();
    const supplied = Buffer.from(signature, "hex");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return json({ error: "Payment verification failed." }, 400);
    }
    const payment = await razorpay("/payments/" + encodeURIComponent(paymentId));
    if (payment.status !== "captured") return json({ status: "pending" });
    const result = await confirmPaidOrder(booking, payment);
    if (result.confirmed) return json({ status: "confirmed" });
    if (result.needsAttention) return json({ status: "payment_received_needs_attention" });
    return json({ error: "Payment did not match the selected appointment." }, 409);
  } catch {
    return json({ error: "We could not verify this payment just now. Please do not pay again; refresh the booking status shortly." }, 503);
  }
}
