import { CoordinatorOnly } from '../auth/job-roles.js';
import {
  BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseFilters, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amount, asObject, oneOf, optionalDate, optionalString, optionalUuid, parseTimestamp } from '../core/http/validation.js';
import { detectImageMimeType, IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from '../retailcare/media/image-type.js';
import { UploadExceptionFilter } from '../retailcare/media/upload-exception.filter.js';
import {
  APPAREL_ITEMS, AVAILABILITY, CLAIM_STATUSES, CLAIM_TYPES, CONTRACT_TYPES, type CrewInput, OperationsService, type Position, RMA_REASONS, RMA_STATUSES,
  SHIFT_DECISIONS, VEHICLE_SIDES,
} from './operations.service.js';

const OBJ = { schema: { type: 'object' } };

function required<T>(name: string, value: T | null): T {
  if (value === null) throw new BadRequestException(`${name} is required`);
  return value;
}

function int(name: string, value: unknown, min: number, max: number, fallback?: number): number {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new BadRequestException(`${name} must be a whole number between ${min} and ${max}`);
  return value;
}

function tags(name: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) throw new BadRequestException(`${name} must be a list of at most 30 items`);
  const out = value.map((v) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 60) throw new BadRequestException(`${name} items must be short texts`);
    return v.trim();
  });
  return [...new Set(out)];
}

function days(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new BadRequestException('availableDays must be weekday numbers 1 (Monday) to 7 (Sunday)');
  return [...new Set(value as number[])].sort();
}

function position(raw: Record<string, unknown>): Position | null {
  if (raw.lat === undefined && raw.lng === undefined) return null;
  const { lat, lng } = raw;
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new BadRequestException('lat and lng must be valid coordinates');
  return { lat, lng };
}

function crewFields(raw: Record<string, unknown>, partial: boolean): Partial<CrewInput> {
  const out: Partial<CrewInput> = {};
  if (!partial) out.userId = required('userId', optionalUuid('userId', raw.userId));
  if (!partial || raw.contractType !== undefined) out.contractType = oneOf('contractType', raw.contractType ?? 'fixed', CONTRACT_TYPES);
  if (!partial || raw.languages !== undefined) out.languages = tags('languages', raw.languages);
  if (!partial || raw.brandCertifications !== undefined) out.brandCertifications = tags('brandCertifications', raw.brandCertifications);
  if (!partial || raw.availableDays !== undefined) out.availableDays = days(raw.availableDays ?? [1, 2, 3, 4, 5]);
  if (!partial || raw.availability !== undefined) out.availability = oneOf('availability', raw.availability ?? 'available', AVAILABILITY);
  if (!partial || raw.homeRegion !== undefined) out.homeRegion = optionalString('homeRegion', raw.homeRegion, 100);
  if (!partial || raw.phone !== undefined) out.phone = optionalString('phone', raw.phone, 40);
  if (!partial || raw.notes !== undefined) out.notes = optionalString('notes', raw.notes, 2000);
  return out;
}

interface UploadedImage { buffer: Buffer; mimetype: string; size: number }

