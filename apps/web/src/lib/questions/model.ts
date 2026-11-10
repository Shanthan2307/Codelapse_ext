import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GeneratorOutput, GeneratorOutputSchema } from './schema';
import { describeApiError } from '../ai/claudeErrors';
import { createOpenAIClient, openAIModelName, parseWithOpenAI } from '../ai/openai';
import { createFeatherlessClient, featherlessModelName, parseWithFeatherless } from '../ai/featherless';
import type OpenAI from 'openai';

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

/** An OpenAI model (GPT) as the question writer, with structured output. */
export class OpenAIQuestionModel implements QuestionModel {
  readonly provider = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: { model?: string; client?: OpenAI } = {}) {
    this.model = options.model ?? openAIModelName();
    this.client = options.client ?? createOpenAIClient();
  }

  generate(prompt: { system: string; user: string }) {
    return parseWithOpenAI(this.client, this.model, GeneratorOutputSchema, 'feedback_questions', prompt, (message) => new QuestionModelError(message));
  }
}

/** An open-source model served by Featherless (DeepSeek V3 by default). */
export class FeatherlessQuestionModel implements QuestionModel {
  readonly provider = 'featherless';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: { model?: string; client?: OpenAI } = {}) {
    this.model = options.model ?? featherlessModelName();
    this.client = options.client ?? createFeatherlessClient();
  }

  generate(prompt: { system: string; user: string }) {
    return parseWithFeatherless(this.client, this.model, GeneratorOutputSchema, 'feedback_questions', prompt, (message) => new QuestionModelError(message));
  }
}
