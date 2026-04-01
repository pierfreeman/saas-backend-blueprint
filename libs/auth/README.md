# Auth — Auth0 Setup Guide

This guide covers the full Auth0 configuration required for the flows already
implemented in this codebase:

- **Self-signup & login** via Passwordless OTP or Google social login
- **Email invite** — user is pre-created in Prisma as `pending:`, logs in at
  their own pace, and the backend links the real Auth0 `sub` on first login
- **Account linking** via a Post-Login Action, with a backend fallback in
  `AuthService.syncUser` when the Action fails silently

---

## Prerequisites

- An [Auth0](https://auth0.com) account
- A Google Cloud project with OAuth credentials (for the Google social connection)

---

## Step 1 — Create the Tenant

1. Auth0 Dashboard → **Create Tenant**
2. Choose a meaningful **Tenant Domain** (e.g. `yourapp-dev`)
3. Pick the **Region** closest to your users (e.g. EU)

Your tenant domain will be: `yourapp-dev.eu.auth0.com`

---

## Step 2 — Register the Custom API (backend audience)

**Applications → APIs → Create API**

| Field                 | Value                        |
| --------------------- | ---------------------------- |
| **Name**              | SaaS API                     |
| **Identifier**        | `https://api.yourdomain.com` |
| **Signing Algorithm** | RS256                        |

This identifier becomes `AUTH0_AUDIENCE` in the backend **and** `auth0Audience`
in the frontend. They must match exactly.

After creation, in **Settings**:

- Token Expiration: `86400` (24 h)
- Enable RBAC: off

> Auth0 automatically creates a test M2M app tied to this API. You will expand
> its permissions in Step 4 instead of creating a separate M2M app.

---

## Step 3 — SPA Application (Angular frontend)

**Applications → Applications → Create Application**

| Field    | Value                   |
| -------- | ----------------------- |
| **Name** | SaaS Frontend           |
| **Type** | Single Page Application |

In **Settings**:

| Section                | Field                     | Value                                                                       |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------- |
| Application URIs       | **Allowed Callback URLs** | `http://localhost:4200/auth/callback, https://yourdomain.com/auth/callback` |
| Application URIs       | **Allowed Logout URLs**   | `http://localhost:4200/auth, https://yourdomain.com/auth`                   |
| Application URIs       | **Allowed Web Origins**   | `http://localhost:4200, https://yourdomain.com`                             |
| Advanced → Grant Types |                           | ✅ Authorization Code ✅ Refresh Token                                      |
| Refresh Token Rotation | **Rotation**              | Enabled                                                                     |
| Refresh Token Rotation | **Expiration**            | Absolute — 2 592 000 s (30 days)                                            |

Note the **Client ID** — this is `auth0ClientId` in the frontend environment.

### Disable the password-based connection

By default Auth0 enables **Username-Password-Authentication** for every new
application, which causes the Universal Login page to show a password field.

**Applications → Applications → SaaS Frontend → Connections tab**

| Connection                       | Action          |
| -------------------------------- | --------------- |
| Username-Password-Authentication | ❌ Disable      |
| email (Passwordless)             | ✅ Keep enabled |
| google-oauth2                    | ✅ Keep enabled |

Without this step users will be prompted for a password even though the app
is configured for passwordless + Google only.

### Authorize the SPA to access the Custom API

This step is **required** and separate from creating the API. Without it Auth0
returns `invalid_request: Client is not authorized to access resource server`.

**Applications → Applications → SaaS Frontend → APIs tab**

Click **Add** → select your **SaaS API** → choose **User Access** → **Authorize**.

> Use **User Access** (not Client Access). The SPA requests tokens on behalf of
> a logged-in user via Authorization Code + PKCE — not via client credentials.

---

## Step 4 — M2M Application (backend + Post-Login Action)

Rather than creating two separate M2M apps, reuse the **test M2M app** that
Auth0 auto-created when you registered the Custom API in Step 2.

**Applications → Applications → [API Name] (Test Application) → APIs tab**

Click **Authorize** next to **Auth0 Management API** and enable these scopes:

| Scope          | Used by                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `read:users`   | Backend `Auth0ManagementService.findUsersByEmail()`                      |
| `update:users` | Post-Login Action `linkUsers()`                                          |
| `delete:users` | Backend `Auth0ManagementService.deleteUser()` — called on member removal |

Note the **Client ID** and **Client Secret** — you will use them both in the
backend `.env` and as Action Secrets (Step 8).

> **Production note:** for stricter least-privilege, split this into two M2M
> apps — one with `read:users` for the backend, one with `read:users` +
> `update:users` for the Action only.

---

## Step 5 — Passwordless Email Connection (OTP)

**Authentication → Passwordless → Email**

| Field          | Value                    |
| -------------- | ------------------------ |
| **From**       | `noreply@yourdomain.com` |
| **Subject**    | Your login code          |
| **OTP Expiry** | 300 s (5 min)            |
| **OTP Length** | 6                        |

In the **Applications** tab: enable this connection for **SaaS Frontend**.

> **Invite flow:** The backend also uses this connection to send passwordless
> magic-link invite emails. When an admin invites a new member the backend calls
> the Auth0 **Authentication API** `POST /passwordless/start` with the SPA
> `client_id` — Auth0 delivers a branded email using this same Passwordless
> Email connection. No SendGrid or external SMTP is required for the invite flow.
>
> **Important — cross-device compatibility:** The backend uses `send: 'code'`
> (OTP mode) instead of `send: 'link'`. This prevents Auth0's browser-session
> binding that causes _"The link must be opened on the same device"_ errors
> when links are initiated server-side. Auth0 still populates `{{ link }}` in
> the email template (a `verify_redirect` URL with the OTP embedded); customize
> the template to include it:
>
> **Branding → Email Templates → Passwordless Email** — paste in your template
> and make sure it renders `{{ link }}` as a clickable href. Example:
>
> ```html
> <p>You have been invited to {{ application.name }}.</p>
> <p><a href="{{ link }}">Accept invitation</a></p>
> <p>This link expires in 5 minutes.</p>
> ```
>
> Make sure `http://localhost:4200/auth/callback` (and your production
> equivalent) are in the SPA's **Allowed Callback URLs** (Step 3) — Auth0
> embeds `redirect_uri` in the `{{ link }}` URL.

---

## Step 6 — Google Social Connection

### 6a — Google Cloud Console

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URI: `https://yourapp-dev.eu.auth0.com/login/callback`
5. Note the **Client ID** and **Client Secret**

### 6b — Auth0

**Authentication → Social → Create Connection → Google / Gmail**

| Field             | Value               |
| ----------------- | ------------------- |
| **Client ID**     | (from Google Cloud) |
| **Client Secret** | (from Google Cloud) |
| **Scopes**        | `email profile`     |

In the **Applications** tab: enable for **SaaS Frontend**.

---

## Step 7 — Post-Login Action (Account Linking)

**Actions → Library → Build Custom**

| Field       | Value              |
| ----------- | ------------------ |
| **Name**    | Account Linking    |
| **Trigger** | Login / Post Login |
| **Runtime** | Node 18            |

Paste the Action code below, then click **Deploy**.

```js
exports.onExecutePostLogin = async (event, api) => {
  const { ManagementClient } = require('auth0');

  const email = event.user.email;
  if (!email || !event.user.email_verified) return;

  const management = new ManagementClient({
    domain: event.secrets.DOMAIN,
    clientId: event.secrets.CLIENT_ID,
    clientSecret: event.secrets.CLIENT_SECRET,
  });

  let users;
  try {
    users = await management.getUsersByEmail(email);
  } catch (err) {
    console.log('getUsersByEmail failed', err);
    return;
  }

  if (!Array.isArray(users) || users.length < 2) return;

  const verifiedUsers = users.filter((u) => u.email_verified);
  if (verifiedUsers.length < 2) return;

  // Deterministic primary: oldest account wins
  const sorted = verifiedUsers.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const primaryUser = sorted[0];
  const currentUser = verifiedUsers.find(
    (u) => u.user_id === event.user.user_id,
  );
  if (!currentUser) return;
  if (currentUser.user_id === primaryUser.user_id) return;

  const currentIdentity = event.user.identities?.[0];
  if (!currentIdentity) return;

  const alreadyLinked =
    Array.isArray(primaryUser.identities) &&
    primaryUser.identities.some(
      (i) =>
        i.provider === currentIdentity.provider &&
        i.user_id === currentIdentity.user_id,
    );

  try {
    if (!alreadyLinked) {
      await management.linkUsers(primaryUser.user_id, {
        provider: currentIdentity.provider,
        user_id: currentIdentity.user_id,
      });
    }
    api.authentication.setPrimaryUser(primaryUser.user_id);
  } catch (err) {
    console.log('linkUsers failed', err);
    // Silent failure — backend syncUser handles the fallback
  }
};
```

### Add Secrets (Actions → Account Linking → Secrets tab)

| Key             | Value                                 |
| --------------- | ------------------------------------- |
| `DOMAIN`        | `yourapp-dev.eu.auth0.com`            |
| `CLIENT_ID`     | Client ID of the M2M app (Step 4)     |
| `CLIENT_SECRET` | Client Secret of the M2M app (Step 4) |

### Wire to the Login Flow

**Actions → Flows → Login** — drag **Account Linking** between **Start** and
**Complete**, then click **Apply**.

---

## Step 8 — Environment Variables

### Backend — `apps/api/.env`

```env
AUTH0_DOMAIN=yourapp-dev.eu.auth0.com
AUTH0_AUDIENCE=https://api.yourdomain.com
AUTH0_M2M_CLIENT_ID=<client-id-from-step-4>
AUTH0_M2M_CLIENT_SECRET=<client-secret-from-step-4>
# SPA Client ID — used by the backend to send passwordless invite emails via
# the Auth0 Authentication API (/passwordless/start). Same value as
# auth0ClientId in the Angular environment.ts (Step 3).
AUTH0_SPA_CLIENT_ID=<client-id-from-step-3>
FRONTEND_BASE_URL=http://localhost:4200
```

### Frontend — `apps/shell/src/environments/environment.ts`

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  auth0Domain: 'yourapp-dev.eu.auth0.com',
  auth0ClientId: '<client-id-from-step-3>',
  auth0Audience: 'https://api.yourdomain.com', // must match AUTH0_AUDIENCE
  auth0RedirectUri: 'http://localhost:4200/auth/callback',
};
```

---

## Flow Reference

### Self-Signup / Login

```
User clicks "Login"
  → Auth0 Universal Login (OTP or Google)
  → Redirect to /auth/callback?code=...
  → GET /auth/me  →  syncUser(sub, email)
      → new user: provisionWithPersonalOrg()
          → emailService.addContact({ email, firstName, lastName,
              properties: { org_id, org_name } })   ← fire-and-forget
      → returning user: return existing record (update email if changed)
  → Navigate to /
