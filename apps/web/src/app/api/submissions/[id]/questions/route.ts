import { NextResponse, after } from 'next/server';
import { getAnswers, getQuestionSet, getSubmission } from '@/lib/store';
import { studentView } from '@/lib/questions/answers';
import { markQuestionsPending, runQuestionGeneration } from '@/lib/questions/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The student's view of their questions: status, closing time and question text only. */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const record = await getSubmission(id);
  if (!record) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  const set = await getQuestionSet(id);
  const answers = await getAnswers(id);
  return NextResponse.json({
    status: set?.status ?? 'pending',
    closesAt: record.questionsCloseAt,
    questions: set?.status === 'ready' ? studentView(set) : [],
    answered: answers !== null,
    answers: answers?.answers ?? []
  });
}

/** Writes the questions again after a failure (instructor view). */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const record = await getSubmission(id);
  if (!record) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  const set = await getQuestionSet(id);
  if (set?.status === 'ready' || set?.status === 'pending') {
    return NextResponse.json({ error: `The questions are already ${set.status}.` }, { status: 409 });
  }
  await markQuestionsPending(id);
  after(() => runQuestionGeneration(id));
  return NextResponse.json({ status: 'pending' }, { status: 202 });
}
