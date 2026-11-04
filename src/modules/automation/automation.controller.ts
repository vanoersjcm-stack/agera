import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { ACTIONS, type AutomationInput, AutomationService, OPERATORS, type Step, TRIGGERS } from './automation.service.js';

const OBJ = { schema: { type: 'object' } };

function steps(value: unknown): Step[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new BadRequestException('steps must be a list of 1 to 10 steps');
  return value.map((raw, i) => {
    const o = asObject(raw);
    const c = o.condition === undefined || o.condition === null ? null : asObject(o.condition);
    const config = asObject(o.config ?? {});
    const delay = o.delayMinutes ?? 0;
    if (typeof delay !== 'number' || !Number.isInteger(delay) || delay < 0 || delay > 60 * 24 * 30) throw new BadRequestException(`steps[${i}].delayMinutes must be 0 to 43200`);
    const op = c ? oneOf(`steps[${i}].condition.op`, c.op, OPERATORS) : null;
    return {
      condition: c ? { field: requiredString(`steps[${i}].condition.field`, c.field, 100), op: op!, value: op === 'exists' ? null : optionalString(`steps[${i}].condition.value`, c.value, 200) } : null,
      action: oneOf(`steps[${i}].action`, o.action, ACTIONS),
      config: {
        userId: optionalUuid(`steps[${i}].config.userId`, config.userId),
        title: requiredString(`steps[${i}].config.title`, config.title, 200),
        message: optionalString(`steps[${i}].config.message`, config.message, 2000),
        severity: config.severity === undefined ? undefined : oneOf(`steps[${i}].config.severity`, config.severity, ['low', 'medium', 'high'] as const),
      },
      delayMinutes: delay,
    };
  });
}

function fields(raw: Record<string, unknown>, partial: boolean): Partial<AutomationInput> {
  const out: Partial<AutomationInput> = {};
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 200);
  if (!partial || raw.trigger !== undefined) out.trigger = oneOf('trigger', raw.trigger, Object.keys(TRIGGERS));
  if (!partial || raw.steps !== undefined) out.steps = steps(raw.steps);
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') throw new BadRequestException('active must be true or false');
    out.active = raw.active;
  }
  return out;
}

@ApiTags('automations')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'automations', version: '1' })
export class AutomationController {
  constructor(private readonly automations: AutomationService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Triggers, condition operators and actions an automation can use' })
  @ApiOkResponse(OBJ)
  catalog(): unknown {
    return { triggers: Object.entries(TRIGGERS).map(([value, label]) => ({ value, label })), operators: OPERATORS, actions: ACTIONS };
  }

  @Get()
  @ApiOperation({ summary: 'Automations, with the edition limit (Vanguard: 5 active, linear only)' })
  @ApiOkResponse(OBJ)
  list(): Promise<unknown> {
    return this.automations.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Automation with its last 50 runs' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.automations.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an automation; 402 on Vanguard for multi-step/delayed ones or a 6th active one (audit: automation.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 402)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.automations.create(fields(asObject(body), false) as AutomationInput, identity);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit, activate or pause an automation (audit: automation.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.automations.update(id, fields(asObject(body), true), identity);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an automation and its run history (audit: automation.deleted)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors(404)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    await this.automations.remove(id, identity);
  }
}
