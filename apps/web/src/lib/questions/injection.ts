import type { InjectionSignal } from './types';

/**
 * Text in a student's files that addresses a grader or an AI. The generator is
 * told to ignore such text; this list lets the instructor see it too. It is a
 * signal, not proof of anything: a comment can mention "AI" innocently.
 */
const PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts?)/i,
  /\b(?:you are|act as) (?:an? )?(?:ai|assistant|grader|evaluator)\b/i,
  /\b(?:ai|llm|chatgpt|claude|grader|evaluator|marker)\b.{0,40}\b(?:give|award|mark|grade|score|pass|rate)\b/i,
  /\b(?:give|award)\b.{0,30}\b(?:full|top|maximum|perfect) (?:marks|score|points|grade)\b/i,
  /\bsystem prompt\b/i,
  /\bdo not (?:flag|report|mention)\b/i
];

export function detectInjectionSignals(files: { name: string; content: string }[]): InjectionSignal[] {
  const signals: InjectionSignal[] = [];
  for (const file of files) {
    file.content.split(/\r?\n/).forEach((line, i) => {
      if (PATTERNS.some((p) => p.test(line))) {
        signals.push({ file: file.name, line: i + 1, text: line.trim().slice(0, 200) });
      }
    });
  }
  return signals;
}
