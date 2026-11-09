import Anthropic from '@anthropic-ai/sdk';

/** Turns an Anthropic API failure into one sentence an instructor can act on. */
export function describeApiError(err: unknown): string {
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
  return `The request failed: ${err instanceof Error ? err.message : String(err)}`;
}

/** The API's own explanation, without the status code and JSON around it. */
export function apiErrorMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : err.message;
}
