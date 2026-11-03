import { NextResponse, after } from 'next/server';
import { processSubmission, SubmissionError, UploadedFile } from '@/lib/processSubmission';
import { saveSubmission } from '@/lib/store';
import { markQuestionsPending, runQuestionGeneration } from '@/lib/questions/run';

export const runtime = 'nodejs';

async function toUpload(value: FormDataEntryValue | null): Promise<UploadedFile | null> {
  if (!value || typeof value === 'string') {
    return null;
  }
  return { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
}

/**
 * Receives a submission: form fields studentId, assignmentId, one "recording"
 * file (.codelapse) and one or more "code" files. Answers with the new
 * submission's id, or a message the student can act on.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'The upload could not be read. Try again.' }, { status: 400 });
  }

  const bundle = (await toUpload(form.get('recording'))) ?? { name: '', bytes: new Uint8Array() };
  const codeFiles = (await Promise.all(form.getAll('code').map(toUpload))).filter(
    (f): f is UploadedFile => f !== null
  );

  try {
    const record = processSubmission({
      studentId: String(form.get('studentId') ?? ''),
      assignmentId: String(form.get('assignmentId') ?? ''),
      bundle,
      codeFiles
    });
    await saveSubmission(record, bundle, codeFiles);
    // The hour to answer starts now; the questions are written after the response is sent.
    await markQuestionsPending(record.id);
    after(() => runQuestionGeneration(record.id));
    return NextResponse.json({ id: record.id }, { status: 201 });
  } catch (err) {
    if (err instanceof SubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Submission failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
