import { json, redis, constantTimeEqual, requireEnv } from "../lib/booking.js";

export async function GET(request) {
  try {
    requireEnv("BOOKING_ADMIN_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    const auth = request.headers.get("authorization") || "";
    const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!constantTimeEqual(supplied, process.env.BOOKING_ADMIN_TOKEN)) return json({ error: "Not authorized." }, 401);
    let cursor = "0";
    const keys = [];
    do {
      const result = await redis("SCAN", cursor, "MATCH", "ac:booking:*", "COUNT", "100");
      cursor = String(result?.[0] ?? "0");
      keys.push(...(result?.[1] || []));
    } while (cursor !== "0" && keys.length < 1000);
    const records = [];
    for (let i = 0; i < keys.length; i += 100) {
      const values = await redis("MGET", ...keys.slice(i, i + 100));
      for (const raw of values || []) {
        if (!raw) continue;
        try { records.push(JSON.parse(raw)); } catch {}
      }
    }
    records.sort((a, b) => (a.date + "T" + a.time).localeCompare(b.date + "T" + b.time));
    return json({ bookings: records });
  } catch {
    return json({ error: "Booking dashboard is temporarily unavailable." }, 503);
  }
}
