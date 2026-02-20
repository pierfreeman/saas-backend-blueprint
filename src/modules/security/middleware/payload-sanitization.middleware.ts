import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AttackDetectionService } from '../services/attack-detection.service';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityRequest } from '../types/security-request.interface';

interface SanitizeResult {
  value: unknown;
  modified: boolean;
  severeThreat: boolean;
  reasons: string[];
}

@Injectable()
export class PayloadSanitizationMiddleware implements NestMiddleware {
  constructor(private readonly attackDetectionService: AttackDetectionService) {}

  use(request: SecurityRequest, _response: Response, next: NextFunction): void {
    if (request.path.includes('/billing/webhook')) {
      next();
      return;
    }

    const bodyResult = this.sanitizeValue(request.body);
    const queryResult = this.sanitizeValue(request.query);
    const paramsResult = this.sanitizeValue(request.params);

    request.body = bodyResult.value;

    const allReasons = [...bodyResult.reasons, ...queryResult.reasons, ...paramsResult.reasons];

    if (bodyResult.severeThreat || queryResult.severeThreat || paramsResult.severeThreat) {
      this.attackDetectionService.attachReason(request, 'payload_threat_detected');
      void this.attackDetectionService.registerSuspiciousActivity(
        request,
        'payload_threat_detected',
      );

      throw new SecurityIncidentException(
        HttpStatus.BAD_REQUEST,
        'Suspicious payload detected',
        'payload_threat',
        {
          reasons: allReasons,
        },
      );
    }

    next();
  }

  private sanitizeValue(value: unknown): SanitizeResult {
    if (value === null || value === undefined) {
      return { value, modified: false, severeThreat: false, reasons: [] };
    }

    if (Array.isArray(value)) {
      let modified = false;
      let severeThreat = false;
      const reasons: string[] = [];

      const sanitizedArray = value.map((item) => {
        const result = this.sanitizeValue(item);
        modified = modified || result.modified;
        severeThreat = severeThreat || result.severeThreat;
        reasons.push(...result.reasons);
        return result.value;
      });

      return { value: sanitizedArray, modified, severeThreat, reasons };
    }

    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      const sanitizedObject: Record<string, unknown> = {};
      let modified = false;
      let severeThreat = false;
      const reasons: string[] = [];

      for (const [key, nestedValue] of Object.entries(objectValue)) {
        if (key.startsWith('$') || key.includes('.')) {
          modified = true;
          severeThreat = true;
          reasons.push('nosql_operator_key');
          continue;
        }

        const result = this.sanitizeValue(nestedValue);
        modified = modified || result.modified;
        severeThreat = severeThreat || result.severeThreat;
        reasons.push(...result.reasons);
        sanitizedObject[key] = result.value;
      }

      return { value: sanitizedObject, modified, severeThreat, reasons };
    }

    if (typeof value === 'string') {
      const sqlInjectionRegex =
        /(\bunion\b\s+\bselect\b|\bdrop\b\s+\btable\b|\bor\b\s+1\s*=\s*1|\bsleep\s*\(|\bbenchmark\s*\()/i;
      const xssRegex = /(<script\b[^>]*>.*?<\/script>|javascript:|onerror\s*=|onload\s*=)/i;

      if (sqlInjectionRegex.test(value)) {
        return {
          value,
          modified: false,
          severeThreat: true,
          reasons: ['sql_injection_pattern'],
        };
      }

      let sanitizedValue = value;
      sanitizedValue = sanitizedValue.replace(/\u0000/g, '');
      sanitizedValue = sanitizedValue.replace(/<script\b[^>]*>.*?<\/script>/gis, '');
      sanitizedValue = sanitizedValue.replace(/javascript:/gi, '');
      sanitizedValue = sanitizedValue.replace(/on\w+\s*=/gi, '');

      const modified = sanitizedValue !== value;
      const reasons = xssRegex.test(value) ? ['xss_payload_sanitized'] : [];

      return {
        value: sanitizedValue,
        modified,
        severeThreat: false,
        reasons,
      };
    }

    return { value, modified: false, severeThreat: false, reasons: [] };
  }
}
