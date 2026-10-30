import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { SEARCH_ENTITY_TYPES, type SearchEntityType, type SearchHit, SearchService } from './search.service.js';

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const MAX_LIMIT = 20;

export class SearchHitDto {
  @ApiProperty({ enum: SEARCH_ENTITY_TYPES })
  entityType!: SearchEntityType;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'MediaMarkt Amsterdam Noord' })
  title!: string;

  @ApiProperty({ example: 'Store · MM-AMS-N · Amsterdam' })
  subtitle!: string;

  @ApiProperty({ example: '/retailpower/stores/2f7c…', description: 'Web app route that opens the record' })
  route!: string;
}

@ApiTags('search')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search stores, work orders, agreements and client rooms of the active tenant',
    description: `Case-insensitive substring match on names, titles, store codes and cities; at most \`limit\` hits per record type.`,
  })
  @ApiQuery({ name: 'q', required: true, description: `${MIN_QUERY_LENGTH}–${MAX_QUERY_LENGTH} characters`, example: 'mediamarkt' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: `Hits per record type (1–${MAX_LIMIT}, default 5)` })
  @ApiOkResponse({ type: [SearchHitDto] })
  @ApiErrors(400)
  async search(
    @Query('q') q: string | undefined,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ): Promise<SearchHit[]> {
    const query = (q ?? '').trim();
    if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
      throw new BadRequestException(`q must be ${MIN_QUERY_LENGTH}–${MAX_QUERY_LENGTH} characters`);
    }
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
    }
    return this.searchService.search(query, limit);
  }
}
