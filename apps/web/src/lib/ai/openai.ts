import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

/** The OpenAI model used unless CODELAPSE_OPENAI_MODEL says otherwise. */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

export function openAIModelName(): string {
  return process.env.CODELAPSE_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

export function createOpenAIClient(): OpenAI {
  // Reads OPENAI_API_KEY from the environment (apps/web/.env.local for the site).
  return new OpenAI({ timeout: 5 * 60 * 1000 });
}

/**
 * Sends one request through the Responses API with structured output, so the
 * reply is parsed and checked against `schema`. Throws `makeError(message)`
 * with a sentence an instructor can act on when anything goes wrong.
 */
export async function parseWithOpenAI<T extends z.ZodType>(
  client: OpenAI,
  model: string,
  schema: T,
  formatName: string,
  prompt: { system: string; user: string },
  makeError: (message: string) => Error
): Promise<{ output: z.infer<T>; usage?: { inputTokens: number; outputTokens: number } }> {
  let response;
  try {
    response = await client.responses.parse({
      model,
      instructions: prompt.system,
      input: prompt.user,
      max_output_tokens: 16000,
      reasoning: { effort: 'medium' },
      text: { format: zodTextFormat(schema, formatName) }
    });
  } catch (err) {
    throw makeError(describeOpenAIError(err));
  }

  const refusal = response.output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .find((part) => part.type === 'refusal');
  if (refusal) {
    throw makeError('The model declined this request.');
  }
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    throw makeError(
      reason === 'max_output_tokens'
        ? 'The model ran out of room before finishing.'
        : `The model stopped before finishing (${reason ?? 'unknown reason'}).`
    );
  }
  if (!response.output_parsed) {
    throw makeError('The model replied in an unexpected format.');
  }
  return {
    output: response.output_parsed as z.infer<T>,
    usage: response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : undefined
  };
}

/** Turns an OpenAI API failure into one sentence an instructor can act on. */
export function describeOpenAIError(err: unknown, service = 'OpenAI'): string {
  if (err instanceof OpenAI.AuthenticationError) {
    return `The ${service} API key is missing or invalid. Set ${keyName(service)} where the site runs.`;
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return `The ${service} API key is not allowed to use this model.`;
  }
  if (err instanceof OpenAI.NotFoundError) {
    return service === 'OpenAI'
      ? `The OpenAI model "${openAIModelName()}" was not found for this key. Set CODELAPSE_OPENAI_MODEL to a model it can use.`
      : `The ${service} model was not found. Check the model name setting.`;
  }
  if (err instanceof OpenAI.RateLimitError) {
    // OpenAI answers 429 both for a short-term limit and for an account with no credit.
    const noCredit = [err.type, err.code].some((v) => v === 'insufficient_quota' || v === 'credit_balance_exhausted');
    return noCredit
      ? `The ${service} account has no credit left. Add credit in its billing settings, then try again.`
      : `The ${service} API is rate limiting requests (or the plan's concurrency limit was reached). Try again in a minute.`;
  }
  if (err instanceof OpenAI.BadRequestError) {
    return `The ${service} API rejected the request: ${err.message}`;
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return `Could not reach the ${service} API.`;
  }
  if (err instanceof OpenAI.APIError) {
    return `The ${service} API returned an error (${err.status}).`;
  }
  if (err instanceof Error && /api key|apiKey/i.test(err.message)) {
    return `No ${service} API key found. Set ${keyName(service)} where the site runs.`;
  }
  return `The request failed: ${err instanceof Error ? err.message : String(err)}`;
}

function keyName(service: string): string {
  return service === 'OpenAI' ? 'OPENAI_API_KEY' : `${service.toUpperCase()}_API_KEY`;
}
