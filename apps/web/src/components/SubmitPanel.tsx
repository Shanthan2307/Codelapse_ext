'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DragEvent, FormEvent, useEffect, useId, useState } from 'react';
import {
  CODE_FILE_ACCEPT,
  CODE_FILE_HELP,
  LANGUAGE_LABELS,
  MAX_NAME_LENGTH,
  cleanName,
  isAllowedCodeFile,
  testerId,
  type Language
} from '@/lib/course';

/** Mirrors the server's limits, so problems show up before the upload starts. */
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const MAX_CODE_FILE_BYTES = 512 * 1024;
const NAME_KEY = 'codelapse-tester-name';

export interface PreviousSubmission {
  id: string;
  submittedAt: string;
}

export interface ProgramChoice {
  id: string;
  title: string;
  /** Decides which code files are accepted. */
  language: Language;
  expectedFiles: string[];
}

interface SubmitPanelProps {
  /** The program this page is for; preselected on the form. */
  assignmentId: string;
  /** Every program the tester may say they completed. */
  assignments: ProgramChoice[];
  /** Latest submission per program and student, so a returning tester can find it again. */
  previous?: Record<string, Record<string, PreviousSubmission>>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Signed = { url: string; headers: Record<string, string> };
type UploadPlan =
  | { mode: 'form' }
  | { mode: 'direct'; uploadId: string; recording: Signed; code: (Signed & { name: string })[] };

/** A failure worded for the student. */
class UploadProblem extends Error {}

async function jsonOrEmpty(response: Response): Promise<{ id?: string; error?: string } & Partial<UploadPlan>> {
  return (await response.json().catch(() => ({}))) as { id?: string; error?: string } & Partial<UploadPlan>;
}

/**
 * Sends the submission and returns its id. On the hosted site the files go
 * straight to storage first (a hosted request is limited to about 4.5 MB);
 * locally they are posted to the site as a form.
 */
async function upload(name: string, assignmentId: string, recording: File, code: File[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: name,
        assignmentId,
        recording: { name: recording.name, size: recording.size },
        code: code.map((f) => ({ name: f.name, size: f.size }))
      })
    });
  } catch {
    throw new UploadProblem('Could not reach the server. Check your connection and try again.');
  }
  const plan = await jsonOrEmpty(response);
  if (!response.ok) throw new UploadProblem(plan.error ?? 'The submission did not go through. Try again.');

  let submit: RequestInit;
  if (plan.mode === 'direct' && plan.uploadId && plan.recording && plan.code) {
    const put = async (target: Signed, file: File) => {
      const sent = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file }).catch(() => null);
      if (!sent?.ok) throw new UploadProblem(`"${file.name}" could not be uploaded. Check your connection and try again.`);
    };
    await put(plan.recording, recording);
    await Promise.all(plan.code.map((target) => put(target, code.find((f) => f.name === target.name)!)));
    submit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: plan.uploadId, studentName: name, assignmentId, code: plan.code.map((c) => c.name) })
    };
  } else {
    const form = new FormData();
    form.set('studentName', name);
    form.set('assignmentId', assignmentId);
    form.set('recording', recording, recording.name);
    code.forEach((file) => form.append('code', file, file.name));
    submit = { method: 'POST', body: form };
  }

  try {
    response = await fetch('/api/submissions', submit);
  } catch {
    throw new UploadProblem('Could not reach the server. Check your connection and try again.');
  }
  const body = await jsonOrEmpty(response);
  if (response.status === 201 && body.id) return body.id;
  throw new UploadProblem(body.error ?? 'The submission did not go through. Try again.');
}

/** Problems that stop the upload, worded for the student. */
function blockingProblems(name: string, recording: File | null, code: File[], language: Language): string[] {
  const help = CODE_FILE_HELP[language];
  const problems: string[] = [];
  if (!testerId(name)) problems.push('Enter your name.');
  if (!recording) {
    problems.push('Add your .codelapse recording.');
  } else if (!recording.name.toLowerCase().endsWith('.codelapse')) {
    problems.push(`"${recording.name}" is not a .codelapse file. In VS Code, run "CodeLapse: Export Assignment Bundle".`);
  } else if (recording.size > MAX_RECORDING_BYTES) {
    problems.push('The recording is larger than 25 MB.');
  }
  if (code.length === 0) problems.push(language === 'c' ? 'Add your code (.c or .h files).' : 'Add your code (.py files).');
  for (const file of code) {
    if (!isAllowedCodeFile(language, file.name)) {
      problems.push(`"${file.name}" is not ${help.kind}. ${help.upload}`);
    } else if (file.size > MAX_CODE_FILE_BYTES) {
      problems.push(`"${file.name}" is larger than 512 KB.`);
    }
  }
  return problems;
}

