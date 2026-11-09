import { NextResponse, after } from 'next/server';
import { getAnswers, getEvaluation, getSubmission } from '@/lib/store';
import { markEvaluationPending, runEvaluation } from '@/lib/evaluation/run';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Reviews the answers again after a failure (instructor view). */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  if (!(await getAnswers(id))) {
    return NextResponse.json({ error: 'There are no answers to review yet.' }, { status: 409 });
  }
  const current = await getEvaluation(id);
  if (current?.status === 'pending' || current?.status === 'ready') {
    return NextResponse.json({ error: `The review is already ${current.status}.` }, { status: 409 });
  }
  await markEvaluationPending(id);
  after(() => runEvaluation(id));
  return NextResponse.json({ status: 'pending' }, { status: 202 });
}
