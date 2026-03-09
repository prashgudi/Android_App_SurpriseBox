# SurpriseBox Android Web App (Step 1 MVP)

This project is a **hybrid Android web app** built from your PRD attachment.
It now implements customer MVP flow with **real backend API integration**.

## What is implemented now

- Android app shell using `WebView`
- Native launch splash with centered logo
- Local web app hosted from `app/src/main/assets/www`
- Onboarding (3 slides)
- Phone auth via backend APIs (`/auth/send-otp`, `/auth/verify-otp`)
- Home feed with:
  - radius filter
  - cuisine filter
  - sort (distance/price/rating)
  - backend fetch (`/listings`)
- Box details page
- Reservation confirmation bottom sheet
- Reservation creation via backend (`/reservations`)
- Reservation list and cancellation via backend (`GET /reservations`, `PUT /reservations/{id}/cancel`)
- JWT session persistence (`localStorage`)
- Configurable API base URL from login screen
- Live data sync polling every 30 seconds after login
- Updates feed screen with:
  - live updates toggle
  - WebSocket events toggle + URL configuration
  - pickup reminder toggle
  - WhatsApp reminder toggle
  - recent activity log (sign-in, reservation updates, listing updates)
- Pickup reminder scheduling (1 hour before pickup, when pickup date/time is available)
- Native Android local notifications for pickup reminders via WebView JS bridge
- Notification permission request flow (Android 13+)
- Reminder schedule persistence + auto-restore on app relaunch and device reboot
- FCM token fetch/sync support + Firebase messaging service for push delivery
- Partner mode login switch (Customer/Partner) on OTP screen
- Partner dashboard with today's summary
- Partner daily listing creation flow
- Partner reservations view with pickup confirmation action
- Reservation payment method selection (Cash/UPI) + payment status display
- Partner payment actions to mark Cash/UPI paid for reservations
- Partner ledger screen with gross sales, commission, payout, paid/pending split
- Customer support screen with:
  - post-pickup reservation ratings
  - complaint ticket submission
  - credit/refund request flag and local credit balance

## Project structure

- `app/src/main/java/in/surprisebox/app/MainActivity.kt` Android host app
- `app/src/main/assets/www/index.html` Web app shell
- `app/src/main/assets/www/styles.css` Web styles
- `app/src/main/assets/www/app.js` App logic + API integration

## How to run

  1. Open this folder in Android Studio.
  2. Let Gradle sync.
  3. Run app on emulator/device (`minSdk 24`).
4. On login screen, confirm/update API Base URL (default: `https://api.surprisebox.in/v1`).
   - If backend runs on your machine and app runs on Android emulator, use `http://10.0.2.2:<port>/v1` (not `localhost`).
   - If backend is unavailable, enable `Offline Mock OTP Mode` on login and use OTP `123456`.
5. Continue with OTP login and backend-driven flow.
6. For real FCM delivery, place `google-services.json` in `app/` (Gradle now auto-applies Google Services plugin only when this file exists).

## Pending backend wiring (for Step 3 completion)

- Push token persistence endpoint should accept one of the app fallbacks (`/users/{id}`, `/users/me`, or `/users/push-token`).
- Notification preferences endpoint should persist `push`, `pickupReminders`, and `whatsapp` preferences.
- Reservation reminder-channel endpoint should accept `push` and `whatsapp` channel flags.
- WhatsApp provider/template integration must be enabled on backend to actually send WhatsApp reminders.
- Reservation payment update endpoint should accept partner payment status updates.
- Partner ledger endpoint should return commission/payout report, or app will derive from reservation data.
- Rating endpoint should accept reservation rating submissions.
- Support/complaint endpoint should persist tickets and optional refund requests.
- Credits/refunds backend should return approved credit balances for customer accounts.

## Step-by-step roadmap from your PRD

## Step 2: Backend integration (Done)
- Real OTP auth wired
- Listings API wired
- Reservation create/list/cancel wired

## Step 3: Real-time + notifications (In Progress)
- Live listing/reservation refresh via polling (implemented)
- In-app activity feed and reminder preferences (implemented)
- WebSocket event integration with auto-reconnect (implemented)
- Native pickup reminder notifications (implemented)
- FCM push channel integration (implemented on app side)
- WhatsApp reminder channel API hook (implemented on app side)

## Step 4: Partner module
- Partner login with OTP mode switch (implemented)
- Daily listing creation flow (implemented)
- Partner reservations management with pickup confirmation (implemented)

## Step 5: Payments + ledger
- Cash/UPI status tracking (implemented)
- Commission and payout reports (implemented on app side)

## Step 6: Ratings + support flows
- Post-pickup ratings (implemented on app side)
- Complaint handling flow (implemented on app side)
- Credits/refunds logic (implemented on app side with backend fallback)
