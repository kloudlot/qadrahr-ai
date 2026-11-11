import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { LlmService } from '../llm/llm.service';

@Controller('health')
export class HealthController {
  constructor(private readonly llm: LlmService) {}

  /** Liveness and load. No secrets, no tenant data. */
  @Public()
  @Get()
  health() {
    return { status: 'ok', model: this.llm.model, ...this.llm.load };
  }
}
