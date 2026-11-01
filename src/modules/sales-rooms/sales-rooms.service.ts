import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import type { AnomalyType } from './dto/sales-rooms.dto.js';
import { Agreement, type AgreementStatus } from './entities/agreement.entity.js';
import { DigitalSalesRoom, type DsrStatusValue } from './entities/digital-sales-room.entity.js';

const PG_FOREIGN_KEY_VIOLATION = '23503';
export const MAX_ANOMALIES = 500;

const AGREEMENT_TRANSITIONS: Record<AgreementStatus, AgreementStatus[]> = {
  pending_approval: ['active', 'expired'],
  active: ['expired'],
  expired: [],
};

export interface CreateAgreementInput {
  clientId: string;
  title: string;
  documentUrl: string;
  status: AgreementStatus;
}

export interface CreateDsrInput {
  clientId: string;
  roomName: string;
  agreementId: string | null;
}

export interface ListFilter<S> {
  clientId: string | null;
  status: S | null;
}

export interface Anomaly {
  anomalyType: AnomalyType;
  sourceId: string;
  description: string;
  observedAt: Date;
  details: Record<string, unknown>;
  createdAt: Date;
}

@Injectable()
export class SalesRoomsService {
  private readonly agreements: TenantRepository<Agreement>;
  private readonly rooms: TenantRepository<DigitalSalesRoom>;

  constructor(
    @InjectRepository(Agreement) agreements: Repository<Agreement>,
    @InjectRepository(DigitalSalesRoom) rooms: Repository<DigitalSalesRoom>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.agreements = new TenantRepository(agreements, context);
    this.rooms = new TenantRepository(rooms, context);
  }

  async createAgreement(input: CreateAgreementInput, identity: AuthenticatedUser): Promise<Agreement> {
    const actor = await this.userService.resolveActor(identity);
    const agreement = await this.tx.run(async (manager) => {
      const repository = this.agreements.withManager(manager);
      const saved = await repository.save(repository.create(input));
      return this.reload(repository, saved.id, 'Agreement');
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'agreement.created', {
      agreementId: agreement.id,
      clientId: agreement.clientId,
      status: agreement.status,
    });
    return agreement;
  }

  listAgreements(filter: ListFilter<AgreementStatus>): Promise<Agreement[]> {
    return this.tx.run((manager) =>
      this.agreements.withManager(manager).find({
        where: { ...(filter.clientId ? { clientId: filter.clientId } : {}), ...(filter.status ? { status: filter.status } : {}) },
        order: { createdAt: 'DESC', id: 'ASC' },
      }),
    );
  }

  getAgreement(id: string): Promise<Agreement> {
    return this.tx.run((manager) => this.reload(this.agreements.withManager(manager), id, 'Agreement'));
  }

  async updateAgreement(id: string, changes: { title?: string; documentUrl?: string }, identity: AuthenticatedUser): Promise<Agreement> {
    const actor = await this.userService.resolveActor(identity);
    const agreement = await this.tx.run(async (manager) => {
      const repository = this.agreements.withManager(manager);
      const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Agreement not found');
      }
      if (current.status === 'expired') {
        throw new ConflictException('Cannot edit an expired agreement');
      }
      Object.assign(current, changes);
      await repository.save(current);
      return this.reload(repository, id, 'Agreement');
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'agreement.updated', { agreementId: id, changes: Object.keys(changes) });
    return agreement;
  }

  async updateAgreementStatus(id: string, status: AgreementStatus, identity: AuthenticatedUser): Promise<Agreement> {
    const actor = await this.userService.resolveActor(identity);
    const { agreement, previous } = await this.tx.run(async (manager) => {
      const repository = this.agreements.withManager(manager);
      const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Agreement not found');
      }
      if (current.status === status) {
        return { agreement: current, previous: current.status };
      }
      if (!AGREEMENT_TRANSITIONS[current.status].includes(status)) {
        throw new ConflictException(`Cannot change agreement status from ${current.status} to ${status}`);
      }
      const before = current.status;
      current.status = status;
      await repository.save(current);
      return { agreement: await this.reload(repository, id, 'Agreement'), previous: before };
    });
    if (previous !== status) {
      this.audit.logAction(this.context.tenantId, actor.id, 'agreement.status_changed', {
        agreementId: id,
        previousStatus: previous,
        newStatus: status,
      });
    }
    return agreement;
  }

  async createRoom(input: CreateDsrInput, identity: AuthenticatedUser): Promise<DigitalSalesRoom> {
    const actor = await this.userService.resolveActor(identity);
    let room: DigitalSalesRoom;
    try {
      room = await this.tx.run(async (manager) => {
        const repository = this.rooms.withManager(manager);
        const saved = await repository.save(repository.create(input));
        return this.reload(repository, saved.id, 'Digital Sales Room');
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION) {
        throw new BadRequestException('agreementId must be an agreement of the same client in this tenant');
      }
      throw error;
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'dsr.created', {
      dsrId: room.id,
      clientId: room.clientId,
      agreementId: room.agreementId,
    });
    return room;
  }

  listRooms(filter: ListFilter<DsrStatusValue>): Promise<DigitalSalesRoom[]> {
    return this.tx.run((manager) =>
      this.rooms.withManager(manager).find({
        where: { ...(filter.clientId ? { clientId: filter.clientId } : {}), ...(filter.status ? { status: filter.status } : {}) },
        order: { createdAt: 'DESC', id: 'ASC' },
      }),
    );
  }

  getRoom(id: string): Promise<DigitalSalesRoom> {
    return this.tx.run((manager) => this.reload(this.rooms.withManager(manager), id, 'Digital Sales Room'));
  }

  async updateRoomStatus(id: string, status: DsrStatusValue, identity: AuthenticatedUser): Promise<DigitalSalesRoom> {
    const actor = await this.userService.resolveActor(identity);
    const { room, previous } = await this.tx.run(async (manager) => {
      const repository = this.rooms.withManager(manager);
      const current = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Digital Sales Room not found');
      }
      const before = current.status;
      if (before !== status) {
        current.status = status;
        await repository.save(current);
      }
      return { room: await this.reload(repository, id, 'Digital Sales Room'), previous: before };
    });
    if (previous !== status) {
      this.audit.logAction(this.context.tenantId, actor.id, 'dsr.status_changed', {
        dsrId: id,
        previousStatus: previous,
        newStatus: status,
      });
    }
    return room;
  }

  anomalies(type: AnomalyType | null): Promise<Anomaly[]> {
    return this.tx.run(async (manager) => {
      const params: unknown[] = [this.context.tenantId, MAX_ANOMALIES];
      const typeFilter = type === null ? '' : `AND anomaly_type = $${params.push(type)}`;
      return manager.query(
        `SELECT anomaly_type AS "anomalyType", source_id AS "sourceId", description,
                observed_at AS "observedAt", details, created_at AS "createdAt"
           FROM nexus_operational_anomalies
          WHERE tenant_id = $1 ${typeFilter}
          ORDER BY observed_at ASC, source_id
          LIMIT $2`,
        params,
      );
    });
  }

  private async reload<T extends { id: string; tenantId: string }>(
    repository: TenantRepository<T>,
    id: string,
    label: string,
  ): Promise<T> {
    const entity = await repository.findOneBy({ id } as Parameters<TenantRepository<T>['findOneBy']>[0]);
    if (!entity) {
      throw new NotFoundException(`${label} not found`);
    }
    return entity;
  }
}
