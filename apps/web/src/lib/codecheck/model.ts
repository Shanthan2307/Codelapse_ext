import { AI_REQUEST_TIMEOUT_MS } from '../ai/timeouts';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type OpenAI from 'openai';
import { describeApiError } from '../ai/claudeErrors';
import { createOpenAIClient, openAIModelName, parseWithOpenAI } from '../ai/openai';
import { createFeatherlessClient, featherlessReviewModelName, parseWithFeatherless } from '../ai/featherless';
import { aiProvider } from '../ai/provider';
import { DEFAULT_EVALUATOR_MODEL } from '../evaluation/model';
import { CodeCheckOutput, CodeCheckOutputSchema } from './schema';

type Usage = { inputTokens: number; outputTokens: number };

/** The model that checks the code. Another provider only needs another implementation. */
export interface CodeCheckModel {
  provider: string;
  model: string;
  check(prompt: { system: string; user: string }): Promise<{ output: CodeCheckOutput; usage?: Usage }>;
}

export class CodeCheckModelError extends Error {}

const makeError = (message: string) => new CodeCheckModelError(message);

/**
 * The code is checked by the answer reviewer's model, not the question
 * writer's: it was the one that caught confidently wrong claims in testing.
 * CODELAPSE_CODECHECK_MODEL overrides it for any provider.
 */
export function createCodeCheckModel(): CodeCheckModel {
  const override = process.env.CODELAPSE_CODECHECK_MODEL || undefined;
  const provider = aiProvider();
  if (provider === 'featherless') {
    const client = createFeatherlessClient();
    const model = override ?? featherlessReviewModelName();
    return {
      provider,
      model,
      check: (prompt) => parseWithFeatherless(client, model, CodeCheckOutputSchema, 'code_check', prompt, makeError)
    };
  }
  if (provider === 'openai') {
    const client: OpenAI = createOpenAIClient();
    const model = override ?? openAIModelName();
    return {
      provider,
      model,
      check: (prompt) => parseWithOpenAI(client, model, CodeCheckOutputSchema, 'code_check', prompt, makeError)
    };
  }
  return new ClaudeCodeCheckModel(override ?? process.env.CODELAPSE_EVALUATOR_MODEL ?? DEFAULT_EVALUATOR_MODEL);
}

/** Claude, with the same setup as the other two roles (structured outputs, server-side fallback). */
export class ClaudeCodeCheckModel implements CodeCheckModel {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;

  constructor(readonly model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 1 });
  }

  async check(prompt: { system: string; user: string }) {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: betaZodOutputFormat(CodeCheckOutputSchema) },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }]
      });
    } catch (err) {
      throw new CodeCheckModelError(describeApiError(err));
    }
    if (response.stop_reason === 'refusal') throw new CodeCheckModelError('The model declined to check this code.');
    if (response.stop_reason === 'max_tokens') throw new CodeCheckModelError('The model ran out of room before finishing the check.');
    if (!response.parsed_output) throw new CodeCheckModelError('The model replied in an unexpected format.');
    return {
      output: response.parsed_output,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    };
  }
}
