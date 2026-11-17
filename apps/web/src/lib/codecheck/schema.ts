import { z } from 'zod';

/** What the code reviewer must return; rules a schema cannot express are in validate.ts. */
export const CodeCheckOutputSchema = z.object({
  traced_cases: z.array(
    z.object({ input: z.string(), expected: z.string(), actual: z.string(), passes: z.boolean() })
  ),
  works: z.boolean(),
  issues: z.array(
    z.object({
      severity: z.enum(['error', 'warning']),
      concept: z.string(),
      title: z.string(),
      code_ref: z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int() }),
      what_happens: z.string(),
      hints: z.array(z.string()),
      explanation_for_instructor: z.string()
    })
  ),
  summary_for_instructor: z.string(),
  notes_for_instructor: z.string().nullable()
});

export type CodeCheckOutput = z.infer<typeof CodeCheckOutputSchema>;
