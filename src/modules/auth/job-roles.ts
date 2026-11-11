import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-user.js';

/** Job roles (Keycloak realm roles). Accounts without one keep the access of their legacy role. */
export const JOB_ROLES = ['PLATFORM_ADMIN', 'HQ_ADMIN', 'ACCOUNT_MANAGER', 'FIELD_REPRESENTATIVE', 'CLIENT_VIEWER'] as const;
export type JobRole = (typeof JOB_ROLES)[number];

export function jobRoleOf(roles: readonly string[]): JobRole | null {
  return JOB_ROLES.find((r) => roles.includes(r)) ?? null;
}

const ALLOWED_KEY = 'allowedJobRoles';
/** Replaces the suite matrix for an endpoint: only these job roles (and platform admins) may call it. */
export const AllowJobRoles = (...roles: JobRole[]) => SetMetadata(ALLOWED_KEY, roles);

const COORDINATOR_KEY = 'coordinatorOnly';
/** Coordinator action in RetailPower operations (sign-off, allocation, decisions); refused to field representatives. */
export const CoordinatorOnly = () => SetMetadata(COORDINATOR_KEY, true);

type Area = 'symphony' | 'nexus' | 'retailpower' | 'workflow';
const AREA: Record<string, Area> = {
  InvoicesController: 'symphony', AutomationController: 'symphony', CreditHoldsController: 'symphony', ReportsController: 'symphony', AuditController: 'symphony', RetentionController: 'symphony',
  WorkflowController: 'workflow',
  ClientsController: 'nexus', SurveysController: 'nexus', DealsController: 'nexus', MilestonesController: 'nexus', PriceListsController: 'nexus',
  DocumentTemplatesController: 'nexus', RoomTemplateDocumentsController: 'nexus', NexusController: 'nexus', RoomDocumentsController: 'nexus',
  SignaturesController: 'nexus', AgreementsController: 'nexus', SalesRoomsController: 'nexus', FinancialsController: 'nexus',
  OfficeDocumentsController: 'nexus', AnomaliesController: 'nexus',
  FieldController: 'retailpower', OperationsController: 'retailpower', WorkOrdersController: 'retailpower', VisitsController: 'retailpower',
  VisitRecordsController: 'retailpower', StoresController: 'retailpower',
};
/** Controllers whose POST endpoints only read (queries, exports). */
const READ_ONLY_POSTS = new Set(['ReportsController']);

export function mayAccess(role: JobRole, controller: string, write: boolean, coordinatorOnly: boolean): boolean {
  const area = AREA[controller];
  if (role === 'PLATFORM_ADMIN' || role === 'CLIENT_VIEWER') return true; // client viewers are limited by ExternalAccessGuard
  if (coordinatorOnly && role !== 'HQ_ADMIN') return false;
  if (!area) return true;
  switch (role) {
    case 'HQ_ADMIN':
      return area === 'symphony' || area === 'workflow' || !write || controller === 'OperationsController';
    case 'ACCOUNT_MANAGER':
      if (area === 'nexus' || area === 'workflow') return true;
      if (controller === 'AuditController' || controller === 'CreditHoldsController') return false;
      return !write;
    case 'FIELD_REPRESENTATIVE':
      return area === 'retailpower' || (controller === 'ClientsController' && !write);
  }
}

/** Enforces the job-role matrix (sec-2): which suites a role may read or change. */
@Injectable()
export class JobRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { method: string }>();
    const role = request.user ? jobRoleOf(request.user.roles) : null;
    if (!role) return true;
    const controller = context.getClass().name;
    const allowed = this.reflector.getAllAndOverride<JobRole[] | undefined>(ALLOWED_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) {
      if (role === 'PLATFORM_ADMIN' || allowed.includes(role)) return true;
      throw new ForbiddenException('Not available to your role');
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !READ_ONLY_POSTS.has(controller);
    const coordinatorOnly = this.reflector.getAllAndOverride<boolean | undefined>(COORDINATOR_KEY, [context.getHandler(), context.getClass()]) ?? false;
    if (!mayAccess(role, controller, write, coordinatorOnly)) throw new ForbiddenException('Not available to your role');
    return true;
  }
}
