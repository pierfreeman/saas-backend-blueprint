import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Prisma } from '@prisma/client';

interface StripeErrorLike {
  type?: string;
  message?: string;
  statusCode?: number;
}

@Injectable()
export class ErrorMappingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorMappingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        // Log the original error
        this.logger.error(`Error caught in interceptor: ${error.message}`, error.stack);

        // If already an HTTP exception, pass through
        if (error instanceof HttpException) {
          return throwError(() => error);
        }

        // Map Prisma errors
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          return throwError(() => this.mapPrismaError(error));
        }

        // Map Stripe errors
        if (error.type && error.type.includes('Stripe')) {
          return throwError(() => this.mapStripeError(error as StripeErrorLike));
        }

        // Generic error
        return throwError(
          () =>
            new HttpException(
              {
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: 'Internal server error',
                error: 'InternalServerError',
              },
              HttpStatus.INTERNAL_SERVER_ERROR,
            ),
        );
      }),
    );
  }

  private mapPrismaError(error: Prisma.PrismaClientKnownRequestError): HttpException {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation
        return new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'Resource already exists',
            error: 'Conflict',
            details: error.meta,
          },
          HttpStatus.CONFLICT,
        );

      case 'P2025':
        // Record not found
        return new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Resource not found',
            error: 'NotFound',
          },
          HttpStatus.NOT_FOUND,
        );

      case 'P2003':
        // Foreign key constraint violation
        return new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Invalid reference to related resource',
            error: 'BadRequest',
          },
          HttpStatus.BAD_REQUEST,
        );

      default:
        return new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Database error',
            error: 'DatabaseError',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }

  private mapStripeError(error: StripeErrorLike): HttpException {
    switch (error.type) {
      case 'StripeCardError':
        return new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            message: error.message || 'Card error',
            error: 'PaymentRequired',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );

      case 'StripeInvalidRequestError':
        return new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: error.message || 'Invalid request to payment provider',
            error: 'BadRequest',
          },
          HttpStatus.BAD_REQUEST,
        );

      case 'StripeAPIError':
      case 'StripeConnectionError':
        return new HttpException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Payment service temporarily unavailable',
            error: 'ServiceUnavailable',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );

      case 'StripeAuthenticationError':
        return new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Payment authentication failed',
            error: 'InternalServerError',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );

      default:
        return new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Payment processing error',
            error: 'PaymentError',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }
}
