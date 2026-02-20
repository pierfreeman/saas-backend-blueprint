# Auth0 Setup Guide

Complete guide to configure Auth0 with Sports Intelligence.

## Step 1: Create Application in Auth0 Dashboard

Go to [Auth0 Dashboard → Applications](https://manage.auth0.com/dashboard/applications)

### Create Single Page Application

```
Name: Sports Intelligence (Development)
Type: Single Page Application
Technology: Angular
```

**Copy credentials:**
- Domain: `your-tenant.auth0.com`
- Client ID: `abc123...`

### Configure Application Settings

Scroll down and configure URLs:

**Allowed Callback URLs:**
```
http://localhost:4200/auth/callback,
https://app.yourdomain.com/auth/callback
```

**Allowed Logout URLs:**
```
http://localhost:4200,
http://localhost:4200/login,
https://app.yourdomain.com,
https://app.yourdomain.com/login
```

**Allowed Web Origins:**
```
http://localhost:4200,
https://app.yourdomain.com
```

**Allowed Origins (CORS):**
```
http://localhost:4200,
https://app.yourdomain.com
```

Click **Save Changes**.

---

## Step 2: Create and Configure API

Go to [Auth0 Dashboard → APIs](https://manage.auth0.com/dashboard/apis)

### Create New API

```
Name: Sports Intelligence API
Identifier (Audience): https://api.sports-intelligence.com
Signing Algorithm: RS256
```

**IMPORTANT:** The Identifier becomes your `audience` - use it consistently.

### Enable RBAC

In API **Settings**:

```
Enable RBAC
Add Permissions in the Access Token
```

### Define Permissions (Optional)

Go to **Permissions** tab:

```
read:organizations  - Read organization data
write:organizations - Create/update organizations
manage:teams        - Manage teams
admin:all          - Full admin access
```

Click **Save**.

---

## Step 3: Configure User Metadata with Actions

Go to [Auth0 Dashboard → Actions → Flows](https://manage.auth0.com/dashboard/actions/flows)

### Create Action for Custom Claims

1. Select **Login** flow
2. Click **+ (Custom)** → **Build Custom**

**Name:** Add Custom Claims  
**Trigger:** Login / Post Login  

**Code:**

```javascript
/**
* Handler that will be called during the execution of a PostLogin flow.
*
* @param {Event} event - Details about the user and the context in which they are logging in.
* @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
*/
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://sports-intelligence.com';
  
  // Add user metadata to token
  if (event.authorization) {
    // Add roles (if you use Authorization Extension or custom roles)
    if (event.authorization.roles) {
      api.idToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);
      api.accessToken.setCustomClaim(`${namespace}/roles`, event.authorization.roles);
    }
    
    // Add permissions
    if (event.authorization.permissions) {
      api.idToken.setCustomClaim(`${namespace}/permissions`, event.authorization.permissions);
      api.accessToken.setCustomClaim(`${namespace}/permissions`, event.authorization.permissions);
    }
  }
  
  // Add user metadata
  if (event.user.user_metadata) {
    api.idToken.setCustomClaim(`${namespace}/user_metadata`, event.user.user_metadata);
  }
  
  // Add app metadata
  if (event.user.app_metadata) {
    api.idToken.setCustomClaim(`${namespace}/app_metadata`, event.user.app_metadata);
  }
};
```

**Deploy** the action and then **Add to Flow** (drag & drop in Login flow).

---

## Step 4: Update `.env` Files

### Backend (.env)

```bash
# Auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.sports-intelligence.com
```

### Frontend (environment.ts)

```typescript
export const environment = {
  // ...
  auth0: {
    domain: 'your-tenant.auth0.com',
    clientId: 'YOUR_CLIENT_ID',
    audience: 'https://api.sports-intelligence.com',
    redirectUri: 'http://localhost:4200/auth/callback',
  },
};
```

---

## 👥 Step 5: Crea Test Users

Vai su [Auth0 Dashboard → User Management → Users](https://manage.auth0.com/dashboard/users)

### Crea utente di test

```
Email: test@example.com
Password: Test123!@#
Connection: Username-Password-Authentication
Email verified: ✅ Yes
```

### Assegna Ruoli (Opzionale)

Se hai configurato ruoli:
1. Click sull'utente
2. Vai su **Roles** tab
3. Assign role (es. "Admin", "User")

---

## 🧪 Step 6: Test Flow di Autenticazione

### Test Login Locale

```bash
# 1. Avvia backend
cd /home/pserena/workspace/sports-intelligence-backend
npm run start:dev

# 2. Avvia frontend
cd /home/pserena/workspace/sports-intelligence-frontend
npm start

# 3. Browser
# Vai su http://localhost:4200
# Click "Login"
# Usa credenziali test user
# Verifica redirect a /auth/callback
# Verifica token in localStorage
```

### Debug Token

Usa [jwt.io](https://jwt.io) per decodificare il token:

```javascript
// In browser console
localStorage.getItem('@@auth0spajs@@::YOUR_CLIENT_ID::https://api.sports-intelligence.com::openid profile email offline_access')
```

Verifica che il token contenga:
- ✅ `sub` (user ID)
- ✅ `email`
- ✅ `aud` (audience match)
- ✅ Custom claims (namespace)

---

## 🔒 Step 7: Configurazioni Avanzate

### Password Policy

Vai su [Dashboard → Security → Authentication](https://manage.auth0.com/dashboard/security/authentication)

**Database Connections → Username-Password-Authentication:**

```
Password Strength: Fair (o Good/Excellent)
Password History: Enabled (5 passwords)
Password Dictionary: Enabled
Brute Force Protection: Enabled
```

### Multi-Factor Authentication (MFA)

Vai su [Dashboard → Security → Multi-factor Auth](https://manage.auth0.com/dashboard/security/mfa)

```
✅ Push Notification via Auth0 Guardian
✅ SMS
✅ Time-based One-time Password (TOTP)
```

**Policy:** Optional (o Required per production)

### Social Connections (Opzionale)

Vai su [Dashboard → Authentication → Social](https://manage.auth0.com/dashboard/connections/social)

Abilita provider che vuoi:
- Google
- GitHub
- Microsoft
- LinkedIn

Per ognuno, configura:
1. Client ID & Secret dal provider
2. Scopes richiesti
3. Attributi da mappare

---

## 🚨 Troubleshooting

### Errore: "Invalid audience"

**Causa:** Audience mismatch tra frontend, backend e Auth0 API.

**Fix:**
1. Verifica che l'audience sia uguale in tutti e 3 i posti
2. Audience deve matchare esattamente l'API Identifier in Auth0

### Errore: "Callback URL mismatch"

**Causa:** URL di callback non configurato in Auth0.

**Fix:**
1. Vai su Application Settings
2. Aggiungi URL esatto in "Allowed Callback URLs"
3. Include protocollo (http/https) e porta

### Errore: "Missing required scopes"

**Causa:** Scopes non richiesti durante login.

**Fix:**
```typescript
// Nel frontend, verifica authorizationParams
authorizationParams: {
  redirect_uri: '...',
  audience: '...',
  scope: 'openid profile email offline_access'
}
```

### Token non contiene custom claims

**Causa:** Action non configurata o non aggiunta al flow.

**Fix:**
1. Verifica che l'Action sia deployed
2. Verifica che sia aggiunta al Login flow (drag & drop)
3. Test login con nuovo utente

---

## 🌍 Step 8: Multi-Tenancy (Opzionale)

Se vuoi isolare development e production:

### Crea Tenant Separati

1. **Development Tenant:** `dev-yourapp.auth0.com`
2. **Production Tenant:** `yourapp.auth0.com`

Per ogni tenant, ripeti Step 1-4.

### Oppure: Usa Environment Tag

In un singolo tenant:
- App: "Sports Intelligence (Dev)" vs "Sports Intelligence (Prod)"
- API: Stesso identifier, gestisci via environment variables

---

## 🚀 Deploy in Production

### Checklist Production

- [ ] Crea production application in Auth0
- [ ] Update Callback URLs con dominio production
- [ ] Update Logout URLs con dominio production  
- [ ] Abilita MFA (almeno optional)
- [ ] Configura password policy forte
- [ ] Test SSO flow completo
- [ ] Monitor logs in Auth0 Dashboard
- [ ] Setup alerts per failed logins

### Update Environment Variables

**Backend (.env.production):**
```bash
AUTH0_DOMAIN=yourapp.auth0.com
AUTH0_AUDIENCE=https://api.sports-intelligence.com
```

**Frontend (environment.production.ts):**
```typescript
auth0: {
  domain: 'yourapp.auth0.com',
  clientId: 'PROD_CLIENT_ID',
  audience: 'https://api.sports-intelligence.com',
  redirectUri: 'https://app.yourdomain.com/auth/callback',
}
```

---

## 📊 Monitoring & Analytics

### Auth0 Dashboard Logs

Vai su [Dashboard → Monitoring → Logs](https://manage.auth0.com/dashboard/logs)

**Eventi da monitorare:**
- `s` (Success Login) ✅
- `f` (Failed Login) ❌
- `fu` (Failed Login (wrong password))
- `limit_wc` (Blocked by brute force protection)

### Log Streams (Advanced)

Setup log streaming verso:
- Datadog
- Splunk
- AWS EventBridge
- Custom Webhook

---

## 📚 Risorse

- [Auth0 Angular SDK](https://github.com/auth0/auth0-angular)
- [Auth0 NestJS](https://github.com/auth0-samples/auth0-nestjs-sample)
- [Auth0 Actions](https://auth0.com/docs/customize/actions)
- [JWT Claims](https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-token-claims)
- [RBAC](https://auth0.com/docs/manage-users/access-control/rbac)

---

## 🔐 Security Best Practices

1. **Never commit secrets** - Use environment variables
2. **Enable HTTPS** in production
3. **Validate tokens** server-side with `jwks-rsa`
4. **Use refresh tokens** for long sessions
5. **Implement CSRF protection**
6. **Enable anomaly detection** in Auth0
7. **Regular security audits** via Auth0 logs
8. **Use Auth0 Guardian** for MFA
9. **Implement rate limiting** on auth endpoints
10. **Keep Auth0 SDK updated**
