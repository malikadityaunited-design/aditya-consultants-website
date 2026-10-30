import { json, readBooking, razorpay, confirmPaidBooking, confirmPaidOrder, writeBooking, releaseHold, PENDING_RECORD_SECONDS, SLOT_HOLD_SECONDS } from "../lib/booking.js";

function details(booking) {
  return { status: "confirmed", date: booking.date, time: booking.time, timezone: booking.timezone, market: booking.market };
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("booking_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Booking reference is invalid." }, 400);
  try {
    const booking = await readBooking(id);
    if (!booking) return json({ status: "not_found" }, 404);
    if (booking.status === "confirmed" || booking.status === "payment_received_needs_attention") {
      return json({ status: booking.status, date: booking.date, time: booking.time, timezone: booking.timezone, market: booking.market });
    }
    if (booking.payment_link_id) {
      const link = await razorpay("/payment_links/" + encodeURIComponent(booking.payment_link_id));
      const result = await confirmPaidBooking(booking, link);
      if (result.confirmed) return json(details(booking));
      if (result.needsAttention) return json({ status: "payment_received_needs_attention" });
      if (link.status === "expired" || link.status === "cancelled") {
        await releaseHold(booking.date, booking.time, id);
        const expired = { ...booking, status: "payment_expired" };
        await writeBooking(id, expired, PENDING_RECORD_SECONDS);
        return json({ status: "payment_expired" });
      }
      return json({ status: "pending" });
    }
    if (booking.razorpay_order_id) {
      const response = await razorpay("/orders/" + encodeURIComponent(booking.razorpay_order_id) + "/payments");
      const payments = Array.isArray(response.items) ? response.items : [];
      const captured = payments.find((payment) => payment.status === "captured");
      if (captured) {
        const result = await confirmPaidOrder(booking, captured);
        if (result.confirmed) return json(details(booking));
        if (result.needsAttention) return json({ status: "payment_received_needs_attention" });
      }
      if (Date.now() > Date.parse(booking.created_at) + SLOT_HOLD_SECONDS * 1000) {
        await releaseHold(booking.date, booking.time, id);
        await writeBooking(id, { ...booking, status: "payment_expired" }, PENDING_RECORD_SECONDS);
        return json({ status: "payment_expired" });
      }
      return json({ status: "pending" });
    }
    return json({ status: "pending" });
  } catch {
    return json({ error: "We could not verify payment status just now. Please refresh in a moment." }, 503);
  }
}
