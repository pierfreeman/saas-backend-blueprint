import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  RawBodyRequest,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentOrgId, CurrentUserId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import Stripe from 'stripe';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly stripeService: StripeService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post('organizations/:orgId/checkout')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  async createCheckoutSession(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<{ sessionId: string; url: string | null }> {
    const session = await this.billingService.createCheckoutSession(
      orgId,
      dto.priceId,
      dto.successUrl,
      dto.cancelUrl,
      userId,
    );

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  @Post('organizations/:orgId/portal')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create Stripe billing portal session' })
  async createPortalSession(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ): Promise<{ url: string }> {
    const session = await this.billingService.createBillingPortalSession(orgId, undefined, userId);

    return {
      url: session.url,
    };
  }

  @Post('organizations/:orgId/cancel')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel organization subscription' })
  async cancelSubscription(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ): Promise<{ message: string }> {
    await this.billingService.cancelSubscription(orgId, true, userId);
    return { message: 'Subscription scheduled for cancellation' };
  }

  @Post('organizations/:orgId/reactivate')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Reactivate organization subscription' })
  async reactivateSubscription(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ): Promise<{ message: string }> {
    await this.billingService.reactivateSubscription(orgId, userId);
    return { message: 'Subscription reactivated' };
  }

  @Post('webhook')
  async handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event: Stripe.Event;

    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    await this.subscriptionsService.handleStripeWebhook(event);

    return { received: true };
  }
}
