import { Module } from '@nestjs/common';
import { MatrixLayoutsController } from './matrix-layouts.controller';
import { MatrixLayoutsService } from './matrix-layouts.service';

@Module({
  controllers: [MatrixLayoutsController],
  providers: [MatrixLayoutsService],
  exports: [MatrixLayoutsService],
})
export class MatrixLayoutsModule {}
