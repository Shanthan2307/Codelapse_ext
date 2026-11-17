import type { CodeCheck, HintProgress, IssueProgress, StudentCodeCheck } from './types';

export const MAX_REFLECTION_CHARS = 2000;

/** A reason a hint request cannot be accepted, with the HTTP status that fits it. */
export class HintError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function emptyProgress(): HintProgress {
  return { issues: {} };
}

function progressFor(progress: HintProgress | null, issueId: string): IssueProgress {
  return progress?.issues[issueId] ?? { hintsShown: 1, revealedAt: [] };
}

/**
 * The check as the student may see it: no traces or instructor notes, and
 * only the hints they have opened, so later hints cannot be read early.
 */
export function studentCodeCheck(check: CodeCheck | null, progress: HintProgress | null): StudentCodeCheck {
  if (!check || check.status !== 'ready') {
    return { status: check?.status ?? 'pending', works: null, issues: [] };
  }
  return {
    status: 'ready',
    works: check.works,
    issues: check.issues.map((issue) => {
      const p = progressFor(progress, issue.id);
      return {
        id: issue.id,
        severity: issue.severity,
        concept: issue.concept,
        title: issue.title,
        excerpt: issue.excerpt,
        whatHappens: issue.whatHappens,
        hints: issue.hints.slice(0, Math.max(1, p.hintsShown)),
        totalHints: issue.hints.length,
        reflection: p.reflection ?? ''
      };
    })
  };
}

/**
 * Applies one student action to the progress: open the next hint, or save
 * what they think should change. Returns the new progress to store.
 */
export function applyHintAction(
  check: CodeCheck | null,
  progress: HintProgress | null,
  action: { issueId: string; reveal?: boolean; reflection?: string },
  now: number
): HintProgress {
  if (!check || check.status !== 'ready') {
    throw new HintError('The code check is not ready yet.', 409);
  }
  const issue = check.issues.find((i) => i.id === action.issueId);
  if (!issue) {
    throw new HintError('That hint does not exist.', 404);
  }
  const current = progressFor(progress, issue.id);
  const next: IssueProgress = { ...current, revealedAt: [...current.revealedAt] };
  if (action.reveal) {
    if (next.hintsShown >= issue.hints.length) {
      throw new HintError('All the hints for this are already showing.', 409);
    }
    next.hintsShown += 1;
    next.revealedAt.push(now);
  }
  if (action.reflection !== undefined) {
    const text = action.reflection.trim();
    if (text.length > MAX_REFLECTION_CHARS) {
      throw new HintError(`Keep your answer under ${MAX_REFLECTION_CHARS} characters.`, 400);
    }
    next.reflection = text;
    next.reflectionAt = now;
  }
  return { issues: { ...(progress?.issues ?? {}), [issue.id]: next } };
}
