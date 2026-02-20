# ⚡ Quick Start Stripe

Setup rapido in 5 minuti.

## 1️⃣ Stripe Dashboard (2 min)

```bash
1. Vai su https://dashboard.stripe.com/products
2. Crea prodotto "PRO" → $49/month → Copia Price ID
3. Crea prodotto "ENTERPRISE" → $299/month → Copia Price ID
4. Vai su https://dashboard.stripe.com/webhooks
5. Aggiungi endpoint: http://localhost:3000/billing/webhook
6. Seleziona eventi:
   - customer.subscription.*
   - checkout.session.completed
7. Copia Webhook Secret
```

## 2️⃣ Update .env (1 min)

```bash
cd /home/pserena/workspace/sports-intelligence-backend

# Aggiungi nel .env:
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ENTERPRISE=price_...
FRONTEND_URL=http://localhost:4200
```

## 3️⃣ Test (2 min)

```bash
# Terminal 1: Backend
npm run start:dev

# Terminal 2: Stripe CLI (opzionale per test locale)
stripe listen --forward-to localhost:3000/billing/webhook

# Test dal frontend
# Vai su Settings → Upgrade Plan → Checkout
# Carta test: 4242 4242 4242 4242
```

## ✅ Done!

Il sistema ora:
- ✅ Crea utente + org FREE al primo login
- ✅ Permette upgrade a PRO/ENTERPRISE
- ✅ Gestisce webhook Stripe automaticamente
- ✅ Aggiorna subscription nel DB

---

**Next:** Leggi [06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md) per setup production
