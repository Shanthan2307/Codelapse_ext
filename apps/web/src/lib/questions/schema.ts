import { z } from 'zod';

/**
 * What the question generator must return. Sent to the model as a JSON schema
 * (structured outputs), so the reply always has this shape; the rules a schema
 * cannot express are checked in validate.ts.
 */
export const GeneratorOutputSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(['process', 'code']),
      moment_id: z.string().nullable(),
      code_ref: z
        .object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int() })
        .nullable(),
      concept: z.string(),
      question: z.string(),
      rationale: z.string(),
      strong_answer_points: z.array(z.string())
    })
  ),
  notes_for_instructor: z.string().nullable()
});

export type GeneratorOutput = z.infer<typeof GeneratorOutputSchema>;
