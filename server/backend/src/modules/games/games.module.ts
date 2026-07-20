import { Body, Controller, Get, Module, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { CreateGameInput, CreateRoundInput, GamesService } from './games.service';

@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('modes')
  @RequirePermissions('games:read')
  @ApiOperation({ summary: 'Modos de juego disponibles en el motor' })
  modes() {
    return this.games.registry.list().map((mode) => ({
      key: mode.key,
      name: mode.displayName,
      description: mode.description,
    }));
  }

  @Get()
  @RequirePermissions('games:read')
  async list(@Query('take') take = '50') {
    const items = await this.prisma.game.findMany({
      take: Math.min(Number.parseInt(take, 10) || 50, 200),
      orderBy: { createdAt: 'desc' },
      include: { gameMode: true },
    });
    return { items, total: items.length };
  }

  @Get(':id')
  @RequirePermissions('games:read')
  get(@Param('id') id: string) {
    return this.games.get(id);
  }

  @Post()
  @RequirePermissions('games:write')
  @ApiOperation({ summary: 'Crea una partida' })
  async create(@Body() body: CreateGameInput, @Req() req: { user?: AuthenticatedUser }) {
    const game = await this.games.create({ ...body, created_by: req.user?.username });
    await this.audit.record({
      user: req.user,
      action: 'create',
      entity: 'game',
      entityId: game.id,
      after: game,
    });
    return game;
  }

  @Post(':id/rounds')
  @RequirePermissions('rounds:write')
  @ApiOperation({ summary: 'Añade una ronda y calcula su plan determinista' })
  addRound(@Param('id') id: string, @Body() body: CreateRoundInput) {
    return this.games.addRound(id, body);
  }

  @Post(':id/rounds/:roundId/start')
  @RequirePermissions('games:control')
  @ApiOperation({
    summary: 'Autoriza el comienzo de la ronda (el cronómetro lo lleva el coordinador)',
  })
  async start(
    @Param('id') id: string,
    @Param('roundId') roundId: string,
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.games.start(id, roundId);
    await this.audit.record({
      user: req.user,
      action: 'start_game',
      entity: 'round',
      entityId: roundId,
      after: result.command,
    });
    return result;
  }

  @Post(':id/control/:action')
  @RequirePermissions('games:control')
  @ApiOperation({ summary: 'pause_game · resume_game · abort_game · end_game' })
  async control(
    @Param('id') id: string,
    @Param('action') action: 'pause_game' | 'resume_game' | 'abort_game' | 'end_game',
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const result = await this.games.control(id, action);
    await this.audit.record({ user: req.user, action, entity: 'game', entityId: id });
    return result;
  }
}

@Module({
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
