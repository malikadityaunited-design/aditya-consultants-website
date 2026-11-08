import crypto from "node:crypto";

export const SLOT_HOLD_SECONDS = 30 * 60;
// Razorpay requires expire_by to be at least 15 minutes ahead when it receives
// the request. Use a 20-minute lifetime to leave a safe processing buffer.
export const LINK_LIFETIME_SECONDS = 20 * 60;
export const PENDING_RECORD_SECONDS = 7 * 24 * 60 * 60;
export const FINAL_RECORD_SECONDS = 90 * 24 * 60 * 60;
export const MARKET_PRICES = {
  India: { currency: "INR", amount: 300000, label: "INR 3,000" },
  "United Kingdom": { currency: "GBP", amount: 5000, label: "GBP 50" }
};

export function cashfreeMode() {
  const mode = String(process.env.CASHFREE_ENVIRONMENT || "sandbox").toLowerCase();
  if (mode !== "sandbox" && mode !== "production") throw new Error("Cashfree environment must be sandbox or production.");
  return mode;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function requireEnv() {
  const missing = Array.from(arguments).filter((key) => !process.env[key]);
  if (missing.length) throw new Error("Server setup incomplete: " + missing.join(", "));
}

export async function redis() {
  const command = Array.from(arguments);
  requireEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      authorization: "Bearer " + process.env.UPSTASH_REDIS_REST_TOKEN,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error("Booking storage request failed");
  return data.result;
}

export function utcForIst(date, time) {
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  return Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1]) - 330 * 60000;
}

export function validBusinessDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const parts = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parsed.toISOString().slice(0, 10) !== date) return false;
  const weekday = parsed.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const datePartsIst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const todayFields = {};
  datePartsIst.forEach((part) => { todayFields[part.type] = part.value; });
  const todayIst = todayFields.year + "-" + todayFields.month + "-" + todayFields.day;
  const today = new Date(todayIst + "T00:00:00Z");
  const daysAhead = (parsed.getTime() - today.getTime()) / 86400000;
  return daysAhead >= 0 && daysAhead <= 60;
}

export function validSlot(date, time) {
  if (!validBusinessDate(date) || !/^(09|1\d|20):00$/.test(time || "")) return false;
  return utcForIst(date, time) > Date.now() + 30 * 60000;
}

export function slotKey(date, time) {
  return "ac:slot:" + date + ":" + time;
}

export function bookingKey(id) {
  return "ac:booking:" + id;
}

export async function releaseHold(date, time, id) {
  const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
  return redis("EVAL", script, "1", slotKey(date, time), id);
}

