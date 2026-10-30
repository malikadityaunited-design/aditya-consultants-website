import crypto from "node:crypto";
import { json, readBooking, confirmPaidBooking, requireEnv } from "../lib/booking.js";

export async function POST(request) {
  try {
    requireEnv("RAZORPAY_WEBHOOK_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    const raw = Buffer.from(await request.arrayBuffer());
    const supplied = request.headers.get("x-razorpay-signature") || "";
    if (!/^[0-9a-f]{64}$/i.test(supplied)) return json({ error: "Invalid signature." }, 400);
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest();
    const actual = Buffer.from(supplied, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return json({ error: "Invalid signature." }, 400);
    }
    const event = JSON.parse(raw.toString("utf8"));
    if (event.event !== "payment_link.paid") return json({ received: true });
    const link = event.payload?.payment_link?.entity;
    const id = link?.reference_id;
    if (!id) return json({ received: true });
    const booking = await readBooking(id);
    if (!booking || booking.payment_link_id !== link.id) return json({ received: true });
    const result = await confirmPaidBooking(booking, link);
    return json({ received: true, confirmed: result.confirmed, needs_attention: Boolean(result.needsAttention) });
  } catch {
    return json({ error: "Webhook could not be processed." }, 500);
  }
}
