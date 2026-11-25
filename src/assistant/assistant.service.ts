import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { LlmService } from '../llm/llm.service';
import { NOT_COVERED, policyMessages } from './assistant.prompts';
import {
  PolicyAnswerResponse,
  PolicyAnswerSchema,
  PolicyCitation,
  PolicyQuestion,
} from './assistant.schemas';
import { selectPassages, toPassages } from './passages';

/** Citations shown with an answer, at most. */
const MAX_CITATIONS = 5;
const EXCERPT_CHARS = 600;

@Injectable()
export class AssistantService {
  private readonly budgetChars: number;

  constructor(
    private readonly llm: LlmService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.budgetChars = config.get('limits', { infer: true }).maxPolicyContextChars;
  }

  /**
   * Answers a question from the policies sent, and only from them.
   *
   * The model's answer stands only with a citation of a passage it was
   * actually shown. Otherwise the employee is told the policies don't cover
   * it — a confident answer with nothing behind it is the failure that
   * matters here, more than an unanswered question.
   */
  async answerPolicyQuestion(input: PolicyQuestion): Promise<PolicyAnswerResponse> {
    const all = toPassages(input.policies);
    const selection = selectPassages(all, input.question, this.budgetChars);
    const context = {
      policies: input.policies.length,
      passages: all.length,
      selected: selection.passages.length,
      complete: selection.complete,
    };

    // Nothing in the policies shares a word with the question: no call, no tokens.
    if (!selection.passages.length) {
      return {
        result: { answered: false, answer: NOT_COVERED, confidence: 'low', citations: [] },
        context,
        usage: { model: this.llm.model, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    const { data, usage } = await this.llm.structured({
      name: 'policy_answer',
      schema: PolicyAnswerSchema,
      messages: policyMessages(selection.passages, input.question),
    });

    const shown = new Map(selection.passages.map((p) => [p.id, p]));
    const citations: PolicyCitation[] = [...new Set(data.passages)]
      .map((id) => shown.get(id))
      .filter((p) => p !== undefined)
      .slice(0, MAX_CITATIONS)
      .map((p) => ({
        ref: p.ref,
        title: p.title,
        version: p.version,
        passage: p.id,
        excerpt: p.text.length > EXCERPT_CHARS ? `${p.text.slice(0, EXCERPT_CHARS)}…` : p.text,
      }));

    const answered = data.answered && citations.length > 0;
    return {
      result: answered
        ? { answered, answer: data.answer, confidence: data.confidence, citations }
        : {
            answered,
            answer: data.answered ? NOT_COVERED : data.answer,
            confidence: 'low',
            citations: [],
          },
      context,
      usage,
    };
  }
}
