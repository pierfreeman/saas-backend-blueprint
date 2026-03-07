import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { createHash } from 'crypto';
import Stripe from 'stripe';
import {
  StripeService,
  WebhookDispatcherService,
  BillingRepository,
} from '@libs/billing';
import { LegalAuditService } from '@libs/legal-audit';

/**
 * WebhookController
 * Handles incoming Stripe webhook events.
 *
 * Security pipeline:
 *   1. Receive raw body (rawBody: true in NestFactory.create)
 *   2. Record receipt in LegalAudit (immutable, before any other processing)
 *   3. Verify Stripe signature — reject with 400 on failure, log to LegalAudit
 *   4. Idempotency check — if event already processed, return 200 silently
 *   5. Dispatch event to WebhookDispatcherService
 *   6. Record processed event ID in BillingEvent table (idempotency record)
 *   7. Return { received: true }
 *
 * This endpoint is intentionally unauthenticated (Stripe cannot provide a Bearer
 * token). Security is provided exclusively by HMAC signature verification.
 *
 * TODO: Apply @nestjs/throttler rate-limiter to POST /billing/webhook and the
 * REST billing endpoints (BillingController). The webhook endpoint is public
 * (no Bearer token) and is therefore a surface for volumetric abuse even though
 * every request fails HMAC verification. Recommended: a dedicated ThrottlerGuard
 * with a tight limit (e.g. 60 req/min per IP) on the webhook route and a
 * slightly looser limit on the authenticated REST routes.
 * See: https://docs.nestjs.com/security/rate-limiting
 *
 * @route POST /billing/webhook
 */
@ApiTags('Billing')
@Controller('billing')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly legalAudit: LegalAuditService,
    private readonly billingRepository: BillingRepository,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook endpoint',
    description:
      'Receives and processes Stripe webhook events. ' +
      'Security is enforced via HMAC signature verification (stripe-signature header).',
  })
  @ApiHeader({
    name: 'stripe-signature',
    description: 'Stripe webhook signature for HMAC verification',
    required: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Event received and queued for processing.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or missing signature.',
  })
  async handleWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const rawBody = request.rawBody;

    // ── Step 1: Record receipt (before signature verification) ───────────────
    this.legalAudit.recordEvent({
      eventType: 'stripe.webhook.received',
      triggerType: 'api',
      metadata: {
        hasSignature: !!signature,
        contentType: request.headers['content-type'],
      },
    });

    // ── Step 2: Input validation ─────────────────────────────────────────────
    if (!rawBody || !signature) {
      this.legalAudit.recordEvent({
        eventType: 'stripe.webhook.failed_verification',
        triggerType: 'api',
        metadata: { reason: 'missing_raw_body_or_signature' },
      });
      throw new BadRequestException('Missing Stripe signature or request body');
    }

    // ── Step 3: Signature verification ──────────────────────────────────────
    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Stripe signature verification failed: ${errorMessage}`);

      this.legalAudit.recordEvent({
        eventType: 'stripe.webhook.failed_verification',
        triggerType: 'api',
        metadata: { reason: 'invalid_signature', error: errorMessage },
      });

      throw new BadRequestException('Stripe signature verification failed');
    }

    this.legalAudit.recordEvent({
      eventType: 'stripe.webhook.verified',
      triggerType: 'api',
      metadata: { stripeEventId: event.id, eventType: event.type },
    });

    // ── Step 4: Idempotency check ────────────────────────────────────────────
    const existing = await this.billingRepository.findBillingEvent(event.id);
    if (existing) {
      this.logger.debug(`Duplicate Stripe event ignored: ${event.id}`);
      return { received: true };
    }

    // ── Step 5: Compute payload hash for tamper detection ───────────────────
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    // ── Step 6: Dispatch to handler ──────────────────────────────────────────
    await this.dispatcher.dispatch(event);

    // ── Step 7: Record as processed (idempotency fence) ───────────────────────
    const orgId = (event.data.object as { metadata?: { orgId?: string } })
      ?.metadata?.['orgId'];

    await this.billingRepository.createBillingEvent(
      event.id,
      payloadHash,
      orgId,
    );

    this.logger.log(`Stripe event processed: ${event.type} (${event.id})`);

    return { received: true };
  }
}
