import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { SmtpService } from './smtp.service';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, SmtpService],
  exports: [InvitationsService, SmtpService],
})
export class InvitationsModule {}
