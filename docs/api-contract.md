# SurpriseBox API Contract (Draft v0.1)

This document freezes the backend contract used by the current app. It is the source of truth for roles, endpoints, and payloads. Update only with explicit version bumps.

## Roles
- customer
- partner
- admin

## Auth
- OTP login returns token plus role.
- Role must be enforced server-side on all routes.

Endpoints:
- POST /auth/send-otp
  - request: { phone }
  - response: { verificationId }
- POST /auth/verify-otp
  - request: { phone, otp, verificationId }
  - response: { token, user }

User object:
- id
- name
- phone
- role: customer | partner | admin
- restaurantId (optional, for partners)

## Listings
Endpoints:
- GET /listings
  - query: lat, lon, radius, cuisine, sortBy
  - response: { listings: Listing[] }
- GET /listings/{id}
  - response: { listing }
- POST /partners/listings (partner)
  - request: { quantity, price, pickupStartTime, pickupEndTime, description }
  - response: { listing }

Listing fields:
- id
- restaurant { id, name, address, cuisineTypes, distance }
- price
- regularValue
- quantityAvailable
- pickupDate, pickupStartTime, pickupEndTime
- description
- allergens

## Reservations
Statuses:
- reserved
- confirmed
- picked_up
- completed
- cancelled
- refunded

Endpoints:
- GET /reservations
  - query: page, limit
  - response: { reservations: Reservation[] }
- POST /reservations
  - request: { listingId, paymentMethod }
  - response: { reservation }
- PUT /reservations/{id}/cancel
  - response: { reservation }
- POST /reservations/{id}/rating
  - request: { reservationId, stars, comment }
  - response: { rating }

Reservation fields:
- id
- code
- listingId
- restaurant { id, name, address }
- price
- quantity
- pickupDate, pickupStartTime, pickupEndTime
- status
- createdAt
- payment { method, status, amount, reference, paidAt }

## Partner Reservations
Endpoints:
- GET /partners/reservations
  - query: status, page, limit
  - response: { reservations: PartnerReservation[] }
- PUT /partners/reservations/{id}/pickup
  - response: { reservation }
- PUT /partners/reservations/{id}/payment
  - request: { paymentMethod, paymentStatus, paymentReference }
  - response: { reservation }

PartnerReservation fields:
- id
- code
- customer { id, name, phone }
- listing { id, description, pickupDate, pickupStartTime, pickupEndTime, price }
- quantity
- status
- createdAt
- payment { method, status, amount, reference, paidAt }

## Partner Dashboard
Endpoints:
- GET /partners/dashboard
  - response: { dashboard }

Dashboard fields:
- restaurant { id, name, address }
- summary { boxesListed, boxesSold, pickedUp, pending, revenue }

## Partner Ledger
Endpoints:
- GET /partners/ledger
  - query: range (today | week | month)
  - response: { ledger }

Ledger fields:
- summary { gross, commission, payout, paidGross, pendingGross, cashPaid, upiPaid }
- settlements: [ { reservationId, code, amount, paymentMethod, paymentStatus, createdAt } ]

## Notification Preferences
Endpoints:
- PUT /users/me
  - request: { notifications: { push, pickupReminders, whatsapp } }
  - response: { user }

## Push Token
Endpoints:
- PUT /users/me
  - request: { fcmToken }
  - response: { user }

## Reminder Channels
Endpoints:
- POST /reservations/{id}/reminders
  - request: { push, whatsapp }
  - response: { ok: true }

## Support
Endpoints:
- POST /support/tickets
  - request: { reservationId, message, refundRequested }
  - response: { ticket }
- GET /support/summary
  - response: { credits, tickets, ratings }

Ticket fields:
- id
- code
- reservationId
- message
- status
- refundRequested
- creditIssued
- createdAt

## Admin Partner Approval
Endpoints:
- GET /admin/partners
  - response: { partners: PartnerApplication[] }
- PUT /admin/partners/{id}
  - request: { status, commissionRate, payoutCycle, zone }
  - response: { partner }

PartnerApplication fields:
- id
- restaurantName
- phone
- address
- status: submitted | under_review | approved | live | rejected | suspended
- commissionRate
- payoutCycle
- zone
- createdAt

## Partner Application (Public)
Endpoints:
- POST /partners/applications
  - request: { restaurantName, ownerName, phone, email, address, city, fssai, payoutUpi }
  - response: { application }
 - POST /uploads/presign
   - request: { fileName, contentType, docType }
   - response: { uploadUrl, fileUrl }

Application fields:
- id
- restaurantName
- ownerName
- phone
- email
- address
- city
- fssai
- payoutUpi
- status: submitted | under_review | approved | live | rejected | suspended
- documents (optional) [ { type, name, size, url, status } ]
- createdAt

## Response Rules
- All error responses must include: { message }
- All timestamps are ISO 8601 strings in UTC
