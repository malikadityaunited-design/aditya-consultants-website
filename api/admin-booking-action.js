import {
  json, redis, requireEnv, constantTimeEqual, readBooking, slotKey, bookingKey,
  validSlot, utcForIst, FINAL_RECORD_SECONDS, tooManyAdminFailures
} from "../lib/booking.js";
import { sendBookingEmail } from "../lib/booking-email.js";

function recordTtl(date, time) {
  const appointmentEnd = utcForIst(date, time) + 45 * 60000;
  return Math.max(1, Math.ceil((Math.max(Date.now(), appointmentEnd) + FINAL_RECORD_SECONDS * 1000 - Date.now()) / 1000));
}

function isUpcoming(date, time) {
  return utcForIst(date, time) > Date.now();
}

export async function POST(request) {
  try {
    requireEnv("BOOKING_ADMIN_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    const authorization = request.headers.get("authorization") || "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!constantTimeEqual(supplied, process.env.BOOKING_ADMIN_TOKEN)) {
      const throttled = await tooManyAdminFailures(request);
      return json({ error: throttled ? "Too many attempts. Try again in 15 minutes." : "Not authorized." }, throttled ? 429 : 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const id = String(body.booking_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Booking reference is invalid." }, 400);
    const booking = await readBooking(id);
    if (!booking) return json({ error: "Booking was not found." }, 404);
    if (booking.status !== "confirmed") return json({ error: "Only confirmed bookings can be changed here." }, 409);
    if (!isUpcoming(booking.date, booking.time)) return json({ error: "Past bookings can’t be changed." }, 409);

    const oldSlotKey = slotKey(booking.date, booking.time);
    const recordKey = bookingKey(id);

    if (body.action === "cancel") {
      const cancelled = { ...booking, status: "cancelled", cancelled_at: new Date().toISOString() };
      const ttl = recordTtl(booking.date, booking.time);
      const script = [
        "if redis.call('GET',KEYS[1])~='confirmed:'..ARGV[1] then return 0 end",
        "local raw=redis.call('GET',KEYS[2])",
        "if not raw then return -1 end",
        "local current=cjson.decode(raw)",
        "if current.status~='confirmed' or current.date~=ARGV[2] or current.time~=ARGV[3] then return -2 end",
        "redis.call('DEL',KEYS[1])",
        "redis.call('SET',KEYS[2],ARGV[4],'EX',ARGV[5])",
        "return 1"
      ].join("\n");
      const result = Number(await redis("EVAL", script, "2", oldSlotKey, recordKey, id, booking.date, booking.time, JSON.stringify(cancelled), String(ttl)));
      if (result !== 1) return json({ error: "This booking changed while you were viewing it. Reload the list and try again." }, 409);
      const notification = await sendBookingEmail(cancelled, "cancelled");
      return json({ booking: cancelled, notification });
    }

    if (body.action !== "reschedule") return json({ error: "Choose reschedule or cancel." }, 400);
    const date = String(body.date || "");
    const time = String(body.time || "");
    if (!validSlot(date, time)) return json({ error: "Choose a future weekday and available time." }, 400);
    if (date === booking.date && time === booking.time) return json({ error: "Choose a different appointment time." }, 400);

    const updated = {
      ...booking,
      date,
      time,
      timezone: "Asia/Kolkata",
      rescheduled_at: new Date().toISOString(),
      previous_appointment: { date: booking.date, time: booking.time }
    };
    const newSlotKey = slotKey(date, time);
    const ttl = recordTtl(date, time);
    const script = [
      "if redis.call('GET',KEYS[1])~='confirmed:'..ARGV[1] then return 0 end",
      "local raw=redis.call('GET',KEYS[3])",
      "if not raw then return -1 end",
      "local current=cjson.decode(raw)",
      "if current.status~='confirmed' or current.date~=ARGV[2] or current.time~=ARGV[3] then return -2 end",
      "if redis.call('EXISTS',KEYS[2])==1 then return -3 end",
      "redis.call('SET',KEYS[2],'confirmed:'..ARGV[1],'EX',ARGV[5])",
      "redis.call('DEL',KEYS[1])",
      "redis.call('SET',KEYS[3],ARGV[4],'EX',ARGV[5])",
      "return 1"
    ].join("\n");
    const result = Number(await redis("EVAL", script, "3", oldSlotKey, newSlotKey, recordKey, id, booking.date, booking.time, JSON.stringify(updated), String(ttl)));
    if (result === -3) return json({ error: "That time was just taken. Please choose another available time." }, 409);
    if (result !== 1) return json({ error: "This booking changed while you were viewing it. Reload the list and try again." }, 409);
    const notification = await sendBookingEmail(updated, "rescheduled", { date: booking.date, time: booking.time });
    return json({ booking: updated, notification });
  } catch {
    return json({ error: "The booking change couldn’t be saved. Please try again." }, 503);
  }
}
