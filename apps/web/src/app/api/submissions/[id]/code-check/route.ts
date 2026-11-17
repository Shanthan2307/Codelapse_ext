import { NextResponse } from 'next/server';
import { getCodeCheck, getHintProgress, getSubmission, updateHintProgress } from '@/lib/store';
import { HintError, applyHintAction, studentCodeCheck } from '@/lib/codecheck/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The student's view of the code check: issues and the hints they have opened. */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  return NextResponse.json(studentCodeCheck(await getCodeCheck(id), await getHintProgress(id)));
}

/** Opens the next hint ({ issueId, reveal: true }) or saves the student's thinking ({ issueId, reflection }). */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  let action: { issueId: string; reveal?: boolean; reflection?: string };
  try {
    const body = (await request.json()) as Record<string, unknown>;
    action = {
      issueId: String(body.issueId ?? ''),
      reveal: body.reveal === true,
      reflection: typeof body.reflection === 'string' ? body.reflection : undefined
    };
  } catch {
    return NextResponse.json({ error: 'The request could not be read. Try again.' }, { status: 400 });
  }
  try {
    const check = await getCodeCheck(id);
    // Safe when two clicks, or two server instances, update at once.
    const progress = await updateHintProgress(id, (current) => applyHintAction(check, current, action, Date.now()));
    const view = studentCodeCheck(check, progress);
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof HintError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Saving hint progress failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
