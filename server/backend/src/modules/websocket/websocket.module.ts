import { Global, Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from '../hits/ports';
import { LiveGateway } from './live.gateway';

@Global()
@Module({
  providers: [LiveGateway, { provide: EVENT_PUBLISHER, useExisting: LiveGateway }],
  exports: [LiveGateway, EVENT_PUBLISHER],
})
export class WebsocketModule {}
