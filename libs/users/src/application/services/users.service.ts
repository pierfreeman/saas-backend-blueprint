import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { UserRepository } from '../../infrastructure/repositories/user.repository';

@Injectable()
export class UsersService {
  constructor(private readonly userRepository: UserRepository) {}

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.userRepository.findByAuth0Id(auth0Id);
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  async createUser(auth0Id: string, email: string): Promise<User> {
    return this.userRepository.createUser(auth0Id, email);
  }

  async updateEmail(id: string, email: string): Promise<User> {
    return this.userRepository.updateEmail(id, email);
  }

  async updateAuth0Id(id: string, auth0Id: string): Promise<User> {
    return this.userRepository.updateAuth0Id(id, auth0Id);
  }

  async provisionWithPersonalOrg(
    auth0Id: string,
    email: string,
  ): Promise<User> {
    return this.userRepository.provisionWithPersonalOrg(auth0Id, email);
  }

  async deleteUser(id: string): Promise<void> {
    return this.userRepository.deleteUser(id);
  }
}
