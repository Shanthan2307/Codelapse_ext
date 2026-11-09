import { z } from 'zod';

/**
 * What the answer evaluator must return. Score ranges (0-3) are also checked
 * on the server, since JSON schema limits are not enforced by the API.
 */
export const EvaluatorOutputSchema = z.object({
  evaluations: z.array(
    z.object({
      question_id: z.string(),
      addresses_question: z.boolean(),
      specificity: z.number().int(),
      consistency: z.number().int(),
      reasoning: z.number().int(),
      evidence_quotes: z.array(z.string()),
      explanation: z.string(),
      concerns: z.array(z.string())
    })
  ),
  overall_summary: z.string(),
  notes_for_instructor: z.string().nullable()
});

export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;
