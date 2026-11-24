import OpenAI from 'openai';
import { z } from 'zod';
import { FEATHERLESS_BASE_URL, parseWithFeatherless } from '../ai/featherless';
import type { TutorMove } from './types';

/**
 * The tutor must answer while the student waits, so each request gets a short
 * timeout and no automatic retry; a failed reply falls back to a fixed line.
 */
export const TUTOR_TIMEOUT_MS = 25_000;

/**
 * Chosen in testing (November 2026) on Featherless: replies in about one
 * second, kept to the rules when asked for the answer or for code, refused
 * personal questions, and rephrased questions clearly. A different model from
 * the answer reviewer (gpt-oss-120b), so no model judges its own conversation.
 * CODELAPSE_VOICE_MODEL overrides it.
 */
export const DEFAULT_TUTOR_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';

export function tutorModelName(): string {
  return process.env.CODELAPSE_VOICE_MODEL || DEFAULT_TUTOR_MODEL;
}

export const tutorReplySchema = z.object({
  say: z.string(),
  move: z.enum(['follow_up', 'clarify', 'hint', 'next'])
});

export interface TutorModel {
  readonly provider: 'featherless';
  readonly model: string;
  reply(prompt: { system: string; user: string }): Promise<{
    output: { say: string; move: TutorMove };
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}

export class TutorModelError extends Error {}

export class FeatherlessTutorModel implements TutorModel {
  readonly provider = 'featherless' as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(model = tutorModelName()) {
    if (!process.env.FEATHERLESS_API_KEY) {
      throw new TutorModelError('FEATHERLESS_API_KEY is not set.');
    }
    this.model = model;
    this.client = new OpenAI({
      baseURL: FEATHERLESS_BASE_URL,
      apiKey: process.env.FEATHERLESS_API_KEY,
      timeout: TUTOR_TIMEOUT_MS,
      maxRetries: 0
    });
  }

  reply(prompt: { system: string; user: string }) {
    return parseWithFeatherless(this.client, this.model, tutorReplySchema, 'tutor_reply', prompt, (m) => new TutorModelError(m));
  }
}