/** The submission form: who is submitting, the .codelapse recording and the code. */
export function SubmitPanel({ assignmentId: initialAssignment, assignments, previous = {} }: SubmitPanelProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [assignmentId, setAssignmentId] = useState(initialAssignment);
  const program = assignments.find((a) => a.id === assignmentId) ?? assignments[0];
  const { language, expectedFiles } = program;
  const [recording, setRecording] = useState<File | null>(null);
  const [code, setCode] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // Remember who this browser belongs to, so testers don't type their name every time.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
    } catch {
      // Storage can be blocked; the tester just types their name.
    }
  }, []);

  function changeName(value: string) {
    setName(value);
    try {
      window.localStorage.setItem(NAME_KEY, cleanName(value));
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }

  function chooseProgram(id: string) {
    setAssignmentId(id);
    // Code files for the other language would be rejected, so start that list over.
    const next = assignments.find((a) => a.id === id);
    if (next && next.language !== language) setCode([]);
    setProblems([]);
  }

  function addCode(files: File[]) {
    setCode((current) => {
      const byName = new Map(current.map((f) => [f.name, f]));
      files.forEach((f) => byName.set(f.name, f));
      return [...byName.values()];
    });
  }

  const missingExpected = expectedFiles.filter((name) => !code.some((f) => f.name === name));
  const id = testerId(name);
  const mine = id ? previous[assignmentId]?.[id] : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const found = blockingProblems(name, recording, code, language);
    setProblems(found);
    if (found.length > 0 || !recording) {
      return;
    }

    setUploading(true);
    try {
      const id = await upload(cleanName(name), assignmentId, recording, code);
      if (id) {
        router.push(`/submissions/${id}`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The submission did not go through. Try again.');
    }
    setUploading(false);
  }

  return (
    <section className="submit-panel" aria-labelledby="submit-heading">
      <h2 id="submit-heading">Submit Assignment</h2>
      <form onSubmit={onSubmit} aria-busy={uploading} noValidate>
        <fieldset disabled={uploading}>
          <div className="field">
            <label htmlFor="studentName">Your name</label>
            <input
              id="studentName"
              name="studentName"
              type="text"
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              placeholder="First and last name"
              value={name}
              onChange={(e) => changeName(e.target.value)}
            />
            <p className="hint">This demo has no sign-in. Use the same name each time; this browser remembers it.</p>
          </div>

          <div className="field">
            <label htmlFor="program">Which program did you complete?</label>
            <select id="program" name="program" value={assignmentId} onChange={(e) => chooseProgram(e.target.value)}>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {LANGUAGE_LABELS[a.language]}: {a.expectedFiles.join(', ')} ({a.title})
                </option>
              ))}
            </select>
          </div>

          {mine && (
            <p className="returning">
              You already submitted on {mine.submittedAt}.{' '}
              <Link href={`/submissions/${mine.id}`}>Open your latest submission</Link>, or submit again below.
            </p>
          )}

          <DropZone
            label="CodeLapse recording"
            help='Drop your .codelapse file here, or click to choose it. Create it in VS Code with "CodeLapse: Export Assignment Bundle".'
            accept=".codelapse"
            files={recording ? [recording] : []}
            onFiles={(files) => setRecording(files[0] ?? null)}
            onRemove={() => setRecording(null)}
          />

          <DropZone
            label="Code files"
            help={`Drop ${expectedFiles.join(', ')} here, or click to choose. You can add several ${language === 'c' ? '.c and .h' : '.py'} files.`}
            accept={CODE_FILE_ACCEPT[language]}
            multiple
            files={code}
            onFiles={addCode}
            onRemove={(name) => setCode((current) => current.filter((f) => f.name !== name))}
          />
          {code.length > 0 && missingExpected.length > 0 && (
            <p className="form-warning">
              The assignment asks for {missingExpected.join(', ')}. You can still submit, but check you added the right
              file.
            </p>
          )}

          {problems.length > 0 && (
            <div className="form-error" role="alert">
              {problems.length === 1 ? (
                problems[0]
              ) : (
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {uploading && (
            <p className="uploading" role="status">
              <span className="spinner" aria-hidden="true" /> Uploading and checking your recording…
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              {uploading ? 'Submitting…' : 'Submit Assignment'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function DropZone({
  label,
  help,
  accept,
  multiple = false,
  files,
  onFiles,
  onRemove
}: {
  label: string;
  help: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  onRemove: (name: string) => void;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = [...event.dataTransfer.files];
    if (dropped.length > 0) {
      onFiles(multiple ? dropped : dropped.slice(0, 1));
    }
  }

  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <div
        className={dragging ? 'dropzone dropzone-active' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone-title">{files.length > 0 && !multiple ? 'Replace file' : 'Choose or drop files'}</p>
        <p className="dropzone-help">{help}</p>
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          aria-labelledby={`${id}-label`}
          onChange={(e) => {
            const chosen = [...(e.target.files ?? [])];
            if (chosen.length > 0) onFiles(chosen);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="file-chips">
          {files.map((file) => (
            <li key={file.name} className="file-chip">
              <code>{file.name}</code>
              <span className="file-size">{formatSize(file.size)}</span>
              <button
                type="button"
                className="chip-remove"
                onClick={() => onRemove(file.name)}
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
