import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { SubmissionError, checkUploadPlan } from '@/lib/processSubmission';
import { backend } from '@/lib/storage';
import { uploadPaths } from '@/lib/uploads';

export const runtime = 'nodejs';

/**
 * Step one of a submission on the hosted site. Vercel limits a request to
 * about 4.5 MB, so the browser uploads the recording and code straight to
 * storage with the one-off links returned here, then sends only the names to
 * POST /api/submissions. Locally the answer is { mode: "form" }: post the
 * files to /api/submissions as before.
 *
 * Body: { assignmentId, studentName, recording: { name, size }, code: [{ name, size }] }
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The upload could not be read. Try again.' }, { status: 400 });
  }
  const file = (v: unknown) => {
    const f = (v ?? {}) as { name?: unknown; size?: unknown };
    return { name: String(f.name ?? ''), size: Number(f.size ?? 0) };
  };
  try {
    const plan = checkUploadPlan({
      assignmentId: String(body.assignmentId ?? ''),
      studentName: String(body.studentName ?? ''),
      recording: file(body.recording),
      code: Array.isArray(body.code) ? body.code.map(file) : []
    });
    const store = backend();
    const uploadId = randomBytes(16).toString('hex');
    const paths = uploadPaths(uploadId, plan.codeNames);
    const recording = await store.signedUpload(paths.recording);
    if (!recording) {
      return NextResponse.json({ mode: 'form' });
    }
    const code = await Promise.all(
      paths.code.map(async ({ name, path }) => ({ name, ...(await store.signedUpload(path))! }))
    );
    return NextResponse.json({ mode: 'direct', uploadId, recording, code });
  } catch (err) {
    if (err instanceof SubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Preparing an upload failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
