# Setup Checklist

Use this checklist to complete the setup.

## Prerequisites

- [ ] Node.js 20+ installed
- [ ] PostgreSQL 16+ installed and running
- [ ] Redis 7+ installed and running
- [ ] Auth0 account created (free tier)
- [ ] Stripe account created (test mode)

---

## Auth0 Setup

### Dashboard

- [ ] Application "Sports Intelligence" created (SPA)
- [ ] Domain and Client ID copied
- [ ] Callback URLs configured:
  - [ ] `http://localhost:4200/auth/callback`
  - [ ] Production URL (if applicable)
- [ ] Logout URLs configured
- [ ] Web Origins configured
- [ ] API "Sports Intelligence API" created
- [ ] API Identifier configured: `https://api.sports-intelligence.com`
- [ ] RBAC enabled in API
- [ ] Test user created (`test@example.com`)

### Optional (Recommended)

- [ ] Custom Claims Action created and deployed
- [ ] Action added to Login flow
- [ ] Password policy configured (Fair+)
- [ ] Brute force protection enabled

### Configuration Files

- [ ] Backend `.env` updated with:
  - [ ] `AUTH0_DOMAIN`
  - [ ] `AUTH0_AUDIENCE`
- [ ] Frontend `environment.ts` updated with:
  - [ ] `auth0.domain`
  - [ ] `auth0.clientId`
  - [ ] `auth0.audience`
  - [ ] `auth0.redirectUri`

---

## Stripe Setup

### Dashboard

- [ ] Product "PRO" created ($49/month)
  - [ ] Price ID copied
- [ ] Product "ENTERPRISE" created ($299/month)
  - [ ] Price ID copied
- [ ] Webhook endpoint created
  - [ ] URL: `http://localhost:3000/billing/webhook`
  - [ ] Events selected:
    - [ ] `customer.subscription.created`
    - [ ] `customer.subscription.updated`
    - [ ] `customer.subscription.deleted`
    - [ ] `checkout.session.completed`
  - [ ] Webhook Secret copied

### Configuration Files

- [ ] Backend `.env` updated with:
  - [ ] `STRIPE_SECRET_KEY` (already present)
  - [ ] `STRIPE_WEBHOOK_SECRET`
  - [ ] `STRIPE_PRICE_ID_PRO`
  - [ ] `STRIPE_PRICE_ID_ENTERPRISE`
  - [ ] `FRONTEND_URL`
- [ ] Frontend `environment.ts` updated with:
  - [ ] `stripe.priceIdPro`
  - [ ] `stripe.priceIdEnterprise`

---

## Database Setup

- [ ] PostgreSQL database created: `sports_intelligence`
- [ ] Database URL configured in `.env`
- [ ] Prisma Client generated: `npm run prisma:generate`
- [ ] Migration executed: `npm run prisma:migrate`
- [ ] Verified tables created (Prisma Studio or psql)

---

## Application Setup

### Backend

- [ ] Dependencies installed: `npm install`
- [ ] File `.env` configured correctly
- [ ] Security env values configured:
  - [ ] `RATE_LIMIT_REQUESTS`
  - [ ] `RATE_LIMIT_WINDOW_MS`
  - [ ] `RATE_LIMIT_BURST`
  - [ ] `BRUTE_FORCE_MAX_ATTEMPTS`
  - [ ] `BRUTE_FORCE_BLOCK_MS`
  - [ ] `MAX_BODY_SIZE`
  - [ ] `SECURITY_HEADERS_ENABLED`
  - [ ] `CSRF_PROTECTION_ENABLED`
  - [ ] `SECURITY_AUTO_THROTTLE_ENABLED`
  - [ ] `SUSPICIOUS_SCORE_THRESHOLD`
- [ ] Backend starts without errors: `npm run start:dev`
- [ ] Swagger docs accessible: `http://localhost:3000/docs`
- [ ] Health check passes: `http://localhost:3000/health`

### Frontend

- [ ] Dependencies installed: `npm install`
- [ ] File `environment.ts` configured
- [ ] Frontend starts without errors: `npm start`
- [ ] App accessible: `http://localhost:4200`

---

## Testing

### Auth Flow

- [ ] Login page accessible
- [ ] Click "Login" redirects to Auth0
- [ ] Login with test user (`test@example.com`)
- [ ] Redirect to callback URL
- [ ] User authenticated and logged in
- [ ] Token present in localStorage
- [ ] Backend automatically creates:
  - [ ] User in database
  - [ ] Organization "Personal Workspace"
  - [ ] Membership with OWNER role
  - [ ] FREE subscription

### Billing Flow

- [ ] Navigate to Settings page
- [ ] "Upgrade Plan" button visible
- [ ] Click opens Stripe Checkout
- [ ] Enter test card: `4242 4242 4242 4242`
- [ ] Checkout completed successfully
- [ ] Redirect to success URL
- [ ] Subscription updated to PRO in database
- [ ] Verify event received in Stripe Dashboard

### API Endpoints

- [ ] `GET /auth/me` returns user data
- [ ] `GET /organizations` returns user organizations
- [ ] `GET /organizations/{id}` returns org details
- [ ] `GET /memberships/organization/{orgId}` returns members
- [ ] Other endpoints tested as needed

### Security Validation

- [ ] Rate limit triggers `429` after configured threshold
- [ ] Repeated failed login attempts trigger temporary `429` block
- [ ] Payload with suspicious NoSQL operator (`$where`) returns `400`
- [ ] Cookie-based state-changing request without valid CSRF token returns `403`
- [ ] Oversized request body returns `413`
- [ ] Response headers include CSP, HSTS, X-Frame-Options, X-XSS-Protection, X-Content-Type-Options
- [ ] Security events are emitted and visible in audit logs (`security.blocked`, `security.suspicious`)

---

## Optional Advanced Setup

### Stripe CLI (for local webhook testing)

- [ ] Stripe CLI installed
- [ ] Login executed: `stripe login`
- [ ] Listener started: `stripe listen --forward-to localhost:3000/billing/webhook`
- [ ] Test event triggered: `stripe trigger checkout.session.completed`

### Auth0 MFA

- [ ] MFA enabled in Auth0 Dashboard
- [ ] Policy configured (optional/required)
- [ ] Test with MFA works

### Social Connections

- [ ] Google connection configured (optional)
- [ ] GitHub connection configured (optional)
- [ ] Social login test works

### Monitoring

- [ ] Auth0 logs monitored
- [ ] Stripe events dashboard checked
- [ ] Backend logs working correctly
- [ ] Security blocked/suspicious events monitored

---

## Production Checklist (when ready)

- [ ] Production Auth0 tenant/application created
- [ ] Production Stripe products created
- [ ] Production webhook configured with public URL
- [ ] Production environment variables configured
- [ ] Production database setup and secured
- [ ] Production Redis setup
- [ ] HTTPS enabled
- [ ] Domain setup (API and Frontend)
- [ ] Monitoring and alerting configured
- [ ] Database backup configured
- [ ] CI/CD pipeline setup
- [ ] Rate limiting tested
- [ ] Security audit completed

---

## Done!

When all items above are checked, your system is ready for:

- Secure user authentication
- Auto-provisioning FREE org
- Subscription upgrade
- Multi-tenancy
- Team collaboration
- Billing automation
- API security middleware protections

**Congratulations!**

---

## Docs Reference

- [03-QUICK_START_AUTH0.md](./03-QUICK_START_AUTH0.md)
- [04-QUICK_START_STRIPE.md](./04-QUICK_START_STRIPE.md)
- [05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md)
- [06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md)
- [27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md)
- [00-INDEX.md](./00-INDEX.md)
