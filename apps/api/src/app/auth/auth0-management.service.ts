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

}
