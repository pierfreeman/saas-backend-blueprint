import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface Auth0TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface Auth0UserResponse {
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
 * Auth0ManagementClient
 *
 * Raw HTTP wrapper for the Auth0 Management API (M2M token, user CRUD)
 * and Authentication API (passwordless, change password).
 *
 * This is an infrastructure client — it is only instantiated via
 * Auth0IdentityProvider. Nothing outside this lib should import it directly.
 */
@Injectable()
export class Auth0ManagementClient {
  private readonly logger = new Logger(Auth0ManagementClient.name);
  private readonly http: AxiosInstance;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({ timeout: 10_000 });
  }

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
    this.tokenExpiresAt = Date.now() + (expires_in - 60) * 1_000;

    this.logger.log('Auth0 Management API token refreshed.');
    return this.cachedToken;
  }

  async getUserById(auth0UserId: string): Promise<Auth0UserResponse> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    const response = await this.http.get<Auth0UserResponse>(
      `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  }

  async findUsersByEmail(email: string): Promise<Auth0UserResponse[]> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    const response = await this.http.get<Auth0UserResponse[]>(
      `https://${domain}/api/v2/users-by-email`,
      {
        params: { email },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return response.data;
  }

  async deleteUser(auth0UserId: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = this.configService.get<string>('auth.domain');

    await this.http.delete(
      `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.logger.log(`Deleted Auth0 user: ${auth0UserId}`);
  }

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

  async sendChangePasswordEmail(email: string): Promise<void> {
    const domain = this.configService.get<string>('auth.domain');
    const clientId = this.configService.get<string>('auth.spaClientId');

    if (!domain || !clientId) {
      throw new Error(
        'Auth0 SPA client ID is not configured. ' +
          'Set AUTH0_SPA_CLIENT_ID environment variable.',
      );
    }

    await this.http.post(`https://${domain}/dbconnections/change_password`, {
      client_id: clientId,
      email,
      connection: 'Username-Password-Authentication',
    });
    this.logger.log(`Password reset email sent to ${email}`);
  }
}