export async function readBooking(id) {
  const raw = await redis("GET", bookingKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function writeBooking(id, booking, ttl) {
  const command = ["SET", bookingKey(id), JSON.stringify(booking)];
  if (ttl) command.push("EX", String(ttl));
  await redis(...command);
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export async function tooManyAdminFailures(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()) || [];
  const ip = forwarded[forwarded.length - 1] || "unknown";
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const key = "ac:admin:failures:" + ipHash;
  const failures = Number(await redis("INCR", key));
  if (failures === 1) await redis("EXPIRE", key, 900);
  return failures > 10;
}

export async function razorpay(path, options = {}) {
  requireEnv("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET");
  const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    ...options,
    headers: {
      authorization: "Basic " + auth,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.description || "Razorpay request failed");
    error.status = response.status;
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

export async function cashfree(path, options = {}) {
  requireEnv("CASHFREE_CLIENT_ID", "CASHFREE_CLIENT_SECRET");
  const mode = cashfreeMode();
  const base = mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
  const response = await fetch(base + path, {
    ...options,
    headers: {
      "x-client-id": process.env.CASHFREE_CLIENT_ID,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
      "x-api-version": "2026-01-01",
      accept: "application/json",
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Cashfree request failed");
    error.status = response.status;
    error.code = data?.code || data?.type || null;
    error.provider = "cashfree";
    throw error;
  }
  return data;
}

export function verifyCashfreeWebhookSignature(rawBody, timestamp, suppliedSignature) {
  if (typeof rawBody !== "string" || typeof timestamp !== "string" || !timestamp
    || typeof suppliedSignature !== "string" || !suppliedSignature) return false;
  const expected = crypto.createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
    .update(timestamp + rawBody).digest();
  const supplied = Buffer.from(suppliedSignature, "base64");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export async function confirmPaidBooking(booking, paymentLink) {
  const valid = paymentLink?.status === "paid"
    && paymentLink.reference_id === booking.id
    && paymentLink.amount === booking.amount
    && paymentLink.amount_paid === booking.amount
    && paymentLink.currency === booking.currency
    && paymentLink.id === booking.payment_link_id;
  if (!valid) return { confirmed: false, reason: "Payment details did not match the booking." };
  if (booking.status === "confirmed") return { confirmed: true, booking };
  if (booking.status !== "pending_payment") return { confirmed: false, reason: "Booking is no longer awaiting payment." };
  const slot = slotKey(booking.date, booking.time);
  const updated = { ...booking, status: "confirmed", paid_at: new Date().toISOString() };
  const script = [
    "local current=redis.call('GET',KEYS[1])",
    "if current=='confirmed:'..ARGV[1] then return 1 end",
    "if current~=ARGV[1] then return 0 end",
    "redis.call('SET',KEYS[1],'confirmed:'..ARGV[1],'EX',ARGV[3])",
    "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
    "return 1"
  ].join("\n");
  const appointmentEnd = utcForIst(booking.date, booking.time) + 45 * 60000;
  const retentionSeconds = Math.ceil((Math.max(Date.now(), appointmentEnd) + FINAL_RECORD_SECONDS * 1000 - Date.now()) / 1000);
  const committed = await redis("EVAL", script, "2", slot, bookingKey(booking.id), booking.id, JSON.stringify(updated), String(retentionSeconds));
  if (Number(committed) === 1) return { confirmed: true, booking: updated };
  const attention = { ...booking, status: "payment_received_needs_attention", paid_at: new Date().toISOString() };
  await writeBooking(booking.id, attention, retentionSeconds);
  return { confirmed: false, needsAttention: true, booking: attention };
}

export async function confirmPaidOrder(booking, payment) {
  const valid = payment?.status === "captured"
    && payment.order_id === booking.razorpay_order_id
    && payment.amount === booking.amount
    && payment.currency === booking.currency;
  if (!valid) return { confirmed: false, reason: "Payment details did not match the booking." };
  if (booking.status === "confirmed") return { confirmed: true, booking };
  if (booking.status !== "pending_payment") return { confirmed: false, reason: "Booking is no longer awaiting payment." };
  const slot = slotKey(booking.date, booking.time);
  const updated = {
    ...booking,
    status: "confirmed",
    payment_id: payment.id,
    payment_method: payment.method || "paypal",
    paid_at: new Date().toISOString()
  };
  const script = [
    "local current=redis.call('GET',KEYS[1])",
    "if current=='confirmed:'..ARGV[1] then return 1 end",
    "if current~=ARGV[1] then return 0 end",
    "redis.call('SET',KEYS[1],'confirmed:'..ARGV[1],'EX',ARGV[3])",
    "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
    "return 1"
  ].join("\n");
  const appointmentEnd = utcForIst(booking.date, booking.time) + 45 * 60000;
  const retentionSeconds = Math.ceil((Math.max(Date.now(), appointmentEnd) + FINAL_RECORD_SECONDS * 1000 - Date.now()) / 1000);
  const committed = await redis("EVAL", script, "2", slot, bookingKey(booking.id), booking.id, JSON.stringify(updated), String(retentionSeconds));
  if (Number(committed) === 1) return { confirmed: true, booking: updated };
  const attention = { ...booking, status: "payment_received_needs_attention", payment_id: payment.id, paid_at: new Date().toISOString() };
  await writeBooking(booking.id, attention, retentionSeconds);
  return { confirmed: false, needsAttention: true, booking: attention };
}

export async function confirmPaidCashfreeBooking(booking, payment) {
  const amount = Number(booking.amount) / 100;
  const valid = payment?.payment_status === "SUCCESS"
    && payment?.is_captured === true
    && payment.order_id === booking.cashfree_order_id
    && payment.order_currency === booking.currency
    && payment.payment_currency === booking.currency
    && Number(payment.order_amount) === amount
    && Number(payment.payment_amount) === amount;
  if (!valid) return { confirmed: false, reason: "Payment details did not match the booking." };
  if (booking.status === "confirmed") return { confirmed: true, booking };
  if (booking.status !== "pending_payment") return { confirmed: false, reason: "Booking is no longer awaiting payment." };
  const slot = slotKey(booking.date, booking.time);
  const updated = {
    ...booking,
    status: "confirmed",
    payment_id: String(payment.cf_payment_id || ""),
    payment_method: "cashfree",
    paid_at: new Date().toISOString()
  };
  const script = [
    "local current=redis.call('GET',KEYS[1])",
    "if current=='confirmed:'..ARGV[1] then return 1 end",
    "if current~=ARGV[1] then return 0 end",
    "redis.call('SET',KEYS[1],'confirmed:'..ARGV[1],'EX',ARGV[3])",
    "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
    "return 1"
  ].join("\n");
  const appointmentEnd = utcForIst(booking.date, booking.time) + 45 * 60000;
  const retentionSeconds = Math.ceil((Math.max(Date.now(), appointmentEnd) + FINAL_RECORD_SECONDS * 1000 - Date.now()) / 1000);
  const committed = await redis("EVAL", script, "2", slot, bookingKey(booking.id), booking.id, JSON.stringify(updated), String(retentionSeconds));
  if (Number(committed) === 1) return { confirmed: true, booking: updated };
  const attention = { ...booking, status: "payment_received_needs_attention", payment_id: String(payment.cf_payment_id || ""), paid_at: new Date().toISOString() };
  await writeBooking(booking.id, attention, retentionSeconds);
  return { confirmed: false, needsAttention: true, booking: attention };
}
