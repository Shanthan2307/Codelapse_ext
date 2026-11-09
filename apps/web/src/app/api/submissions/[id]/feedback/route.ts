import { NextResponse } from 'next/server';
import { getQuestionSet, getSubmission } from '@/lib/store';
import { FeedbackError, emptyFeedback, getFeedback, saveFeedback, validateFeedback } from '@/lib/research/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The instructor's ratings for a submission (instructor-only). */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  return NextResponse.json((await getFeedback(id)) ?? emptyFeedback());
}

/** Replaces the instructor's ratings for a submission. */
export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The feedback could not be read.' }, { status: 400 });
  }
  try {
    const questions = await getQuestionSet(id);
    const feedback = validateFeedback(body, questions?.questions.map((q) => q.id) ?? []);
    await saveFeedback(id, feedback);
    return NextResponse.json(feedback);
  } catch (err) {
    if (err instanceof FeedbackError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Saving instructor feedback failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
