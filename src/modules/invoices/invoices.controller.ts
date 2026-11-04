import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amount, asObject, isUuid, oneOf, optionalDate, optionalString, requiredString } from '../core/http/validation.js';
import { INVOICE_STATUSES, type InvoiceStatus } from './invoice.entity.js';
import { type InvoiceInput, InvoicesService, type InvoiceUpdate, type InvoiceView } from './invoices.service.js';

export class InvoiceInputDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ example: 'INV-2026-0042' }) invoiceNumber!: string;
  @ApiProperty({ required: false, nullable: true, type: String }) description?: string | null;
  @ApiProperty({ format: 'date' }) issueDate!: string;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'date' }) dueDate?: string | null;
  @ApiProperty({ example: '12500.00' }) amountExclVat!: string;
  @ApiProperty({ required: false, example: '2625.00' }) vatAmount?: string;
  @ApiProperty({ required: false, enum: ['draft', 'issued'], description: 'Only on create' }) status?: 'draft' | 'issued';
}

export class InvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date' }) issueDate!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) dueDate!: string | null;
  @ApiProperty() amountExclVat!: string;
  @ApiProperty() vatAmount!: string;
  @ApiProperty() totalAmount!: string;
  @ApiProperty({ enum: INVOICE_STATUSES }) status!: InvoiceStatus;
  @ApiProperty({ description: 'Issued and past its due date' }) overdue!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) paidAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class InvoiceStatusDto {
  @ApiProperty({ enum: INVOICE_STATUSES }) status!: InvoiceStatus;
}

function invoiceFields(raw: Record<string, unknown>, partial: boolean): InvoiceInput | InvoiceUpdate {
  const out: InvoiceUpdate & { clientId?: string; status?: 'draft' | 'issued' } = {};
  if (!partial) {
    if (!isUuid(raw.clientId)) throw new BadRequestException('clientId must be a client id (UUID)');
    out.clientId = raw.clientId;
    if (raw.status !== undefined) out.status = oneOf('status', raw.status, ['draft', 'issued'] as const);
  } else if (raw.clientId !== undefined || raw.status !== undefined) {
    throw new BadRequestException('clientId and status cannot be edited here; use PATCH /v1/invoices/:id/status for the status');
  }
  if (!partial || raw.invoiceNumber !== undefined) out.invoiceNumber = requiredString('invoiceNumber', raw.invoiceNumber, 50).trim();
  if (!partial || raw.description !== undefined) out.description = optionalString('description', raw.description, 255)?.trim() || null;
  if (!partial || raw.issueDate !== undefined) {
    const issue = optionalDate('issueDate', raw.issueDate);
    if (!issue) throw new BadRequestException('issueDate is required (YYYY-MM-DD)');
    out.issueDate = issue;
  }
  if (!partial || raw.dueDate !== undefined) out.dueDate = optionalDate('dueDate', raw.dueDate);
  if (!partial || raw.amountExclVat !== undefined) out.amountExclVat = amount('amountExclVat', raw.amountExclVat);
  if (raw.vatAmount !== undefined) out.vatAmount = amount('vatAmount', raw.vatAmount);
  else if (!partial) out.vatAmount = '0.00';
  if (!partial && out.dueDate && out.issueDate && out.dueDate < out.issueDate) throw new BadRequestException('dueDate must be on or after issueDate');
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

@ApiTags('invoices')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ version: '1' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  @ApiOperation({ summary: 'Invoices of the active tenant' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: INVOICE_STATUSES })
  @ApiOkResponse({ type: [InvoiceDto] })
  @ApiErrors(400)
  list(@Query('clientId') clientId?: string, @Query('status') status?: string): Promise<InvoiceView[]> {
    if (clientId !== undefined && !isUuid(clientId)) throw new BadRequestException('clientId must be a UUID');
    return this.invoices.list({ clientId, status: status === undefined ? undefined : oneOf('status', status, INVOICE_STATUSES) });
  }

  @Post('invoices')
  @ApiOperation({ summary: 'Record an invoice (audit: invoice.created)' })
  @ApiBody({ type: InvoiceInputDto })
  @ApiCreatedResponse({ type: InvoiceDto })
  @ApiErrors(400, 409)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<InvoiceView> {
    return this.invoices.create(invoiceFields(asObject(body), false) as InvoiceInput, identity);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'One invoice' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiErrors(400, 404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceView> {
    return this.invoices.get(id);
  }

  @Patch('invoices/:id')
  @ApiOperation({ summary: 'Edit a draft invoice (audit: invoice.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: InvoiceInputDto })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiErrors(400, 404, 409)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<InvoiceView> {
    return this.invoices.update(id, invoiceFields(asObject(body), true), identity);
  }

  @Patch('invoices/:id/status')
  @ApiOperation({ summary: 'Issue, mark paid or cancel an invoice (audit: invoice.status_changed)', description: 'draft → issued | cancelled, issued → paid | cancelled.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: InvoiceStatusDto })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiErrors(400, 404, 409)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<InvoiceView> {
    return this.invoices.changeStatus(id, oneOf('status', asObject(body).status, INVOICE_STATUSES), identity);
  }

  @Get('clients/:id/invoices')
  @ApiOperation({ summary: 'Invoices of one client' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [InvoiceDto] })
  @ApiErrors(400, 404)
  forClient(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceView[]> {
    return this.invoices.listForClient(id);
  }
}
