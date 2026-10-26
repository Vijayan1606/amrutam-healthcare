# Amrutam Healthcare Backend

## Overview

A production‑grade, modular monolithic backend for the **Amrutam Healthcare Platform**. It provides a full‑stack appointment and consultation management system built with:

- **Node.js** (v22) + **TypeScript**
- **Express.js** for the HTTP API
- **Prisma ORM** with PostgreSQL (hosted on Supabase)
- **Argon2id** for password hashing
- **JWT** (access + refresh) with refresh‑token rotation & family revocation
- **Pino** structured logging & observability
- **Rate limiting**, **Helmet**, **CORS**, and a comprehensive **RBAC** model
- **Docker** multi‑stage build and **docker‑compose** for local development
- **GitHub Actions** CI pipeline (lint, type‑check, unit/integration/security tests, Docker build, vulnerability audit)
- **Comprehensive test suite** (unit, integration, security) using Jest & Supertest

The codebase follows clean architecture principles: services contain business logic, routes handle HTTP concerns, and infrastructure (database, email, payments) is abstracted behind interfaces.

---

## Architecture Diagram

```mermaid
flowchart LR
    subgraph API[Express API]
        A[Auth] --> B[Users]
        C[Doctors] --> D[Availability]
        E[Consultations] --> F[Payments]
        G[Prescriptions]
    end
    subgraph DB[Supabase PostgreSQL]
        DB1[(User)]
        DB2[(Doctor)]
        DB3[(AvailabilitySlot)]
        DB4[(Consultation)]
        DB5[(Payment)]
        DB6[(Prescription)]
        DB7[(RefreshToken)]
        DB8[(IdempotencyKey)]
        DB9[(AuditLog)]
    end
    API --> DB
    style API fill:#0e639c,color:#fff,stroke:#333
    style DB fill:#1e4d2b,color:#fff,stroke:#333
```

---

## Getting Started

### Prerequisites
- **Node.js** (v22) – `nvm use 22` or install from <https://nodejs.org>
- **Docker Desktop** (optional, for containerised dev)
- **Supabase account** – create a project and obtain the URL, anon key, and service‑role key.

### Environment configuration
Create a `.env` file at the project root (a template is provided in `.env.example`). The required variables are:

```env
# Server
PORT=3000
API_BASE_URL=http://localhost:3000

# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# Prisma (server‑side DB connection)
DATABASE_URL=postgresql://postgres:${SUPABASE_SERVICE_ROLE_KEY}@db.<project>.supabase.co:5432/postgres

# JWT & security
JWT_ACCESS_SECRET=dev-access-secret-min-32-chars-long
JWT_REFRESH_SECRET=dev-refresh-secret-min-32-chars-long
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=amrutam-healthcare
JWT_AUDIENCE=amrutam-clients

# Misc
ENCRYPTION_KEY=dev-encryption-key-32-chars-long
PAYMENT_PROVIDER=dev
EMAIL_PROVIDER=console
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

> **Never commit the real `.env`** – it is already listed in `.gitignore`.

### Install dependencies
```bash
npm ci
```

### Database migration (Supabase)
```bash
npx prisma migrate deploy   # creates tables, enums, constraints
```

### Generate Prisma client (after any schema change)
```bash
npx prisma generate
```

### Seed development data (optional)
```bash
node prisma/seed.ts
```

### Run the server (development mode)
```bash
npm run dev
```
The API will be reachable at `http://localhost:3000/api/v1/`.

### Health checks
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

---

## Testing

```bash
# Unit tests
npm run test:unit

# Integration tests (run against Supabase)
npm run test:integration

# Security tests (IDOR, JWT attacks, webhook verification)
npm run test:security

# Full test suite with coverage
npm run test:coverage
```
All tests run in CI using a PostgreSQL service container. The CI workflow is defined in `.github/workflows/ci.yml`.

---

## Docker

### Build the production image
```bash
docker build -t amrutam-backend .
```

### Run with Docker Compose (PostgreSQL + API)
```bash
docker compose up -d
```
The compose file uses the Supabase connection string, so you can replace it with a local PostgreSQL instance if you prefer.

---

## CI / CD

The repository includes a GitHub Actions workflow that performs:
1. **Lint & format checks**
2. **TypeScript type‑checking**
3. **Unit, integration, and security tests**
4. **Docker build**
5. **Dependency vulnerability audit** (`npm audit`) and secret scanning (`trufflehog`).

Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) must be added to the repository settings under **Settings → Secrets → Actions**.

---

## Security Highlights
- **Argon2id** password hashing with high memory & time cost.
- **Refresh‑token rotation** with SHA‑256 hashing and family revocation to prevent replay attacks.
- **Idempotency keys** for booking and payment endpoints to guarantee exactly‑once semantics.
- **Helmet**, **CORS**, and **rate limiting** (global + strict auth limits).
- **AuditLog** service records critical actions with immutable timestamps.
- **No sensitive data** is ever returned in error responses; Pino redacts passwords, tokens, and clinical notes.

## License

MIT License – feel free to modify, extend, and ship the code.

---

## Contact

For questions or feedback, open an issue or reach out to the maintainer at `dev@amrutam.test`.
