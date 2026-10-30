# ADITYA CONSULTANTS booking website

Static website plus Vercel Functions for appointment booking and Razorpay hosted payment links.

## Booking behavior

- Weekdays only, Monday to Friday, in Asia/Kolkata time.
- 45-minute session, with a 15-minute gap; start times are hourly from 09:00 through 20:00 IST.
- INR 1,500 for India; GBP 50 for the United Kingdom.
- The API holds a selected slot for up to 30 minutes and creates a Razorpay Payment Link that expires after 15 minutes.
- A booking is confirmed only after a server-side payment-link check matches the booking reference, amount and currency. The signed payment_link.paid webhook is a second confirmation path.
- Vercel Functions coordinate reservations using Upstash Redis. Pending booking records expire after up to seven days; confirmed records are retained for 90 days after the appointment.
- Customers are redirected to Razorpay's hosted payment page. Card details never pass through this site.
- Customers see a payment result page. There is no automatic email notification to the business; review paid and unresolved bookings at /admin.html.

## Required setup before deployment

Do not add the attached rzp-key.csv or any real credentials to GitHub. The API key ID and secret belong only in Vercel Environment Variables. The attached file contains a live-mode key; live transactions can charge real money. Use Razorpay Test Mode keys first.

Create an Upstash Redis database and copy its REST URL and REST token. In Vercel Project Settings → Environment Variables, add:

- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- BOOKING_ADMIN_TOKEN (generate a long random value and keep it private)
- SITE_URL (the exact HTTPS production domain assigned to this Vercel project)

For testing, put test-mode Razorpay credentials in Vercel Preview variables. Create a webhook in Razorpay Test Mode with URL https://YOUR-DOMAIN/api/razorpay-webhook, subscribe to payment_link.paid, and set a separate webhook secret. Put that same webhook secret in Vercel Preview variables, then redeploy.

Test a complete booking in Preview before accepting live payments. Check the customer confirmation page and /admin.html. After Razorpay approves international payments for this account, configure separate Production variables with live credentials and the corresponding live-mode webhook secret, then redeploy. GBP collection depends on Razorpay enabling international payments for this account. Never paste a key secret into site code, HTML, GitHub, or a customer-facing page.

## Vercel

Import the repository with the Other framework preset, an empty build command, and the project root as the output directory. Vercel detects functions in api/ and serves static pages from the repository root.
