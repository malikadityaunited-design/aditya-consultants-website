import { json, readBooking, razorpay, confirmPaidBooking, writeBooking, releaseHold, PENDING_RECORD_SECONDS } from "../lib/booking.js";

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("booking_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Booking reference is invalid." }, 400);
  try {
    const booking = await readBooking(id);
    if (!booking) return json({ status: "not_found" }, 404);
    if (booking.status === "confirmed" || booking.status === "payment_received_needs_attention") {
      return json({ status: booking.status, date: booking.date, time: booking.time, timezone: booking.timezone });
    }
    if (!booking.payment_link_id) return json({ status: "pending" });
    const link = await razorpay("/payment_links/" + encodeURIComponent(booking.payment_link_id));
    const result = await confirmPaidBooking(booking, link);
    if (result.confirmed) return json({ status: "confirmed", date: booking.date, time: booking.time, timezone: booking.timezone });
    if (result.needsAttention) return json({ status: "payment_received_needs_attention" });
    if (link.status === "expired" || link.status === "cancelled") {
      await releaseHold(booking.date, booking.time, id);
      const expired = { ...booking, status: "payment_expired" };
      await writeBooking(id, expired, PENDING_RECORD_SECONDS);
      return json({ status: "payment_expired" });
    }
    return json({ status: "pending" });
  } catch {
    return json({ error: "We could not verify payment status just now. Please refresh in a moment." }, 503);
  }
}
