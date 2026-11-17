import { NextResponse, after } from 'next/server';
import { getCodeCheck, getSubmission } from '@/lib/store';
import { markCodeCheckPending, runCodeCheck } from '@/lib/codecheck/run';

export const runtime = 'nodejs';
// AI work runs after the reply; on Vercel it must finish within this many seconds.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** Checks the code again after a failure (instructor view). */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!(await getSubmission(id))) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  const current = await getCodeCheck(id);
  if (current?.status === 'pending' || current?.status === 'ready') {
    return NextResponse.json({ error: `The code check is already ${current.status}.` }, { status: 409 });
  }
  await markCodeCheckPending(id);
  after(() => runCodeCheck(id));
  return NextResponse.json({ status: 'pending' }, { status: 202 });
}
