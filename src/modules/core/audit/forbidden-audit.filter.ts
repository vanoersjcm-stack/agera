import { type ArgumentsHost, Catch, type ExceptionFilter, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/authenticated-user.js';
import { TenantContext } from '../tenancy/tenant-context.service.js';
import { TenantResolver } from '../tenancy/tenant-resolver.service.js';
import { AuditService } from './audit.service.js';

interface HttpRequest extends AuthenticatedRequest {
  method: string;
  originalUrl?: string;
  url: string;
}

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

/** Records every 403 refusal in the audit log of the organisation it concerns, then answers as Nest would. */
@Catch(ForbiddenException)
@Injectable()
export class ForbiddenAuditFilter implements ExceptionFilter {
  private readonly logger = new Logger(ForbiddenAuditFilter.name);

  constructor(
    private readonly audit: AuditService,
    private readonly context: TenantContext,
    private readonly resolver: TenantResolver,
  ) {}

  async catch(exception: ForbiddenException, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    try {
      const tenantId = await this.tenantOf(request);
      if (tenantId) {
        this.audit.logAction(tenantId, null, 'access.denied', {
          method: request.method,
          path: (request.originalUrl ?? request.url).split('?')[0],
          reason: exception.message,
          keycloakId: request.user?.keycloakId ?? null,
          email: request.user?.email ?? null,
          apiKeyId: request.apiKey?.id ?? null,
        });
      }
    } catch (error) {
      this.logger.warn(`Could not record a 403 refusal: ${String(error)}`);
    }
    const body = exception.getResponse();
    http.getResponse<HttpResponse>().status(403).json(typeof body === 'string' ? { statusCode: 403, message: body } : body);
  }

  private async tenantOf(request: HttpRequest): Promise<string | null> {
    try {
      return this.context.tenantId;
    } catch {
      // The refusal came from a guard, before the tenant interceptor ran.
    }
    if (request.apiKey) return request.apiKey.tenantId;
    if (!request.user) return null;
    try {
      return (await this.resolver.resolve(request.user)).id;
    } catch {
      return null;
    }
  }
}
