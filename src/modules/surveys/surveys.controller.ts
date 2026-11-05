import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllowExternal } from '../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { type Answers, type Audience, QUESTION_TYPES, type Question, STATUSES, type SurveyInput, SurveysService } from './surveys.service.js';

const OBJ = { schema: { type: 'object' } };

function questions(value: unknown): Question[] {
  if (!Array.isArray(value) || value.length > 50) throw new BadRequestException('questions must be a list of at most 50 questions');
  const seen = new Set<string>();
  return value.map((raw, i) => {
    const o = asObject(raw);
    const id = requiredString(`questions[${i}].id`, o.id, 50);
    if (seen.has(id)) throw new BadRequestException(`questions[${i}].id "${id}" is used twice`);
    const type = oneOf(`questions[${i}].type`, o.type, QUESTION_TYPES);
    const q: Question = { id, type, label: requiredString(`questions[${i}].label`, o.label, 300), required: o.required === true };
    if (type === 'single_choice' || type === 'multi_choice') {
      if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 20) throw new BadRequestException(`questions[${i}].options must list 2 to 20 options`);
      q.options = o.options.map((x, j) => requiredString(`questions[${i}].options[${j}]`, x, 200));
      if (new Set(q.options).size !== q.options.length) throw new BadRequestException(`questions[${i}].options must be unique`);
    }
    if (type === 'rating') {
      const min = o.minRating ?? 1, max = o.maxRating ?? 5;
      if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) > 10 || (min as number) >= (max as number)) throw new BadRequestException(`questions[${i}] rating range must be whole numbers within 0–10`);
      q.minRating = min as number;
      q.maxRating = max as number;
    }
    if (o.showIf !== undefined && o.showIf !== null) {
      const c = asObject(o.showIf);
      const ref = requiredString(`questions[${i}].showIf.questionId`, c.questionId, 50);
      if (!seen.has(ref)) throw new BadRequestException(`questions[${i}].showIf must refer to an earlier question`);
      q.showIf = { questionId: ref, equals: requiredString(`questions[${i}].showIf.equals`, String(c.equals ?? ''), 200) };
    }
    seen.add(id);
    return q;
  });
}

function fields(raw: Record<string, unknown>, partial: boolean): Partial<SurveyInput> {
  const out: Partial<SurveyInput> = {};
  if (!partial || raw.title !== undefined) out.title = requiredString('title', raw.title, 200);
  if (!partial || raw.description !== undefined) out.description = optionalString('description', raw.description, 5000);
  if (!partial || raw.questions !== undefined) out.questions = questions(raw.questions ?? []);
  return out;
}

function optionalNumber(name: string, v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new BadRequestException(`${name} must be a positive number`);
  return v;
}

function audience(body: unknown): Audience {
  const o = asObject(body);
  return {
    targetType: oneOf('targetType', o.targetType, ['single_client', 'client_cohort', 'client_room'] as const),
    clientId: optionalUuid('clientId', o.clientId),
    clientRoomId: optionalUuid('clientRoomId', o.clientRoomId),
    all: o.all === true,
    sector: optionalString('sector', o.sector, 100),
    minArr: optionalNumber('minArr', o.minArr),
    maxArr: optionalNumber('maxArr', o.maxArr),
    accountManagerId: optionalUuid('accountManagerId', o.accountManagerId),
    maxHealthScore: optionalNumber('maxHealthScore', o.maxHealthScore),
  };
}

@ApiTags('surveys')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'surveys', version: '1' })
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @ApiOperation({ summary: 'Surveys with response counts, NPS and the edition limit (Vanguard: 3 active)' })
  @ApiOkResponse(OBJ)
  list(): Promise<unknown> {
    return this.surveys.list();
  }

  @Get('summary')
  @ApiOperation({ summary: 'Customer feedback roll-up: NPS over the last 90 days, per client and per survey' })
  @ApiOkResponse(OBJ)
  summary(): Promise<unknown> {
    return this.surveys.summary();
  }

  @Post('audience')
  @HttpCode(200)
  @ApiOperation({ summary: 'Count the client companies and contacts a dispatch would reach; cohort filters are Enterprise (402 on Vanguard)' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402)
  audience(@Body() body: unknown): Promise<unknown> {
    return this.surveys.audience(audience(body));
  }

  @Post()
  @ApiOperation({ summary: 'Create a survey draft; 402 on Vanguard for branching or advanced question types (audit: survey.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 402)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.surveys.create(fields(asObject(body), false) as SurveyInput, identity);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Survey with its questions and dispatches' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.surveys.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit title, description or (drafts only) questions (audit: survey.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402, 404, 409)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.surveys.update(id, fields(asObject(body), true), identity);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate, close, reopen or archive; 402 on Vanguard for a 4th active survey (audit: survey.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402, 404, 409)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.surveys.setStatus(id, oneOf('status', asObject(body).status, STATUSES), identity);
  }

  @Post(':id/dispatch')
  @ApiOperation({ summary: 'Send an active survey to one client, a client room or a cohort; clients answer in the client portal (audit: survey.dispatched)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 402, 404, 409)
  dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.surveys.dispatch(id, audience(body), identity);
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Responses, response rate, NPS, per-question breakdown, by sector and account manager; filters are Enterprise' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'sector', required: false })
  @ApiQuery({ name: 'accountManagerId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402, 404)
  analytics(@Param('id', ParseUUIDPipe) id: string, @Query('sector') sector?: string, @Query('accountManagerId') accountManagerId?: string): Promise<unknown> {
    return this.surveys.analytics(id, { sector: optionalString('sector', sector, 100), accountManagerId: optionalUuid('accountManagerId', accountManagerId) });
  }

  @Get(':id/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'CSV of all responses (all editions; audit: survey.exported)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file', schema: { type: 'string' } })
  @ApiErrors(404)
  export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<string> {
    return this.surveys.export(id, identity);
  }
}

@ApiTags('portal')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'portal/surveys', version: '1' })
export class PortalSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'Active surveys sent to the client contact’s company (client portal)' })
  @ApiOkResponse(OBJ)
  @ApiErrors(403)
  list(@CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.surveys.portalList(identity);
  }

  @Post(':id/respond')
  @AllowExternal()
  @ApiOperation({ summary: 'Submit answers once per contact; an NPS answer feeds the client’s account health (audit: survey.response_submitted)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 403, 404, 409)
  respond(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const answers = asObject(asObject(body).answers ?? {}) as Answers;
    return this.surveys.respond(id, answers, identity);
  }
}
