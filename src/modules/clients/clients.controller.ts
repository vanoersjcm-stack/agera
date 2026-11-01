import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { type ClientInput, type ClientRecord, ClientsService, type ClientSummary, type ClientUpdate, type ContactInput } from './clients.service.js';
import { CLIENT_STATUSES, type ClientStatus, CREDIT_STATUSES, type CreditStatus } from './entities/client.entity.js';
import type { Contact } from './entities/contact.entity.js';

export class ClientInputDto {
  @ApiProperty({ example: 'TechNova Electronics' }) name!: string;
  @ApiProperty({ required: false, nullable: true, type: String, example: 'TechNova Electronics B.V.' }) legalName?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) vatNumber?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) city?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) country?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, description: 'Chamber of Commerce (KvK) number' }) kvkNumber?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) sector?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) address?: string | null;
  @ApiProperty({ required: false, example: 'Net 30 days' }) paymentTerms?: string;
  @ApiProperty({ required: false, example: '50000.00' }) creditLimit?: string;
  @ApiProperty({ required: false, enum: CREDIT_STATUSES }) creditStatus?: CreditStatus;
  @ApiProperty({ required: false, nullable: true, type: String, description: 'Customer number in the ERP system' }) erpId?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'uuid' }) accountManagerId?: string | null;
}

export class ClientUpdateDto extends ClientInputDto {
  @ApiProperty({ required: false, enum: CLIENT_STATUSES }) status?: ClientStatus;
}

export class ClientDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) legalName!: string | null;
  @ApiProperty({ type: String, nullable: true }) vatNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty({ enum: CLIENT_STATUSES }) status!: ClientStatus;
  @ApiProperty({ type: String, nullable: true }) kvkNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) sector!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty() paymentTerms!: string;
  @ApiProperty({ example: '50000.00' }) creditLimit!: string;
  @ApiProperty({ enum: CREDIT_STATUSES }) creditStatus!: CreditStatus;
  @ApiProperty({ type: String, nullable: true }) erpId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) accountManagerId!: string | null;
  @ApiProperty({ type: String, nullable: true }) accountManagerName!: string | null;
  @ApiProperty() activeAgreements!: number;
  @ApiProperty() activeRooms!: number;
  @ApiProperty({ description: 'Planned revenue of approved financial plans for this client', example: '240000.00' }) contractValue!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class ContactInputDto {
  @ApiProperty() firstName!: string;
  @ApiProperty({ required: false, nullable: true, type: String }) lastName?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) email?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) phone?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) roleTitle?: string | null;
  @ApiProperty({ required: false, description: 'Only one primary contact per client' }) isPrimary?: boolean;
}

export class ContactDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) roleTitle!: string | null;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class PlanRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() modelName!: string;
  @ApiProperty() fiscalYear!: number;
  @ApiProperty() status!: string;
}

