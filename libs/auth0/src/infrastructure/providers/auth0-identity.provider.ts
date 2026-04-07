import { Injectable } from '@nestjs/common';
import {
  IIdentityProvider,
  IdentityUser,
} from '../../domain/ports/identity-provider.interface';
import { Auth0ManagementClient } from '../clients/auth0-management.client';
import { toIdentityUser } from './auth0-user.mapper';

/**
 * Auth0IdentityProvider
 *
 * Implements IIdentityProvider using the Auth0 Management and
 * Authentication APIs via Auth0ManagementClient.
 *
 * Registered in Auth0Module as the provider for the IIdentityProvider token.
 */
@Injectable()
export class Auth0IdentityProvider extends IIdentityProvider {
  constructor(private readonly client: Auth0ManagementClient) {
    super();
  }

  async getUserById(externalId: string): Promise<IdentityUser> {
    const raw = await this.client.getUserById(externalId);
    return toIdentityUser(raw);
  }

  async findUsersByEmail(email: string): Promise<IdentityUser[]> {
    const results = await this.client.findUsersByEmail(email);
    return results.map(toIdentityUser);
  }

  async deleteUser(externalId: string): Promise<void> {
    return this.client.deleteUser(externalId);
  }

  async sendInviteLink(email: string, redirectUri: string): Promise<void> {
    return this.client.sendPasswordlessLink(email, redirectUri);
  }

  async sendChangePasswordEmail(email: string): Promise<void> {
    return this.client.sendChangePasswordEmail(email);
  }
}
