# ADITYA CONSULTANTS booking website

Static website plus Vercel Functions for weekday consultation booking. Indian bookings (INR 3,000) use Cashfree Hosted Checkout; United Kingdom bookings (GBP 50) continue to use Razorpay Standard Checkout.

## Booking behavior

- Monday to Friday, 09:00–21:00 India Standard Time; 45-minute consultations with 15-minute gaps.
- UK customers see appointment times in Europe/London local time (GMT/BST); stored appointments remain in IST.
- The server fixes the price and reserves each slot in Upstash Redis for up to 30 minutes.
- India checkout orders are created server-side in Cashfree. The customer’s browser receives only a payment session ID, then opens Cashfree’s hosted checkout.
- UK checkout remains with Razorpay. Provider credentials never enter browser code or the Git repository.
- The booking-result endpoint confirms Cashfree payments by querying Cashfree’s order and payment APIs. A signed Cashfree webhook also verifies successful payments when the customer does not return to the site. Razorpay’s existing webhook and verification flow remains in place for UK bookings.
- Pending booking records expire after up to seven days; confirmed records are retained until 90 days after the appointment.
- Customers are sent to provider-hosted payment pages. Card details are not collected or stored by this site.
- Booking records can be reviewed at `/admin.html`; there is no automatic email notification to the business.

## Cashfree configuration

Do not put the supplied `APIKey.csv`, its values, or any real credentials in GitHub or website files. In Vercel Project Settings → Environment Variables, add:

- `CASHFREE_CLIENT_ID` — first credential in the CSV
- `CASHFREE_CLIENT_SECRET` — second credential in the CSV
- `CASHFREE_ENVIRONMENT` — `sandbox` for Preview/testing or `production` for real payments

Use Cashfree sandbox credentials in Vercel Preview and production credentials in Vercel Production. Keep the environment-specific credentials paired with the matching environment value. The application defaults to `sandbox` when `CASHFREE_ENVIRONMENT` is absent.

Before accepting payments, whitelist `adityaconsultants.vercel.app` in Cashfree’s domain settings. Configure a Cashfree payment-success webhook at `https://adityaconsultants.vercel.app/api/cashfree-webhook`. The webhook signature is verified with the Cashfree client secret; no additional webhook secret is required. The Cashfree API does not accept payment-card data from this website.

## Razorpay configuration for UK bookings

Keep these existing Vercel variables for UK payments:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

The Razorpay Standard Checkout webhook remains `https://adityaconsultants.vercel.app/api/razorpay-webhook`, subscribed to `payment.captured`. PayPal remains available only if it is enabled and configured for GBP on the merchant account.

## Shared Vercel variables

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `BOOKING_ADMIN_TOKEN` — a long random secret for `/admin.html`
- `SITE_URL` — `https://adityaconsultants.vercel.app`

After adding or changing Vercel variables, redeploy so the functions receive them. Verify test bookings in Preview before using production credentials. Do not make a real payment merely to test the live checkout.

## Vercel

Import the repository with the Other framework preset, an empty build command, and the project root as the output directory. Vercel detects functions in `api/` and serves static pages from the repository root.

## Booking calendar and admin changes

- The booking page shows a month calendar beside the available start times for the selected date. Weekends and dates outside the booking window are disabled. UK customers see times in their Europe/London timezone; appointments are stored as IST start times.
- The private admin page supports Upcoming, Pending payment, Past, Cancelled, and All filters plus search. Only confirmed future appointments can be changed.
- Rescheduling moves the paid appointment to a currently open weekday/time and keeps its existing payment. Cancellation frees the slot and marks the booking cancelled; it does not issue a refund, consistent with the published final, non-refundable consultation policy.
- Administrative changes use the `BOOKING_ADMIN_TOKEN` and update Upstash atomically with the slot reservation, so a reschedule cannot take a time that another client has already reserved.
