# FindMyGuide

FindMyGuide is a two-sided nature-guide marketplace with separate traveler, guide, and platform-admin experiences. The application now runs through a Node.js API backed by SQLite.

## Run locally

Node.js 24 or newer is required because the backend uses the built-in `node:sqlite` module.

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

The SQLite database is created automatically at `data/findmyguide.sqlite` and seeded on first startup.

## Project structure

```text
FindmyGuide/
├── frontend/
│   └── public/              # HTML, CSS, and browser-side JavaScript
├── backend/
│   ├── server.mjs           # HTTP entry point and static frontend serving
│   ├── database/
│   │   └── database.mjs     # SQLite schema, migrations, seed data, auth hashing
│   ├── routes/
│   │   ├── context.mjs      # Shared request, session, response, and DTO helpers
│   │   └── index.mjs        # API route registry and handlers
│   └── tests/
│       └── api.test.mjs     # End-to-end API integration tests
├── data/                    # Runtime SQLite files; excluded from Git
├── package.json
└── README.md
```

Public URLs remain unchanged. The backend serves assets from `frontend/public` and handles all `/api/*` requests through `backend/routes`.

## Seeded development accounts

| Role | Email | Password |
| --- | --- | --- |
| Traveler | `traveler@example.com` | `Traveler123!` |
| Guide | `guide@findmyguide.in` | `Guide123!` |
| Platform admin | `admin@findmyguide.in` | `Admin123!` |

## Backend capabilities

- Scrypt password hashing
- HTTP-only, SameSite session cookies
- Traveler, guide, and admin role authorization
- Traveler registration and profile persistence
- Admin-issued guide invitations, applications, approval, and secure account activation
- Searchable approved guide directory
- Public calendars that expose only guide-opened dates
- Guide-issued client invitations with open and conversion tracking
- 24-hour request-to-book flow; dates are blocked atomically only when the guide accepts
- Traveler request history with withdrawal before guide acceptance
- Direct-with-guide payment records (deposit, paid in full, or pay on arrival); no payment gateway
- Admin booking operations view for pending requests, invited-client attribution, confirmed trips, and payment notes
- Admin directories for guides, all user roles, booking requests, confirmed bookings, and verified reviews
- Global cross-directory search, entity-specific filters, pagination metadata, and full-record drill-down
- Traveler and guide booking lists
- Completed-booking-only verified reviews
- Rating aggregation after review publication

## Main API groups

- `/api/auth/*` — registration, login, logout, session
- `/api/guides/*` — guide discovery, details, reviews, availability
- `/api/guide-applications`, `/api/guide-onboarding/*` — invited guide onboarding and activation
- `/api/admin/*` — dashboard, invitations, applications, and approval decisions
- `/api/traveler/*` — traveler profile and bookings
- `/api/guide/*` — client invitations, requests, bookings, availability, and direct-payment records
- `/api/booking-requests` — traveler requests awaiting guide acceptance
- `/api/reviews` — verified reviews

`POST /api/bookings` and `/api/payments/*` intentionally return `410 Gone`: instant confirmation and in-app checkout are outside the starting-phase operating model.

## Verification

```bash
npm run build
npm test
```

The integration suite uses a temporary isolated SQLite database and verifies discovery, authentication, invitations, request-to-book conflicts, guide acceptance, direct-payment records, review eligibility, admin approval, and guide activation.

## Production follow-ups

- Connect email/WhatsApp delivery providers to the invitation and booking-notification outbox.
- Store uploads in object storage using signed upload URLs and malware scanning.
- Add email/OTP verification, password reset, CSRF tokens, rate limiting, and audit logs.
- Move secrets and deployment configuration to environment variables.
