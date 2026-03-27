import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface Auth0TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface Auth0User {
  user_id: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  identities: Array<{ connection: string; provider: string }>;
}

/**
 * Auth0ManagementService
 *
 * Provides Machine-to-Machine access to the Auth0 Management API using
 * the client_credentials grant. The access token is cached locally for
 * its full lifetime (minus a 60-second safety margin) to avoid
 * unnecessary token requests.
 *
 * Also exposes the Auth0 Authentication API `/passwordless/start` endpoint
 * for sending magic-link invite emails. This uses the SPA application's
 * client_id — no M2M token is required.
 *
 * Note: user creation and password-change tickets are intentionally absent —
 * this app uses passwordless / social login (Google). Users are never
 * pre-created in Auth0; they register themselves at first login.
 */
@Injectable()
export class Auth0ManagementService {
  private readonly logger = new Logger(Auth0ManagementService.name);
  private readonly http: AxiosInstance;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({ timeout: 10_000 });
  }

  /** Fetches (and caches) a Management API token via client_credentials. */
  private async getManagementToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const domain = this.configService.get<string>('auth.domain');
    const clientId = this.configService.get<string>('auth.m2mClientId');
    const clientSecret = this.configService.get<string>('auth.m2mClientSecret');

    if (!domain || !clientId || !clientSecret) {
      throw new Error(
        'Auth0 M2M credentials are not configured. ' +
          'Set AUTH0_M2M_CLIENT_ID and AUTH0_M2M_CLIENT_SECRET environment variables.',
      );
    }

    const response = await this.http.post<Auth0TokenResponse>(
      `https://${domain}/oauth/token`,
      {
        client_id: clientId,
        client_secret: clientSecret,
        audience: `https://${domain}/api/v2/`,
        grant_type: 'client_credentials',
      },
    );

    const { access_token, expires_in } = response.data;
    this.cachedToken = access_token;
    // Subtract 60 s safety margin from the TTL
    this.tokenExpiresAt = Date.now() + (expires_in - 60) * 1_000;

    this.logger.log('Auth0 Management API token refreshed.');
    return this.cachedToken;
  }

  /**
   * Fetches a single Auth0 user by their user_id (i.e. the JWT `sub` claim).
   * Useful for resolving the real email address when the access token doesn't
   * carry an email claim (no Post-Login Action deployed yet).
   */
  async getUserById(auth0UserId: string): Promise<Auth0User> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    const response = await this.http.get<Auth0User>(
      `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    return response.data;
  }

  /**
   * Looks up Auth0 users by email address.
   * Returns an empty array when no user is found — never throws a 404.
   *
   * Useful for detecting whether an invited user has already created
   * an Auth0 account (e.g. via Google) before your Prisma record exists.
   */
  async findUsersByEmail(email: string): Promise<Auth0User[]> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    const response = await this.http.get<Auth0User[]>(
      `https://${domain}/api/v2/users-by-email`,
      {
        params: { email },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    return response.data;
  }

  /**
   * Permanently deletes an Auth0 user by their user_id.
   * Called as part of the remove-member flow when the user has no remaining
   * memberships. Requires the `delete:users` scope on the M2M app.
   */
  async deleteUser(auth0UserId: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    await this.http.delete(
      `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    this.logger.log(`Deleted Auth0 user: ${auth0UserId}`);
  }

  /**
   * Sends a passwordless magic-link email via the Auth0 Authentication API.
   *
   * Uses the SPA application's client_id (not the M2M app) because
   * `/passwordless/start` is part of the Authentication API — no access
   * token is required. Auth0 authenticates by the client_id alone.
   *
   * Prerequisite: the Passwordless Email connection must be enabled for the
   * SPA app in the Auth0 dashboard (Authentication → Passwordless → Email →
   * Applications tab → enable SaaS Frontend).
   */
  async sendPasswordlessLink(
    email: string,
    redirectUri: string,
  ): Promise<void> {
    const domain = this.configService.get<string>('auth.domain');
    const clientId = this.configService.get<string>('auth.spaClientId');

    if (!domain || !clientId) {
      throw new Error(
        'Auth0 SPA client ID is not configured. ' +
          'Set AUTH0_SPA_CLIENT_ID environment variable.',
      );
    }

    // 'code' mode avoids Auth0's cross-device browser-binding that breaks
    // server-initiated magic links.  Auth0 generates {{ link }} in the email
    // template (a verify_redirect URL embedding the OTP), which works on any
    // device because no browser-session cookie is created server-side.
    await this.http.post(`https://${domain}/passwordless/start`, {
      client_id: clientId,
      connection: 'email',
      email,
      send: 'code',
      authParams: {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
      },
    });

    this.logger.log(`Passwordless link sent to ${email}`);
  }
}
