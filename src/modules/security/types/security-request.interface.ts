import { Request } from 'express';

export interface SecurityContext {
  ip: string;
  endpoint: string;
  method: string;
  userId?: string;
  orgId?: string;
  reasons: string[];
  threatScore: number;
}

export interface SecurityRequestUser {
  id?: string;
  sub?: string;
  orgId?: string;
}

export interface SecurityRequest extends Request {
  user?: SecurityRequestUser;
  securityContext?: SecurityContext;
}
