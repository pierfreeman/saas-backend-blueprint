import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Multi-tenant SaaS Backend Blueprint is running!';
  }
}
