import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithOrg } from '../guards/org-scope.guard';

export const OrgId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithOrg>();
    return request.orgId;
  },
);
