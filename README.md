# ADITYA CONSULTANTS booking website

Static website plus Vercel Functions for weekday consultation booking. India consultations cost INR 3,000 and UK consultations cost GBP 50. Both markets use Razorpay Standard Checkout.

## Booking behavior

- Monday to Friday, 09:00–21:00 India Standard Time; 45-minute consultations with 15-minute gaps.
- UK customers see appointment times in Europe/London local time (GMT/BST); stored appointments remain in IST.
- The server fixes the price and reserves each slot in Upstash Redis for up to 30 minutes.
- The server fixes the price, reserves each slot in Upstash Redis for up to 30 minutes, and creates a Razorpay order in the selected market currency. The browser opens Razorpay Checkout with the order ID. Provider credentials never enter browser code or the Git repository.
- The verify-payment endpoint checks Razorpay’s payment signature before confirming a booking. The booking-result endpoint and signed Razorpay webhook can also confirm successful payments when the customer does not return to the site. Legacy Cashfree webhook and status handling remain for old transactions; new bookings use Razorpay.
- Pending booking records expire after up to seven days; confirmed records are retained until 90 days after the appointment.
- Customers are sent to provider-hosted payment pages. Card details are not collected or stored by this site.
- Booking records can be reviewed at `/admin.html`; there is no automatic email notification to the business.

## Razorpay configuration

Both INR and GBP bookings use the existing Razorpay credentials:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

The Razorpay Standard Checkout webhook URL is `https://adityaconsultants.vercel.app/api/razorpay-webhook`, subscribed to `payment.captured` and `order.paid`. INR checkout also depends on domestic payments being enabled for the merchant account. PayPal availability depends on its configuration in the Razorpay merchant account.

## Shared Vercel variables

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BOOKING_ADMIN_TOKEN` — a long random secret for `/admin.html`
- `SITE_URL` — `https://adityaconsultants.vercel.app`
- `RESEND_API_KEY` — Resend API key with permission to send booking emails
- `BOOKING_EMAIL_FROM` — verified Resend sender, for example `ADITYA CONSULTANTS <bookings@your-verified-domain>`

Booking emails are sent through Resend only after payment has been verified, or after an administrator successfully reschedules or cancels an appointment. The branded templates match the website’s charcoal, ivory, and gold palette and include the circular ADITYA mark. UK appointments show both UK local time and the IST equivalent. Configure a verified sending domain in Resend, then add the two email variables to Vercel Production and redeploy. Email delivery is idempotent so retried payment notifications do not create duplicate messages. The admin portal reports when an update email is not configured or could not be sent.

After adding or changing Vercel variables, redeploy so the functions receive them. Verify test bookings in Preview before using production credentials. Do not make a real payment merely to test the live checkout.

## Vercel

Import the repository with the Other framework preset, an empty build command, and the project root as the output directory. Vercel detects functions in `api/` and serves static pages from the repository root.

## Booking calendar and admin changes

- The booking page shows a month calendar beside the available start times for the selected date. Weekends and dates outside the booking window are disabled. UK customers see times in their Europe/London timezone; appointments are stored as IST start times.
- The private admin page supports Upcoming, Pending payment, Past, Cancelled, and All filters plus search. Only confirmed future appointments can be changed.
- Rescheduling moves the paid appointment to a currently open weekday/time and keeps its existing payment. Cancellation frees the slot and marks the booking cancelled; it does not issue a refund, consistent with the published final, non-refundable consultation policy.
- Administrative changes use the `BOOKING_ADMIN_TOKEN` and update Upstash atomically with the slot reservation, so a reschedule cannot take a time that another client has already reserved.