export class ClientRecordDto {
  @ApiProperty({ type: ClientDto }) client!: ClientDto;
  @ApiProperty({ type: [ContactDto] }) contacts!: ContactDto[];
  @ApiProperty({ type: 'array', items: { type: 'object' } }) agreements!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' } }) rooms!: unknown[];
  @ApiProperty({ type: [PlanRefDto] }) plans!: PlanRefDto[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Stores linked to this client' }) stores!: unknown[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientFields(raw: Record<string, unknown>, partial: boolean): ClientUpdate {
  const out: ClientUpdate = {};
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 200).trim();
  for (const [key, max] of [['legalName', 200], ['vatNumber', 50], ['city', 100], ['country', 100], ['kvkNumber', 20], ['sector', 100], ['address', 255], ['erpId', 50]] as const) {
    if (!partial || raw[key] !== undefined) out[key] = optionalString(key, raw[key], max)?.trim() || null;
  }
  if (raw.paymentTerms !== undefined) out.paymentTerms = requiredString('paymentTerms', raw.paymentTerms, 100).trim();
  if (raw.creditLimit !== undefined) {
    const value = typeof raw.creditLimit === 'number' ? raw.creditLimit : Number(raw.creditLimit);
    if (raw.creditLimit === '' || raw.creditLimit === null || !Number.isFinite(value) || value < 0 || value >= 1e12) {
      throw new BadRequestException('creditLimit must be a non-negative amount');
    }
    out.creditLimit = value.toFixed(2);
  }
  if (raw.creditStatus !== undefined) {
    if (!CREDIT_STATUSES.includes(raw.creditStatus as CreditStatus)) {
      throw new BadRequestException(`creditStatus must be one of ${CREDIT_STATUSES.join(', ')}`);
    }
    out.creditStatus = raw.creditStatus as CreditStatus;
  }
  if (raw.accountManagerId !== undefined) out.accountManagerId = optionalUuid('accountManagerId', raw.accountManagerId);
  if (raw.status !== undefined) {
    if (!partial || !CLIENT_STATUSES.includes(raw.status as ClientStatus)) {
      throw new BadRequestException(`status must be one of ${CLIENT_STATUSES.join(', ')}`);
    }
    out.status = raw.status as ClientStatus;
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

function contactFields(raw: Record<string, unknown>, partial: boolean): Partial<ContactInput> {
  const out: Partial<ContactInput> = {};
  if (!partial || raw.firstName !== undefined) out.firstName = requiredString('firstName', raw.firstName, 100).trim();
  for (const [key, max] of [['lastName', 100], ['phone', 50], ['roleTitle', 150]] as const) {
    if (!partial || raw[key] !== undefined) out[key] = optionalString(key, raw[key], max)?.trim() || null;
  }
  if (!partial || raw.email !== undefined) {
    const email = optionalString('email', raw.email, 255)?.trim().toLowerCase() || null;
    if (email !== null && !EMAIL.test(email)) throw new BadRequestException('email must be a valid e-mail address');
    out.email = email;
  }
  if (raw.isPrimary !== undefined) {
    if (typeof raw.isPrimary !== 'boolean') throw new BadRequestException('isPrimary must be a boolean');
    out.isPrimary = raw.isPrimary;
  } else if (!partial) {
    out.isPrimary = false;
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

@ApiTags('clients')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'clients', version: '1' })
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Clients of the active tenant with active agreements, active rooms and contract value' })
  @ApiOkResponse({ type: [ClientDto] })
  list(): Promise<ClientSummary[]> {
    return this.clients.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a client company (audit: client.created)' })
  @ApiBody({ type: ClientInputDto })
  @ApiCreatedResponse({ type: ClientDto })
  @ApiErrors(400)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<ClientSummary> {
    return this.clients.create(clientFields(asObject(body), false) as ClientInput, identity);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Client record with contacts, agreements, client rooms and financial plans' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ClientRecordDto })
  @ApiErrors(400, 404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ClientRecord> {
    return this.clients.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client details or archive/reactivate it (audit: client.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ClientUpdateDto })
  @ApiOkResponse({ type: ClientDto })
  @ApiErrors(400, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<ClientSummary> {
    return this.clients.update(id, clientFields(asObject(body), true), identity);
  }

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Add a contact to a client (audit: contact.created)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ContactInputDto })
  @ApiCreatedResponse({ type: ContactDto })
  @ApiErrors(400, 404)
  addContact(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<Contact> {
    return this.clients.addContact(id, contactFields(asObject(body), false) as ContactInput, identity);
  }

  @Patch(':id/contacts/:contactId')
  @ApiOperation({ summary: 'Update a contact (audit: contact.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiBody({ type: ContactInputDto })
  @ApiOkResponse({ type: ContactDto })
  @ApiErrors(400, 404)
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<Contact> {
    return this.clients.updateContact(id, contactId, contactFields(asObject(body), true), identity);
  }
}
