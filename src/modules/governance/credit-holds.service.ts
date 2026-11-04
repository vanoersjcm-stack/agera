import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, QueryFailedError, type Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import { CreditHold } from './credit-hold.entity.js';

export interface CreditHoldView {
  id: string;
  clientId: string | null;
  clientName: string | null;
  reason: string;
  setByName: string | null;
  createdAt: Date;
  releasedAt: Date | null;
  releasedByName: string | null;
  active: boolean;
}

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;
const HOLD_SQL = `
  SELECT h.id, h.client_id AS "clientId", c.name AS "clientName", h.reason, ${PERSON('s')} AS "setByName", h.created_at AS "createdAt",
         h.released_at AS "releasedAt", ${PERSON('r')} AS "releasedByName", (h.released_at IS NULL) AS active
    FROM credit_holds h
    LEFT JOIN clients c ON c.tenant_id = h.tenant_id AND c.id = h.client_id
    LEFT JOIN users s ON s.id = h.set_by
    LEFT JOIN users r ON r.id = h.released_by
   WHERE h.tenant_id = $1`;

/** Active hold that blocks commercial commitments for a client (client-specific or organisation-wide). */
export async function activeHoldFor(manager: EntityManager, tenantId: string, clientId: string): Promise<{ id: string; client_id: string | null } | null> {
  const [hold] = await manager.query(
    `SELECT id, client_id FROM credit_holds
      WHERE tenant_id = $1 AND released_at IS NULL AND (client_id IS NULL OR client_id = $2)
      ORDER BY client_id NULLS FIRST LIMIT 1`,
    [tenantId, clientId],
  );
  return hold ?? null;
}

@Injectable()
export class CreditHoldsService {
  private readonly holds: TenantRepository<CreditHold>;

  constructor(
    @InjectRepository(CreditHold) holds: Repository<CreditHold>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.holds = new TenantRepository(holds, context);
  }

  list(includeReleased: boolean): Promise<CreditHoldView[]> {
    return this.tx.run((manager) =>
      manager.query(`${HOLD_SQL}${includeReleased ? '' : ' AND h.released_at IS NULL'} ORDER BY (h.released_at IS NULL) DESC, h.created_at DESC LIMIT 200`, [
        this.context.tenantId,
      ]),
    );
  }

  async create(input: { clientId: string | null; reason: string }, identity: AuthenticatedUser): Promise<CreditHoldView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      if (input.clientId) {
        const [client] = await manager.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, input.clientId]);
        if (!client) throw new BadRequestException('clientId must be a client of the active tenant');
      }
      const repository = this.holds.withManager(manager);
      let saved: CreditHold;
      try {
        saved = await repository.save(repository.create({ clientId: input.clientId, reason: input.reason, setBy: actor.id }));
      } catch (error) {
        if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
          throw new ConflictException(input.clientId ? 'This client already has an active credit lock' : 'An organisation-wide credit lock is already active');
        }
        throw error;
      }
      if (input.clientId) {
        await manager.query(`UPDATE clients SET credit_status = 'locked' WHERE tenant_id = $1 AND id = $2`, [this.context.tenantId, input.clientId]);
      }
      return this.load(manager, saved.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'credit_hold.set', { holdId: view.id, clientId: view.clientId, reason: view.reason });
    return view;
  }

  async release(id: string, identity: AuthenticatedUser): Promise<CreditHoldView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      const repository = this.holds.withManager(manager);
      const hold = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!hold) throw new NotFoundException('Credit lock not found');
      if (hold.releasedAt) throw new ConflictException('This credit lock was already released');
      hold.releasedAt = new Date();
      hold.releasedBy = actor.id;
      await repository.save(hold);
      if (hold.clientId) {
        await manager.query(`UPDATE clients SET credit_status = 'approved' WHERE tenant_id = $1 AND id = $2 AND credit_status = 'locked'`, [
          this.context.tenantId,
          hold.clientId,
        ]);
      }
      return this.load(manager, id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'credit_hold.released', { holdId: id, clientId: view.clientId });
    return view;
  }

  private async load(manager: EntityManager, id: string): Promise<CreditHoldView> {
    const [hold] = await manager.query(`${HOLD_SQL} AND h.id = $2`, [this.context.tenantId, id]);
    if (!hold) throw new NotFoundException('Credit lock not found');
    return hold;
  }
}
