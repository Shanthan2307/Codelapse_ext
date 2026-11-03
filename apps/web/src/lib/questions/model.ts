import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GeneratorOutput, GeneratorOutputSchema } from './schema';

/**
 * The model that writes questions. Everything else in this folder is
 * model-independent, so a different model (for example an open-source one
 * served locally) only needs another implementation of this interface.
 */
export interface QuestionModel {
  provider: string;
  model: string;
  generate(prompt: { system: string; user: string }): Promise<{
    output: GeneratorOutput;
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}

/** A failure worth showing to the instructor as is. */
export class QuestionModelError extends Error {}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/**
 * Claude, through the Anthropic API. Credentials come from the environment
 * (ANTHROPIC_API_KEY, or an `ant auth login` profile). Structured outputs make
 * the reply match GeneratorOutputSchema. If Claude declines, the server-side
 * fallback re-runs the request on Anthropic's recommended fallback model.
 */
export class ClaudeQuestionModel implements QuestionModel {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { model?: string; client?: Anthropic } = {}) {
    this.model = options.model ?? process.env.CODELAPSE_QUESTION_MODEL ?? DEFAULT_CLAUDE_MODEL;
    this.client = options.client ?? new Anthropic({ timeout: 5 * 60 * 1000 });
  }

  async generate(prompt: { system: string; user: string }) {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: betaZodOutputFormat(GeneratorOutputSchema) },
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }]
      });
    } catch (err) {
      throw new QuestionModelError(describeApiError(err));
    }

    if (response.stop_reason === 'refusal') {
      throw new QuestionModelError('The model declined to write questions for this submission.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new QuestionModelError('The model ran out of room before finishing the questions.');
    }
    if (!response.parsed_output) {
      throw new QuestionModelError('The model replied in an unexpected format.');
    }
    return {
      output: response.parsed_output,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    };
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY where the site runs.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'The Anthropic API key is not allowed to use this model.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The Anthropic API is rate limiting requests. Try again in a minute.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    const detail = apiErrorMessage(err);
    if (/credit balance/i.test(detail)) {
      return 'The Anthropic account has no credit left. Add credits under Plans & Billing in the Anthropic Console, then try again.';
    }
    return `The Anthropic API rejected the request: ${detail}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API.';
  }
  if (err instanceof Anthropic.APIError) {
    return `The Anthropic API returned an error (${err.status}).`;
  }
  // The SDK throws a plain Error when no credentials can be found at all.
  if (err instanceof Error && /api key|apiKey|authentication|credentials/i.test(err.message)) {
    return 'No Anthropic credentials found. Set ANTHROPIC_API_KEY where the site runs.';
  }
  return `Question generation failed: ${err instanceof Error ? err.message : String(err)}`;
}

/** The API's own explanation, without the status code and JSON around it. */
function apiErrorMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : err.message;
}
