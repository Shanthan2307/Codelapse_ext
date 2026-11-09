import { RetryButton } from './RetryButton';

/** Instructor action: write the questions again after generation failed. */
export function RetryQuestionsButton({ submissionId }: { submissionId: string }) {
  return <RetryButton url={`/api/submissions/${submissionId}/questions`} />;
}
