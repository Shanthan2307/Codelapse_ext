import type { GeneratedQuestion } from '../questions/types';
import { MAX_SAY_WORDS } from './prompt';
import { spokenText } from './session';
import type { TutorMove } from './types';

const MOVES: readonly TutorMove[] = ['follow_up', 'clarify', 'hint', 'next'];

/** Characters that only appear in a reply when it contains code. */
const CODE_CHARS = /[;{}]|```|==|!=|\+\+|--|->|<=|>=/;

/** Phrases that ask for personal information. */
const PERSONAL = /\b(your (full |real |last )?name|student (id|number)|e-?mail|phone|home address|where (do|are) you (live|from)|how old are you|your age)\b/i;

/** A run of this many words shared with the question writer's notes counts as giving the answer away. */
const LEAK_WORDS = 6;

const words = (text: string) => text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];

function sharesRun(a: string[], b: string[], n: number): boolean {
  if (a.length < n || b.length < n) return false;
  const runs = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) runs.add(b.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= a.length; i++) if (runs.has(a.slice(i, i + n).join(' '))) return true;
  return false;
}

export interface CheckedReply {
  say: string;
  move: TutorMove;
  problems: string[];
}

/**
 * Checks a tutor reply before it is spoken: the shape, the length, no code,
 * nothing from the question writer's private notes, no personal questions.
 * The spoken text is cleaned of markdown either way.
 */
export function checkTutorReply(output: unknown, question: GeneratedQuestion): CheckedReply {
  const problems: string[] = [];
  const raw = (output ?? {}) as { say?: unknown; move?: unknown };
  const say = spokenText(typeof raw.say === 'string' ? raw.say : '');
  const move = MOVES.includes(raw.move as TutorMove) ? (raw.move as TutorMove) : 'follow_up';
  if (!MOVES.includes(raw.move as TutorMove)) {
    problems.push(`"move" must be one of ${MOVES.join(', ')}.`);
  }
  if (!say) {
    problems.push('"say" is empty.');
  }
  if (words(say).length > MAX_SAY_WORDS) {
    problems.push(`"say" is longer than ${MAX_SAY_WORDS} words; it is spoken aloud, so keep it to one or two short sentences.`);
  }
  if (CODE_CHARS.test(typeof raw.say === 'string' ? raw.say : '')) {
    problems.push('"say" contains code. Never write or dictate code; refer to the student\'s lines in words.');
  }
  if (PERSONAL.test(say)) {
    problems.push('"say" asks about personal information. Talk only about the code.');
  }
  const sayWords = words(say);
  if (question.strongAnswerPoints.some((point) => sharesRun(sayWords, words(point), LEAK_WORDS))) {
    problems.push('"say" repeats the private question notes, which gives the answer away. Ask a question that points the student in a direction instead.');
  }
  return { say, move, problems };
}

/** Used when the model's replies could not be used: keeps the conversation going without giving anything away. */
export function fallbackReply(canFollowUp: boolean): { say: string; move: TutorMove } {
  return canFollowUp
    ? { say: 'Could you say a little more about how you thought about that?', move: 'follow_up' }
    : { say: "Thanks. Let's move on.", move: 'next' };
}
