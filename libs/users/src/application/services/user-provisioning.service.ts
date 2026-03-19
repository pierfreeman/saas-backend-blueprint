import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { UserRepository } from '../../infrastructure/repositories/user.repository';

@Injectable()
export class UserProvisioningService {
  constructor(private readonly userRepository: UserRepository) {}

  async provisionWithPersonalOrg(
    auth0Id: string,
    email: string,
  ): Promise<User> {
    return this.userRepository.provisionWithPersonalOrg(auth0Id, email);
  }
}
