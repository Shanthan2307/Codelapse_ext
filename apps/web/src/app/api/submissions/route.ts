import { NextResponse, after } from 'next/server';
import { MAX_CODE_FILES, processSubmission, SubmissionError, UploadedFile } from '@/lib/processSubmission';
import { backend } from '@/lib/storage';
import { UPLOAD_ID, uploadPaths } from '@/lib/uploads';
import { saveSubmission } from '@/lib/store';
import { markQuestionsPending, runQuestionGeneration } from '@/lib/questions/run';
import { markCodeCheckPending, runCodeCheck } from '@/lib/codecheck/run';
import { startExternalAiCheck } from '@/lib/aidetect/run';

export const runtime = 'nodejs';
// Question writing and the code check run after the reply; on Vercel they must finish within this.
export const maxDuration = 300;

async function toUpload(value: FormDataEntryValue | null): Promise<UploadedFile | null> {
  if (!value || typeof value === 'string') {
    return null;
  }
  return { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
}

/** The files of a direct upload, read back from storage; a missing file means the upload did not finish. */
async function uploadedFiles(uploadId: string, codeNames: string[]): Promise<{ bundle: UploadedFile; codeFiles: UploadedFile[]; paths: string[] }> {
  if (!UPLOAD_ID.test(uploadId)) throw new SubmissionError('The upload could not be found. Try submitting again.');
  // Names become storage paths: only plain file names, as the code-file rules allow anyway.
  if (codeNames.length > MAX_CODE_FILES) throw new SubmissionError(`Upload at most ${MAX_CODE_FILES} code files.`);
  const bad = codeNames.find((n) => !/^[\w-][\w.-]*$/.test(n));
  if (bad !== undefined) throw new SubmissionError(`"${bad}" is not a valid code file name.`);
  const paths = uploadPaths(uploadId, codeNames);
  const store = backend();
  const recording = await store.getFile(paths.recording);
  if (!recording) throw new SubmissionError('Your recording did not finish uploading. Try submitting again.');
  const codeFiles = await Promise.all(
    paths.code.map(async ({ name, path }) => {
      const bytes = await store.getFile(path);
      if (!bytes) throw new SubmissionError(`"${name}" did not finish uploading. Try submitting again.`);
      return { name, bytes };
    })
  );
  return {
    bundle: { name: 'recording.codelapse', bytes: recording },
    codeFiles,
    paths: [paths.recording, ...paths.code.map((c) => c.path)]
  };
}

/**
 * Receives a submission, in one of two ways:
 * - a form (local site): fields studentName (or a roster studentId), assignmentId,
 *   one "recording" file (.codelapse) and one or more "code" files;
 * - JSON (hosted site), after the files went straight to storage via POST /api/uploads:
 *   { uploadId, studentName, assignmentId, code: [file names] }.
 * Answers with the new submission's id, or a message the student can act on.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let fields: { studentId: string; studentName: string; assignmentId: string };
  let bundle: UploadedFile;
  let codeFiles: UploadedFile[];
  let staged: string[] = [];
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      fields = { studentId: '', studentName: String(body.studentName ?? ''), assignmentId: String(body.assignmentId ?? '') };
      const names = Array.isArray(body.code) ? body.code.map((n) => String(n).split(/[\\/]/).pop() ?? '') : [];
      const files = await uploadedFiles(String(body.uploadId ?? ''), names);
      ({ bundle, codeFiles } = files);
      staged = files.paths;
    } else {
      const form = await request.formData();
      fields = {
        studentId: String(form.get('studentId') ?? ''),
        studentName: String(form.get('studentName') ?? ''),
        assignmentId: String(form.get('assignmentId') ?? '')
      };
      bundle = (await toUpload(form.get('recording'))) ?? { name: '', bytes: new Uint8Array() };
      codeFiles = (await Promise.all(form.getAll('code').map(toUpload))).filter((f): f is UploadedFile => f !== null);
    }
  } catch (err) {
    if (err instanceof SubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'The upload could not be read. Try again.' }, { status: 400 });
  }

  try {
    const record = processSubmission({ ...fields, bundle, codeFiles });
    await saveSubmission(record, bundle, codeFiles);
    // The hour to answer starts now; the questions are written after the response is sent.
    await markQuestionsPending(record.id);
    await markCodeCheckPending(record.id);
    after(() => runQuestionGeneration(record.id));
    // The reviewer model checks whether the code works, at the same time as the questions are written.
    after(() => runCodeCheck(record.id));
    // Only when CODEQUIRY_API_KEY is set: an outside AI-code detector, alongside the recording's own signals.
    after(() => startExternalAiCheck(record.id));
    if (staged.length > 0) after(() => backend().removeFiles(staged).catch(() => undefined));
    return NextResponse.json({ id: record.id }, { status: 201 });
  } catch (err) {
    if (err instanceof SubmissionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('Submission failed:', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Try again.' }, { status: 500 });
  }
}