@ApiTags('RetailPower operations')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'operations', version: '1' })
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Back-office dashboard: KPI strip, chain performance matrix (last 30 days) and the latest visit photos' })
  @ApiOkResponse(OBJ)
  dashboard(): Promise<unknown> {
    return this.ops.dashboard();
  }

  @Get('crew')
  @ApiOperation({ summary: 'Crew directory: merchandiser profiles with contract, languages, brand certifications and availability' })
  @ApiOkResponse(OBJ)
  crew(): Promise<unknown[]> {
    return this.ops.crew();
  }

  @CoordinatorOnly()
  @Post('crew')
  @ApiOperation({ summary: 'Add a crew profile for a user (audit: crew.created)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 409)
  createCrew(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.createCrew(crewFields(asObject(body), false) as CrewInput, identity);
  }

  @CoordinatorOnly()
  @Patch('crew/:id')
  @ApiOperation({ summary: 'Edit a crew profile (audit: crew.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404)
  updateCrew(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.updateCrew(id, crewFields(asObject(body), true), identity);
  }

  @Get('shifts')
  @ApiOperation({ summary: 'Shift log with validation status (filter by status, period and person)' })
  @ApiOkResponse(OBJ)
  shifts(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('userId') userId?: string): Promise<unknown[]> {
    return this.ops.shifts({
      status: status ? oneOf('status', status, ['pending', 'approved', 'rejected'] as const) : null,
      from: parseTimestamp('from', from),
      to: parseTimestamp('to', to),
      userId: optionalUuid('userId', userId),
    });
  }

  @Get('shifts/mine/open')
  @ApiOperation({ summary: "The signed-in user's running shift, or null" })
  myOpenShift(@CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.myOpenShift(identity);
  }

  @Post('shifts/clock-in')
  @ApiOperation({ summary: 'Clock in (optionally at a store or visit, with GPS position for the geofence check) (audit: shift.clocked_in)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 409)
  clockIn(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.clockIn(
      { storeId: optionalUuid('storeId', raw.storeId), visitId: optionalUuid('visitId', raw.visitId), position: position(raw), notes: optionalString('notes', raw.notes, 1000) },
      identity,
    );
  }

  @Post('shifts/clock-out')
  @ApiOperation({ summary: 'Clock out of the running shift (audit: shift.clocked_out)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 409)
  clockOut(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.clockOut(position(asObject(body ?? {})), identity);
  }

  @CoordinatorOnly()
  @Post('shifts')
  @ApiOperation({ summary: 'Record a shift by hand, e.g. a forgotten clock-in (audit: shift.recorded)' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  createShift(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.createShift(
      {
        userId: required('userId', optionalUuid('userId', raw.userId)),
        storeId: optionalUuid('storeId', raw.storeId),
        clockInAt: required('clockInAt', parseTimestamp('clockInAt', raw.clockInAt)),
        clockOutAt: required('clockOutAt', parseTimestamp('clockOutAt', raw.clockOutAt)),
        notes: optionalString('notes', raw.notes, 1000),
      },
      identity,
    );
  }

  @CoordinatorOnly()
  @Patch('shifts/:id/validation')
  @ApiOperation({ summary: 'Coordinator sign-off: approve or reject the hours of a finished shift (audit: shift.approved / shift.rejected)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  validateShift(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.validateShift(id, oneOf('decision', raw.decision, SHIFT_DECISIONS), optionalString('reason', raw.reason, 1000), identity);
  }

  @CoordinatorOnly()
  @Get('shifts/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Approved hours in a period as CSV (semicolon-separated) for HR / payroll (audit: shift.hours_exported)' })
  @ApiErrors(400)
  async exportHours(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @CurrentUser() identity: AuthenticatedUser): Promise<string> {
    const start = required('from', parseTimestamp('from', from));
    const end = required('to', parseTimestamp('to', to));
    if (end <= start) throw new BadRequestException('to must be after from');
    return this.ops.hoursCsv(start, end, identity);
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'Vehicle allocations with the state of their four-photo pre-trip check' })
  vehicles(): Promise<unknown[]> {
    return this.ops.vehicles();
  }

  @CoordinatorOnly()
  @Post('vehicles')
  @ApiOperation({ summary: 'Allocate a vehicle to a person; it stays "check pending" until four photos are uploaded (audit: vehicle.allocated)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 409)
  allocateVehicle(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const vehicleId = optionalString('vehicleId', raw.vehicleId, 30);
    return this.ops.allocateVehicle(
      {
        userId: required('userId', optionalUuid('userId', raw.userId)),
        vehicleId: required('vehicleId', vehicleId?.trim() || null),
        description: optionalString('description', raw.description, 150),
        allocatedFrom: optionalDate('allocatedFrom', raw.allocatedFrom),
        allocatedUntil: optionalDate('allocatedUntil', raw.allocatedUntil),
      },
      identity,
    );
  }

  @Post('vehicles/:id/photos/:side')
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  @ApiOperation({ summary: 'Upload one of the four pre-trip photos (front, back, left, right) (audit: vehicle.photo_uploaded)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'side', enum: VEHICLE_SIDES })
  @ApiConsumes('multipart/form-data')
  @ApiErrors(400, 404, 409)
  uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('side') side: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<unknown> {
    const s = oneOf('side', side, VEHICLE_SIDES);
    if (!file || file.size === 0) throw new BadRequestException('file is required');
    const mime = detectImageMimeType(file.buffer);
    if (!mime) throw new BadRequestException(`file must be one of ${IMAGE_MIME_TYPES.join(', ')}`);
    return this.ops.uploadVehiclePhoto(id, s, { data: file.buffer, mimeType: mime }, identity);
  }

  @Get('vehicles/:id/photos/:side')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download a pre-trip photo' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'side', enum: VEHICLE_SIDES })
  @ApiErrors(400, 404)
  async photo(@Param('id', ParseUUIDPipe) id: string, @Param('side') side: string): Promise<StreamableFile> {
    const { stream, mimeType } = await this.ops.vehiclePhoto(id, oneOf('side', side, VEHICLE_SIDES));
    return new StreamableFile(stream, { type: mimeType });
  }

  @Post('vehicles/:id/check')
  @ApiOperation({ summary: 'Complete the pre-trip check (all four photos required); the vehicle becomes active (audit: vehicle.check_completed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  completeCheck(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body ?? {});
    return this.ops.completeVehicleCheck(
      id,
      { odometerKm: raw.odometerKm === undefined || raw.odometerKm === null ? null : int('odometerKm', raw.odometerKm, 0, 2_000_000), damageNotes: optionalString('damageNotes', raw.damageNotes, 2000) },
      identity,
    );
  }

  @CoordinatorOnly()
  @Post('vehicles/:id/return')
  @ApiOperation({ summary: 'Register that the vehicle was returned (audit: vehicle.returned)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(404, 409)
  returnVehicle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.returnVehicle(id, identity);
  }

  @Get('apparel')
  @ApiOperation({ summary: 'Apparel issued to crew members' })
  apparel(): Promise<unknown[]> {
    return this.ops.apparel();
  }

  @Post('apparel')
  @ApiOperation({ summary: 'Issue apparel to a person (audit: apparel.issued)' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  issueApparel(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.issueApparel(
      {
        userId: required('userId', optionalUuid('userId', raw.userId)),
        item: oneOf('item', raw.item, APPAREL_ITEMS),
        size: optionalString('size', raw.size, 10),
        quantity: int('quantity', raw.quantity, 1, 100, 1),
        issuedOn: optionalDate('issuedOn', raw.issuedOn),
        notes: optionalString('notes', raw.notes, 1000),
      },
      identity,
    );
  }

  @Post('apparel/:id/return')
  @ApiOperation({ summary: 'Register returned apparel (audit: apparel.returned)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(409)
  returnApparel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.returnApparel(id, identity);
  }

  @Get('rma')
  @ApiOperation({ summary: 'Return (RMA) cases' })
  rma(): Promise<unknown[]> {
    return this.ops.rmaCases();
  }

  @Post('rma')
  @ApiOperation({ summary: 'Open a return case for goods from a store (audit: rma.opened)' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  openRma(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.openRma(
      {
        storeId: required('storeId', optionalUuid('storeId', raw.storeId)),
        productId: optionalUuid('productId', raw.productId),
        clientId: optionalUuid('clientId', raw.clientId),
        quantity: int('quantity', raw.quantity, 1, 100000, 1),
        reason: oneOf('reason', raw.reason, RMA_REASONS),
        description: optionalString('description', raw.description, 2000),
      },
      identity,
    );
  }

  @CoordinatorOnly()
  @Patch('rma/:id/status')
  @ApiOperation({ summary: 'Move a return case: open → approved → shipped → credited, or rejected (audit: rma.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  rmaStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.setRmaStatus(id, oneOf('status', asObject(body).status, RMA_STATUSES), identity);
  }

  @Get('stock-claims')
  @ApiOperation({ summary: 'Stock-protection claims' })
  claims(): Promise<unknown[]> {
    return this.ops.claims();
  }

  @Post('stock-claims')
  @ApiOperation({ summary: 'Submit a stock-protection claim (audit: stock_claim.submitted)' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  submitClaim(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.ops.submitClaim(
      {
        storeId: required('storeId', optionalUuid('storeId', raw.storeId)),
        productId: optionalUuid('productId', raw.productId),
        clientId: optionalUuid('clientId', raw.clientId),
        claimType: oneOf('claimType', raw.claimType, CLAIM_TYPES),
        quantity: int('quantity', raw.quantity, 1, 100000, 1),
        amount: amount('amount', raw.amount ?? 0),
        description: optionalString('description', raw.description, 2000),
      },
      identity,
    );
  }

  @CoordinatorOnly()
  @Patch('stock-claims/:id/status')
  @ApiOperation({ summary: 'Decide on a claim: submitted → approved / rejected, approved → paid (audit: stock_claim.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  claimStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.ops.setClaimStatus(id, oneOf('status', asObject(body).status, CLAIM_STATUSES), identity);
  }
}
