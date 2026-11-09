import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { describeApiError } from '../ai/claudeErrors';
import { EvaluatorOutput, EvaluatorOutputSchema } from './schema';

/** The model that reviews answers. Another provider only needs another implementation. */
export interface EvaluatorModel {
  provider: string;
  model: string;
  evaluate(prompt: { system: string; user: string }): Promise<{
    output: EvaluatorOutput;
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}

export class EvaluatorModelError extends Error {}

export const DEFAULT_EVALUATOR_MODEL = 'claude-opus-5-5';

/** Claude as the answer evaluator: same setup as the question writer (structured outputs, server-side fallback). */
export class ClaudeEvaluatorModel implements EvaluatorModel {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { model?: string; client?: Anthropic } = {}) {
    this.model = options.model ?? process.env.CODELAPSE_EVALUATOR_MODEL ?? DEFAULT_EVALUATOR_MODEL;
    this.client = options.client ?? new Anthropic({ timeout: 5 * 60 * 1000 });
  }

  async evaluate(prompt: { system: string; user: string }) {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: betaZodOutputFormat(EvaluatorOutputSchema) },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }]
      });
    } catch (err) {
      throw new EvaluatorModelError(describeApiError(err));
    }
    if (response.stop_reason === 'refusal') {
      throw new EvaluatorModelError('The model declined to review these answers.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new EvaluatorModelError('The model ran out of room before finishing the review.');
    }
    if (!response.parsed_output) {
      throw new EvaluatorModelError('The model replied in an unexpected format.');
    }
    return {
      output: response.parsed_output,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    };
  }
}