```

### Email Invite

```
Admin  POST /orgs/:id/members { email, role }
  → InviteMemberService
      → findByEmail() → user exists? reuse : createUser('pending:<uuid>', email)
      → createMembership(status=INVITED)
      → Auth0 POST /passwordless/start { client_id: SPA_CLIENT_ID,
          connection: 'email', send: 'link', redirect_uri: FRONTEND_BASE_URL/auth/callback }
          ← Auth0 delivers branded magic-link email (no SendGrid required)
Invitee clicks link → normal login flow
  → GET /auth/me  →  syncUser(sub, email)
      → findByAuth0Id(sub) → null
      → findByEmail(email) → pending record found
      → updateAuth0Id(pending.id, sub)   ← account link
  → All existing memberships intact
```

### System-admin access

The `isSystemAdmin` flag is **never set by the login flow**. It must be granted explicitly via the CLI script:

```sh
node scripts/promote-admin.mjs --email user@example.com          # grant
node scripts/promote-admin.mjs --email user@example.com --revoke # revoke
```

On every authenticated request the `SystemAdminGuard` (`@libs/admin/auth`) looks up the DB user by `auth0Id` and verifies `isSystemAdmin === true` before allowing access to any `/admin` endpoint. See [`@libs/admin/auth`](../admin/auth/README.md) for the guard details.

### Account Linking

```
User has OTP account  email|abc
  → logs in with Google (same email, verified)
  → Post-Login Action:
      finds 2 verified users with same email
      linkUsers(primary=email|abc, secondary=google-oauth2|xyz)
      setPrimaryUser(email|abc)  →  JWT sub = email|abc
  → GET /auth/me  →  syncUser('email|abc', ...)
      → findByAuth0Id('email|abc') → existing record  ✓  no duplicate

