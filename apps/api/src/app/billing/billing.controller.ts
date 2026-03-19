import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { BillingService } from '@libs/billing';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard, OrgScoped, RequireRole } from '@libs/rbac';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreatePortalSessionDto } from './dto/create-portal-session.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { CheckoutSessionResponseDto } from './dto/checkout-session-response.dto';
import { PortalSessionResponseDto } from './dto/portal-session-response.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { CancelSubscriptionResponseDto } from './dto/cancel-subscription-response.dto';
import { BillingHistoryResponseDto } from './dto/billing-history-response.dto';

/**
 * Extracts the resolved DB user UUID (set on request.user.dbUserId by OrgContextGuard).
 */
const CurrentDbUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { dbUserId?: string } }>();
    return request.user?.dbUserId;
  },
);

/**
 * BillingController
 * HTTP endpoints for Stripe billing operations.
 *
 * All routes require:
 *   1. JwtAuthGuard    — validates the Bearer JWT
 *   2. OrgContextGuard — resolves the organization and verifies active membership
 *   3. RBACGuard       — enforces OWNER or ADMIN role
 *
 * @route POST /billing/checkout     — Creates a Stripe Checkout session
 * @route POST /billing/portal       — Creates a Stripe Billing Portal session
 * @route GET  /billing/subscription — Returns the current subscription state
 * @route POST /billing/cancel       — Cancels the active subscription at period end
 */
@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@OrgScoped()
@RequireRole(MembershipRole.OWNER, MembershipRole.ADMIN)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // ─── POST /billing/checkout ─────────────────────────────────────────────────

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a Stripe Checkout session',
    description:
      'Creates a Stripe Checkout session for purchasing a subscription plan. ' +
      'Returns a redirect URL the user should be sent to. ' +
      'Optionally accepts an Idempotency-Key header to prevent duplicate sessions ' +
      'on retried requests — the key is forwarded directly to the Stripe API.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Optional client-generated UUID to prevent duplicate Checkout sessions on retried requests. ' +
      'Forwarded verbatim to Stripe. Must be unique per logical checkout attempt.',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Checkout session created.',
    type: CheckoutSessionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — missing or invalid request body fields.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller has no active membership in the org or lacks OWNER/ADMIN role.',
  })
  async createCheckoutSession(
    @Body() dto: CreateCheckoutSessionDto,
    @CurrentDbUserId() actorUserId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CheckoutSessionResponseDto> {
    return this.billingService.createCheckoutSession(
      dto.orgId,
      dto.priceId,
      actorUserId,
      {
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
        idempotencyKey,
      },
    );
  }

  // ─── POST /billing/portal ───────────────────────────────────────────────────

  @Post('portal')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a Stripe Billing Portal session',
    description:
      'Creates a Stripe Billing Portal session for subscription management. ' +
      'Returns a URL the user should be redirected to.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Billing portal session created.',
    type: PortalSessionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — missing or invalid request body fields.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller has no active membership in the org or lacks OWNER/ADMIN role.',
  })
  async createPortalSession(
    @Body() dto: CreatePortalSessionDto,
    @CurrentDbUserId() actorUserId: string,
  ): Promise<PortalSessionResponseDto> {
    return this.billingService.createPortalSession(
      dto.orgId,
      dto.returnUrl,
      actorUserId,
    );
  }

  // ─── GET /billing/subscription ──────────────────────────────────────────────

  @Get('subscription')
  @ApiOperation({
    summary: 'Get current subscription state',
    description:
      'Returns the billing subscription state for the specified organization.',
  })
  @ApiQuery({ name: 'orgId', required: true, description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Subscription state returned.',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller has no active membership in the org or lacks OWNER/ADMIN role.',
  })
  async getSubscription(
    @Query('orgId') orgId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.billingService.getSubscription(orgId);
  }

  // ─── POST /billing/cancel ───────────────────────────────────────────────────

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel active subscription',
    description:
      'Schedules the active subscription for cancellation at the end of the current billing period.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Subscription scheduled for cancellation.',
    type: CancelSubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — missing or invalid request body fields.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller has no active membership in the org or lacks OWNER/ADMIN role.',
  })
  async cancelSubscription(
    @Body() dto: CancelSubscriptionDto,
    @CurrentDbUserId() actorUserId: string,
  ): Promise<CancelSubscriptionResponseDto> {
    await this.billingService.cancelSubscription(dto.orgId, actorUserId);
    return {
      message:
        'Subscription will be canceled at the end of the current period.',
    };
  }

  // ─── GET /billing/history ───────────────────────────────────────────────────

  @Get('history')
  @ApiOperation({
    summary: 'Get subscription snapshot history',
    description:
      'Returns a paginated, newest-first list of immutable SubscriptionSnapshot records ' +
      'for the specified organization. Each entry captures the subscription state at the ' +
      'time a Stripe lifecycle event was processed. Intended for internal audit UI.',
  })
  @ApiQuery({ name: 'orgId', required: true, description: 'Organization UUID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum items to return (1–200, default 50)',
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Number of items to skip for pagination (default 0)',
    example: 0,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated subscription snapshot history returned.',
    type: BillingHistoryResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller has no active membership in the org or lacks OWNER/ADMIN role.',
  })
  async getSubscriptionHistory(
    @Query('orgId') orgId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<BillingHistoryResponseDto> {
    const limit = Math.min(
      Math.max(Number.parseInt(limitStr ?? '50', 10) || 50, 1),
      200,
    );
    const offset = Math.max(Number.parseInt(offsetStr ?? '0', 10) || 0, 0);
    const { items, total } = await this.billingService.getSubscriptionHistory(
      orgId,
      limit,
      offset,
    );
    return { items, total, limit, offset };
  }
}
