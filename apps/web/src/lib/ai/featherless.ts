import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { describeOpenAIError } from './openai';

/**
 * Featherless (featherless.ai) serves open-source models through an
 * OpenAI-compatible API, so the OpenAI SDK talks to it with a different address.
 */
export const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';

/** Chosen because it follows a JSON schema reliably on Featherless; CODELAPSE_FEATHERLESS_MODEL overrides it. */
export const DEFAULT_FEATHERLESS_MODEL = 'deepseek-ai/DeepSeek-V3-0324';

export function featherlessModelName(): string {
  return process.env.CODELAPSE_FEATHERLESS_MODEL || DEFAULT_FEATHERLESS_MODEL;
}

/**
 * The answer reviewer is a different model from the question writer, so one
 * model never marks its own questions. gpt-oss-120b was chosen after testing:
 * it caught a confidently wrong answer that DeepSeek V3 rated as strong.
 * CODELAPSE_FEATHERLESS_REVIEW_MODEL overrides it.
 */
export const DEFAULT_FEATHERLESS_REVIEW_MODEL = 'openai/gpt-oss-120b';

export function featherlessReviewModelName(): string {
  return process.env.CODELAPSE_FEATHERLESS_REVIEW_MODEL || DEFAULT_FEATHERLESS_REVIEW_MODEL;
}

export function createFeatherlessClient(): OpenAI {
  return new OpenAI({
    baseURL: FEATHERLESS_BASE_URL,
    apiKey: process.env.FEATHERLESS_API_KEY,
    timeout: 5 * 60 * 1000
  });
}

/** Open models occasionally return malformed JSON; one more try usually fixes it. */
const FORMAT_ATTEMPTS = 2;

/**
 * Sends one chat request asking for JSON that matches `schema`. The server may
 * not enforce the schema strictly, so the reply is parsed and validated here,
 * with one retry if it doesn't match.
 */
export async function parseWithFeatherless<T extends z.ZodType>(
  client: OpenAI,
  model: string,
  schema: T,
  formatName: string,
  prompt: { system: string; user: string },
  makeError: (message: string) => Error
): Promise<{ output: z.infer<T>; usage?: { inputTokens: number; outputTokens: number } }> {
  let lastProblem = '';
  for (let attempt = 1; attempt <= FORMAT_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        max_tokens: 8000,
        temperature: 0.3,
        response_format: zodResponseFormat(schema, formatName),
        messages: [
          { role: 'system', content: `${prompt.system}\n\nReply with JSON only, matching the requested schema exactly.` },
          { role: 'user', content: prompt.user }
        ]
      });
    } catch (err) {
      throw makeError(describeOpenAIError(err, 'Featherless'));
    }

    const choice = response.choices[0];
    if (!choice) {
      lastProblem = 'The model returned no reply.';
      continue;
    }
    if (choice.message.refusal) {
      throw makeError('The model declined this request.');
    }
    if (choice.finish_reason === 'length') {
      throw makeError('The model ran out of room before finishing.');
    }
    const parsed = schema.safeParse(parseJson(choice.message.content ?? ''));
    if (parsed.success) {
      return {
        output: parsed.data,
        usage: response.usage
          ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
          : undefined
      };
    }
    lastProblem = 'The model replied in an unexpected format.';
  }
  throw makeError(lastProblem);
}

/** JSON from a reply, tolerating a ```json fence around it. Undefined if it isn't JSON. */
export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse((fenced ? fenced[1] : text).trim());
  } catch {
    return undefined;
  }
}
