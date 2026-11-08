import {
  json, readBooking, cashfree, confirmPaidCashfreeBooking, requireEnv,
  verifyCashfreeWebhookSignature
} from "../lib/booking.js";
import { sendBookingEmail } from "../lib/booking-email.js";

function bookingIdFromCashfreeOrder(orderId) {
  const match = /^ac_([0-9a-f]{32})$/i.exec(orderId || "");
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function POST(request) {
  try {
    requireEnv("CASHFREE_CLIENT_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    const raw = Buffer.from(await request.arrayBuffer()).toString("utf8");
    const signature = request.headers.get("x-webhook-signature") || "";
    const timestamp = request.headers.get("x-webhook-timestamp") || "";
    if (!verifyCashfreeWebhookSignature(raw, timestamp, signature)) {
      return json({ error: "Invalid signature." }, 400);
    }
    const event = JSON.parse(raw);
    const orderId = String(event.data?.order?.order_id || event.data?.order_id || "");
    const id = bookingIdFromCashfreeOrder(orderId);
    if (!id) return json({ received: true });
    const booking = await readBooking(id);
    if (!booking || booking.cashfree_order_id !== orderId || booking.currency !== "INR") {
      return json({ received: true });
    }
    const order = await cashfree("/orders/" + encodeURIComponent(orderId));
    if (order.order_status !== "PAID"
      || Number(order.order_amount) !== Number(booking.amount) / 100
      || order.order_currency !== booking.currency) return json({ received: true });
    const payments = await cashfree("/orders/" + encodeURIComponent(orderId) + "/payments");
    const successful = Array.isArray(payments)
      ? payments.find((payment) => payment.payment_status === "SUCCESS" && payment.order_id === orderId)
      : null;
    if (!successful) return json({ received: true });
    const result = await confirmPaidCashfreeBooking(booking, successful);
    if (result.confirmed) await sendBookingEmail(result.booking || booking, "confirmed");
    return json({ received: true, confirmed: result.confirmed, needs_attention: Boolean(result.needsAttention) });
  } catch {
    return json({ error: "Webhook could not be processed." }, 500);
  }
}
