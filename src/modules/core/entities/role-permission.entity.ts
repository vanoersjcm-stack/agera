import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation, Unique } from 'typeorm';
import { Tenant } from './tenant.entity.js';

@Entity({ name: 'roles_permissions' })
@Unique('uq_roles_permissions', ['tenantId', 'roleName', 'permission'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_name', type: 'varchar', length: 50 })
  roleName!: string;

  @Column({ type: 'varchar', length: 100 })
  permission!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Relation<Tenant>;
}
