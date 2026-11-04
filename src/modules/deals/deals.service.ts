import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import { DealStageChange } from './entities/deal-stage-change.entity.js';
import { Deal, type DealPriority, type DealStage } from './entities/deal.entity.js';
import { type MilestoneOwnerSide, RoomMilestone } from './entities/room-milestone.entity.js';

export interface DealInput {
  clientId: string;
  title: string;
  value: string;
  ownerId: string | null;
  priority: DealPriority;
  clientRoomId: string | null;
  dueDate: string | null;
  notes: string | null;
  stage?: DealStage;
}
export type DealUpdate = Partial<Omit<DealInput, 'stage'>>;

export interface DealView {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  value: string;
  stage: DealStage;
  ownerId: string | null;
  ownerName: string | null;
  priority: DealPriority;
  clientRoomId: string | null;
  clientRoomName: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface StageChangeView {
  id: string;
  fromStage: DealStage | null;
  toStage: DealStage;
  changedByName: string | null;
  changedAt: Date;
}
export interface DealRecord extends DealView {
  history: StageChangeView[];
}

const PERSON = (alias: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${alias}.first_name, ${alias}.last_name)), ''), ${alias}.email)`;

const DEAL_SQL = `
  SELECT d.id, d.client_id AS "clientId", c.name AS "clientName", d.title, d.value::text AS value, d.stage,
         d.owner_id AS "ownerId", ${PERSON('u')} AS "ownerName", d.priority,
         d.client_room_id AS "clientRoomId", r.room_name AS "clientRoomName",
         to_char(d.due_date, 'YYYY-MM-DD') AS "dueDate", d.notes, d.created_at AS "createdAt", d.updated_at AS "updatedAt"
    FROM deals d
    JOIN clients c ON c.tenant_id = d.tenant_id AND c.id = d.client_id
    LEFT JOIN users u ON u.id = d.owner_id
    LEFT JOIN digital_sales_rooms r ON r.tenant_id = d.tenant_id AND r.id = d.client_room_id
   WHERE d.tenant_id = $1`;

@Injectable()
export class DealsService {
  private readonly deals: TenantRepository<Deal>;
  private readonly changes: TenantRepository<DealStageChange>;

  constructor(
    @InjectRepository(Deal) deals: Repository<Deal>,
    @InjectRepository(DealStageChange) changes: Repository<DealStageChange>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.deals = new TenantRepository(deals, context);
    this.changes = new TenantRepository(changes, context);
  }

  list(filter: { stage?: DealStage; clientId?: string }): Promise<DealView[]> {
    return this.tx.run((manager) => {
      const params: unknown[] = [this.context.tenantId];
      let sql = DEAL_SQL;
      if (filter.stage) sql += ` AND d.stage = $${params.push(filter.stage)}`;
      if (filter.clientId) sql += ` AND d.client_id = $${params.push(filter.clientId)}`;
      return manager.query(`${sql} ORDER BY d.due_date NULLS LAST, d.created_at DESC`, params);
    });
  }

  get(id: string): Promise<DealRecord> {
    return this.tx.run((manager) => this.load(manager, id));
  }

  async create(input: DealInput, identity: AuthenticatedUser): Promise<DealRecord> {
    const actor = await this.userService.resolveActor(identity);
    await this.assertOwner(input.ownerId);
    const record = await this.tx.run(async (manager) => {
      await this.assertRefs(manager, input.clientId, input.clientRoomId);
      const repository = this.deals.withManager(manager);
      const deal = await repository.save(repository.create({ ...input, stage: input.stage ?? 'lead_ingest' }));
      const changes = this.changes.withManager(manager);
      await changes.save(changes.create({ dealId: deal.id, fromStage: null, toStage: deal.stage, changedBy: actor.id }));
      return this.load(manager, deal.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'deal.created', { dealId: record.id, clientId: record.clientId, stage: record.stage });
    return record;
  }

  async update(id: string, changes: DealUpdate, identity: AuthenticatedUser): Promise<DealRecord> {
    const actor = await this.userService.resolveActor(identity);
    await this.assertOwner(changes.ownerId);
    const record = await this.tx.run(async (manager) => {
      const repository = this.deals.withManager(manager);
      const deal = await repository.findOneBy({ id });
      if (!deal) throw new NotFoundException('Deal not found');
      Object.assign(deal, changes);
      await this.assertRefs(manager, deal.clientId, deal.clientRoomId);
      await repository.save(deal);
      return this.load(manager, id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'deal.updated', { dealId: id, changes: Object.keys(changes) });
    return record;
  }

  async changeStage(id: string, stage: DealStage, identity: AuthenticatedUser): Promise<DealRecord> {
    const actor = await this.userService.resolveActor(identity);
    let from: DealStage | null = null;
    const record = await this.tx.run(async (manager) => {
      const repository = this.deals.withManager(manager);
      const deal = await repository.findOneBy({ id });
      if (!deal) throw new NotFoundException('Deal not found');
      from = deal.stage;
      if (deal.stage !== stage) {
        deal.stage = stage;
        await repository.save(deal);
        const changes = this.changes.withManager(manager);
        await changes.save(changes.create({ dealId: id, fromStage: from, toStage: stage, changedBy: actor.id }));
      }
      return this.load(manager, id);
    });
    if (from !== stage) this.audit.logAction(this.context.tenantId, actor.id, 'deal.stage_changed', { dealId: id, from, to: stage });
    return record;
  }

  async remove(id: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run(async (manager) => {
      const repository = this.deals.withManager(manager);
      const deal = await repository.findOneBy({ id });
      if (!deal) throw new NotFoundException('Deal not found');
      await repository.remove(deal);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'deal.deleted', { dealId: id });
  }

  private async load(manager: EntityManager, id: string): Promise<DealRecord> {
    const [deal]: DealView[] = await manager.query(`${DEAL_SQL} AND d.id = $2`, [this.context.tenantId, id]);
    if (!deal) throw new NotFoundException('Deal not found');
    const history: StageChangeView[] = await manager.query(
      `SELECT s.id, s.from_stage AS "fromStage", s.to_stage AS "toStage", ${PERSON('u')} AS "changedByName", s.changed_at AS "changedAt"
         FROM deal_stage_changes s LEFT JOIN users u ON u.id = s.changed_by
        WHERE s.tenant_id = $1 AND s.deal_id = $2 ORDER BY s.changed_at DESC`,
      [this.context.tenantId, id],
    );
    return { ...deal, history };
  }

  private async assertOwner(ownerId: string | null | undefined): Promise<void> {
    if (ownerId && !(await this.userService.findInternal(ownerId))) {
      throw new BadRequestException('ownerId must be an active colleague in this organisation');
    }
  }

  private async assertRefs(manager: EntityManager, clientId: string, roomId: string | null): Promise<void> {
    const [client] = await manager.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, clientId]);
    if (!client) throw new BadRequestException('clientId must be a client of the active tenant');
    if (roomId) {
      const [room] = await manager.query('SELECT client_id FROM digital_sales_rooms WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, roomId]);
      if (!room || room.client_id !== clientId) throw new BadRequestException('clientRoomId must be a client room of the same client');
    }
  }
}

export interface MilestoneInput {
  title: string;
  ownerSide: MilestoneOwnerSide;
  dueDate: string | null;
}
export type MilestoneUpdate = Partial<MilestoneInput> & { completed?: boolean };

export interface MilestoneView {
  id: string;
  clientRoomId: string;
  title: string;
  ownerSide: MilestoneOwnerSide;
  dueDate: string | null;
  completed: boolean;
  completedAt: Date | null;
  completedByName: string | null;
  createdAt: Date;
}

@Injectable()
export class MilestonesService {
  private readonly milestones: TenantRepository<RoomMilestone>;

  constructor(
    @InjectRepository(RoomMilestone) milestones: Repository<RoomMilestone>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.milestones = new TenantRepository(milestones, context);
  }

  list(roomId: string): Promise<MilestoneView[]> {
    return this.tx.run(async (manager) => {
      await this.assertRoom(manager, roomId);
      return this.query(manager, roomId);
    });
  }

  async create(roomId: string, input: MilestoneInput, identity: AuthenticatedUser): Promise<MilestoneView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      await this.assertRoom(manager, roomId);
      const repository = this.milestones.withManager(manager);
      const saved = await repository.save(repository.create({ ...input, clientRoomId: roomId }));
      return (await this.query(manager, roomId, saved.id))[0];
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'milestone.created', { roomId, milestoneId: view.id });
    return view;
  }

  async update(roomId: string, id: string, changes: MilestoneUpdate, identity: AuthenticatedUser): Promise<MilestoneView> {
    const external = this.context.tenant.access.scope === 'external';
    if (external && Object.keys(changes).some((k) => k !== 'completed')) {
      throw new ForbiddenException('Client contacts can only tick off their own steps');
    }
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      await this.assertRoom(manager, roomId);
      const repository = this.milestones.withManager(manager);
      const milestone = await repository.findOneBy({ id, clientRoomId: roomId });
      if (!milestone) throw new NotFoundException('Step not found');
      if (external && milestone.ownerSide !== 'client') throw new ForbiddenException('This step is for the Agera team');
      const { completed, ...rest } = changes;
      Object.assign(milestone, rest);
      if (completed !== undefined && completed !== milestone.completed) {
        milestone.completed = completed;
        milestone.completedAt = completed ? new Date() : null;
        milestone.completedBy = completed ? actor.id : null;
      }
      await repository.save(milestone);
      return (await this.query(manager, roomId, id))[0];
    });
    const action = changes.completed === true ? 'milestone.completed' : changes.completed === false ? 'milestone.reopened' : 'milestone.updated';
    this.audit.logAction(this.context.tenantId, actor.id, action, { roomId, milestoneId: id });
    return view;
  }

  async remove(roomId: string, id: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run(async (manager) => {
      const repository = this.milestones.withManager(manager);
      const milestone = await repository.findOneBy({ id, clientRoomId: roomId });
      if (!milestone) throw new NotFoundException('Step not found');
      await repository.remove(milestone);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'milestone.deleted', { roomId, milestoneId: id });
  }

  private async assertRoom(manager: EntityManager, roomId: string): Promise<void> {
    const [room] = await manager.query('SELECT id FROM digital_sales_rooms WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, roomId]);
    if (!room) throw new NotFoundException('Client room not found');
  }

  private query(manager: EntityManager, roomId: string, id?: string): Promise<MilestoneView[]> {
    const params: unknown[] = [this.context.tenantId, roomId];
    return manager.query(
      `SELECT m.id, m.client_room_id AS "clientRoomId", m.title, m.owner_side AS "ownerSide", to_char(m.due_date, 'YYYY-MM-DD') AS "dueDate",
              m.completed, m.completed_at AS "completedAt", ${PERSON('u')} AS "completedByName", m.created_at AS "createdAt"
         FROM client_room_milestones m LEFT JOIN users u ON u.id = m.completed_by
        WHERE m.tenant_id = $1 AND m.client_room_id = $2${id ? ` AND m.id = $${params.push(id)}` : ''}
        ORDER BY m.due_date NULLS LAST, m.created_at`,
      params,
    );
  }
}
