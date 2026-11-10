/** Which service's model writes the questions and reviews the answers. */
export type AIProvider = 'featherless' | 'openai' | 'anthropic';

const PROVIDERS: readonly AIProvider[] = ['featherless', 'openai', 'anthropic'];

/**
 * CODELAPSE_AI_PROVIDER picks the provider ("featherless", "openai" or
 * "anthropic"). Without it, the first one with a key is used: Featherless,
 * then OpenAI, then Anthropic.
 */
export function aiProvider(): AIProvider {
  const chosen = process.env.CODELAPSE_AI_PROVIDER?.trim().toLowerCase() as AIProvider | undefined;
  if (chosen && PROVIDERS.includes(chosen)) {
    return chosen;
  }
  if (process.env.FEATHERLESS_API_KEY) return 'featherless';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'anthropic';
}
