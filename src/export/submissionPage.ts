/** Shown as an example when asking a student for the submission page address. */
export const EXAMPLE_SUBMISSION_URL = 'http://192.168.1.20:3100/courses/cs101/assignments/a3-reverse';

/**
 * Checks the configured submission page address. Returns a message for the
 * student when it can't be opened, or null when it is a usable web address.
 */
export function submissionUrlProblem(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) {
    return 'No submission page is set. Add the address your instructor gave you to the "CodeLapse: Submission Url" setting.';
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return `"${text}" is not a web address. Set "CodeLapse: Submission Url" to the address your instructor gave you, starting with http:// or https://.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `The submission page must be a web address starting with http:// or https://, not "${url.protocol}".`;
  }
  return null;
}
