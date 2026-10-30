import { json, redis, slotKey, validBusinessDate, utcForIst } from "../lib/booking.js";

export async function GET(request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!validBusinessDate(date)) return json({ error: "Choose a weekday within the next 60 days." }, 400);
  try {
    const times = Array.from({ length: 12 }, (_, i) => String(i + 9).padStart(2, "0") + ":00");
    const slots = await Promise.all(times.map(async (time) => {
      const held = await redis("GET", slotKey(date, time));
      return { time, available: !held && utcForIst(date, time) > Date.now() + 30 * 60000 };
    }));
    return json({ date, timezone: "Asia/Kolkata", slots });
  } catch {
    return json({ error: "Booking availability is temporarily unavailable. Please try again." }, 503);
  }
}
