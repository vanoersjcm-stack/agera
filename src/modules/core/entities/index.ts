import { AuditLog } from './audit-log.entity.js';
import { RolePermission } from './role-permission.entity.js';
import { Tenant } from './tenant.entity.js';
import { User } from './user.entity.js';

export { AuditLog, RolePermission, Tenant, User };

export const entities = [Tenant, User, RolePermission, AuditLog];
