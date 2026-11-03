import { NextResponse } from 'next/server';
import { getAnswers, getQuestionSet, getSubmission, saveAnswers } from '@/lib/store';
import { AnswerError, acceptAnswers } from '@/lib/questions/answers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Receives the student's answers: JSON { answers: [{ questionId, text }] }. */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const record = await getSubmission(id);
  if (!record) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  let input: { questionId: string; text: string }[];
  try {
    const body = (await request.json()) as { answers?: unknown };
    input = Array.isArray(body.answers)
      ? body.answers.map((a) => ({ questionId: String(a?.questionId ?? ''), text: String(a?.text ?? '') }))
      : [];
  } catch {
    return NextResponse.json({ error: 'The answers could not be read. Try again.' }, { status: 400 });
  }

  try {
    const answers = acceptAnswers(record, await getQuestionSet(id), await getAnswers(id), input, Date.now());
    if (!(await saveAnswers(id, answers))) {
      return NextResponse.json({ error: 'Your answers were already submitted.' }, { status: 409 });
    }
    return NextResponse.json({ submittedAt: answers.submittedAt }, { status: 201 });
  } catch (err) {
    if (err instanceof AnswerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Saving answers failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
