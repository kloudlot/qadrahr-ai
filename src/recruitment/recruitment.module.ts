import { Module } from '@nestjs/common';
import { TextExtractionService } from '../extraction/text-extraction.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({
  controllers: [RecruitmentController],
  providers: [RecruitmentService, TextExtractionService],
})
export class RecruitmentModule {}
