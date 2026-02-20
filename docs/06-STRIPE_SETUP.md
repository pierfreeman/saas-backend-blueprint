# 🎯 Stripe Setup Guide

Complete guide to configure Stripe with Sports Intelligence.

## 📋 Step 1: Create Products in Stripe Dashboard

Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)

### PRO Product

```
Name: Sports Intelligence - PRO
Description: Professional plan with unlimited members and 100GB storage
Type: Recurring (Subscription)
```

**Price:**
- Monthly: `$49/month`
- Billing period: Monthly
- Copy the **Price ID** (e.g., `price_1ABC...`)

### ENTERPRISE Product

```
Name: Sports Intelligence - ENTERPRISE
Description: Enterprise plan with unlimited everything and priority support
Type: Recurring (Subscription)
```

**Price:**
- Monthly: `$299/month` (or custom pricing)
- Billing period: Monthly
- Copy the **Price ID** (e.g., `price_2XYZ...`)

---

## 🔔 Step 2: Configure Webhook

Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)

### Endpoint Production

```
URL: https://api.yourdomain.com/billing/webhook
Description: Sports Intelligence Backend Webhook
```

### Events to Listen

Select these 4 events:

```
✅ customer.subscription.created
✅ customer.subscription.updated
✅ customer.subscription.deleted
✅ checkout.session.completed
```

**Copy the Signing Secret** (e.g., `whsec_...`)

---

## 🔧 Step 3: Update `.env`

Open `/home/pserena/workspace/sports-intelligence-backend/.env` and update:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...  # (already present)
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
STRIPE_PRICE_ID_PRO=price_YOUR_PRO_PRICE_ID_HERE
STRIPE_PRICE_ID_ENTERPRISE=price_YOUR_ENTERPRISE_PRICE_ID_HERE

# Frontend
FRONTEND_URL=http://localhost:4200
```

---

## 🧪 Step 4: Test Locally with Stripe CLI

### Install Stripe CLI

```bash
# macOS
brew install stripe/stripe-brew/stripe

# Linux
# See: https://stripe.com/docs/stripe-cli#install
```

### Login

```bash
stripe login
```

### Forward webhook events to your localhost

```bash
stripe listen --forward-to localhost:3000/billing/webhook
```

This command:
- Will give you a **temporary webhook signing secret** (e.g., `whsec_...`)
- Copy it to your `.env` as `STRIPE_WEBHOOK_SECRET`
- Will forward all Stripe events to your local backend

### Test checkout

```bash
# Start the backend
npm run start:dev

# In another terminal, start stripe listener
stripe listen --forward-to localhost:3000/billing/webhook

# In a third terminal, trigger a test event
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

---

## 📝 Step 5: Test Complete Flow

### Frontend calls checkout

```typescript
// Frontend (Angular)
const response = await this.apiService.post('/billing/organizations/{orgId}/checkout', {
  priceId: 'price_YOUR_PRO_PRICE_ID',
  successUrl: 'http://localhost:4200/billing/success',
  cancelUrl: 'http://localhost:4200/billing/cancel'
});

// Redirect user to Stripe Checkout
window.location.href = response.url;
```

### User completes payment

1. User enters test card: `4242 4242 4242 4242`
2. Stripe sends webhook `checkout.session.completed`
3. Backend updates subscription in DB
4. User is redirected to `successUrl`

---

## 🎯 Test Cards

```
✅ Success: 4242 4242 4242 4242
❌ Decline: 4000 0000 0000 0002
⏳ 3D Secure: 4000 0027 6000 3184
```

CVV: any 3 digits  
Expiry: any future date  
ZIP: any

---

## ✅ Verify Setup

Check that everything works:

```bash
# 1. Backend starts without errors
npm run start:dev

# 2. Stripe listener works
stripe listen --forward-to localhost:3000/billing/webhook

# 3. Create a checkout and complete payment
# Go to Stripe Dashboard → Events to see events
```

---

## 🚀 Deploy in Production

### Update Webhook URL

Cambia l'endpoint webhook su Stripe Dashboard:

```
Development: http://localhost:3000/billing/webhook
Production:  https://api.yourdomain.com/billing/webhook
```

### Update .env Production

```bash
STRIPE_SECRET_KEY=sk_live_...  # Use LIVE key!
STRIPE_WEBHOOK_SECRET=whsec_... # Use PRODUCTION webhook secret
FRONTEND_URL=https://app.yourdomain.com
```

---

## 📚 Resources

- [Stripe Testing](https://stripe.com/docs/testing)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Checkout Session](https://stripe.com/docs/api/checkout/sessions)