If Action fails silently (backend fallback):
  → JWT sub = google-oauth2|xyz
  → syncUser('google-oauth2|xyz', email)
      → findByAuth0Id('google-oauth2|xyz') → null
      → findByEmail(email) → finds email|abc record (not pending)
      → updateAuth0Id(user.id, 'google-oauth2|xyz')   ← fallback relink
  → Single Prisma record preserved, all memberships intact
```

---

## Setup Checklist

|     | Item                                                                                | Location                              |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| ☐   | Custom API (`https://api.yourdomain.com`, RS256)                                    | Auth0 → APIs                          |
| ☐   | SPA app with Callback / Logout / Web Origins configured                             | Auth0 → Applications                  |
| ☐   | SPA authorized to access Custom API (**User Access**)                               | Auth0 → Applications → SPA → APIs tab |
| ☐   | M2M app authorized on Management API (`read:users`, `update:users`, `delete:users`) | Auth0 → Applications                  |
| ☐   | Passwordless Email connection enabled for SPA                                       | Auth0 → Passwordless                  |
| ☐   | Google connection with OAuth credentials, enabled for SPA                           | Auth0 → Social                        |
| ☐   | Post-Login Action deployed with secrets                                             | Auth0 → Actions                       |
| ☐   | Action wired to Login Flow                                                          | Auth0 → Flows → Login                 |
| ☐   | Backend `.env` with `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, M2M + SPA credentials         | Backend                               |
| ☐   | `AUTH0_SPA_CLIENT_ID` set in backend `.env` (same as SPA Client ID from Step 3)     | Backend                               |
| ☐   | Frontend `environment.ts` with matching `auth0Audience`                             | Frontend                              |
