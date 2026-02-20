# ⚡ Quick Start Auth0

Setup rapido in 5 minuti.

## 1️⃣ Auth0 Dashboard (3 min)

### Crea Application

```bash
1. Vai su https://manage.auth0.com/dashboard/applications
2. Create Application → Single Page Application
3. Nome: "Sports Intelligence"
4. Framework: Angular
5. Copia Domain e Client ID
```

### Configura URLs

```bash
Settings → Application URIs:

Allowed Callback URLs:
http://localhost:4200/auth/callback

Allowed Logout URLs:
http://localhost:4200,http://localhost:4200/login

Allowed Web Origins:
http://localhost:4200

→ Save Changes
```

### Crea API

```bash
1. Vai su https://manage.auth0.com/dashboard/apis
2. Create API
3. Nome: "Sports Intelligence API"
4. Identifier: https://api.sports-intelligence.com
5. Signing Algorithm: RS256
```

### Settings API

```bash
Settings:
✅ Enable RBAC
✅ Add Permissions in the Access Token

→ Save
```

---

## 2️⃣ Update Configs (1 min)

### Backend (.env)

```bash
cd /home/pserena/workspace/sports-intelligence-backend

# Aggiungi:
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.sports-intelligence.com
```

### Frontend (environment.ts)

```typescript
// /home/pserena/workspace/sports-intelligence-frontend/apps/shell/src/environments/environment.ts

auth0: {
  domain: 'your-tenant.auth0.com',
  clientId: 'YOUR_CLIENT_ID',
  audience: 'https://api.sports-intelligence.com',
  redirectUri: 'http://localhost:4200/auth/callback',
}
```

---

## 3️⃣ Crea Test User (30 sec)

```bash
1. Vai su https://manage.auth0.com/dashboard/users
2. Create User
3. Email: test@example.com
4. Password: Test123!@#
5. Connection: Username-Password-Authentication
6. ✅ Email Verified
```

---

## 4️⃣ Test (30 sec)

```bash
# Terminal 1: Backend
cd /home/pserena/workspace/sports-intelligence-backend
npm run start:dev

# Terminal 2: Frontend
cd /home/pserena/workspace/sports-intelligence-frontend
npm start

# Browser
http://localhost:4200 → Login → test@example.com
```

---

## ✅ Done!

Il sistema ora:
- ✅ Autentica utenti via Auth0
- ✅ Protegge API con JWT
- ✅ Crea automaticamente user + org FREE al primo login
- ✅ Valida token server-side

---

## 🔐 Bonus: Custom Claims (Opzionale)

Per aggiungere ruoli/permissions nel token:

```bash
1. Vai su https://manage.auth0.com/dashboard/actions/flows
2. Seleziona "Login" flow
3. Click "+ (Custom)" → Build Custom
4. Nome: "Add Custom Claims"
5. Copia code da 05-AUTH0_SETUP.md Step 3
6. Deploy → Drag nell flow
```

---

**Next:** Leggi [05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md) per:
- MFA setup
- Social connections
- Production deployment
- Security best practices
