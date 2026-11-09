'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DragEvent, FormEvent, useEffect, useId, useState } from 'react';
import type { Student } from '@/lib/course';

/** Mirrors the server's limits, so problems show up before the upload starts. */
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const MAX_CODE_FILE_BYTES = 512 * 1024;
const CODE_FILE = /^(?:[\w.-]+\.(?:c|h)|Makefile|makefile)$/;
const NAME_KEY = 'codelapse-student';

export interface PreviousSubmission {
  id: string;
  submittedAt: string;
}

interface SubmitPanelProps {
  assignmentId: string;
  students: Student[];
  expectedFiles: string[];
  /** Each student's latest submission, so a returning tester can find it again. */
  previous?: Record<string, PreviousSubmission>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Problems that stop the upload, worded for the student. */
function blockingProblems(studentId: string, recording: File | null, code: File[]): string[] {
  const problems: string[] = [];
  if (!studentId) problems.push('Choose your name.');
  if (!recording) {
    problems.push('Add your .codelapse recording.');
  } else if (!recording.name.toLowerCase().endsWith('.codelapse')) {
    problems.push(`"${recording.name}" is not a .codelapse file. In VS Code, run "CodeLapse: Export Assignment Bundle".`);
  } else if (recording.size > MAX_RECORDING_BYTES) {
    problems.push('The recording is larger than 25 MB.');
  }
  if (code.length === 0) problems.push('Add your code (.c or .h files).');
  for (const file of code) {
    if (!CODE_FILE.test(file.name)) {
      problems.push(`"${file.name}" is not a C source file. Upload .c and .h files (or a Makefile).`);
    } else if (file.size > MAX_CODE_FILE_BYTES) {
      problems.push(`"${file.name}" is larger than 512 KB.`);
    }
  }
  return problems;
}

/** The submission form: who is submitting, the .codelapse recording and the code. */
export function SubmitPanel({ assignmentId, students, expectedFiles, previous = {} }: SubmitPanelProps) {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [recording, setRecording] = useState<File | null>(null);
  const [code, setCode] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // Remember who this browser belongs to, so testers don't pick their name every time.
  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved && students.some((s) => s.id === saved)) {
      setStudentId(saved);
    }
  }, [students]);

  function chooseStudent(id: string) {
    setStudentId(id);
    if (id) window.localStorage.setItem(NAME_KEY, id);
  }

  function addCode(files: File[]) {
    setCode((current) => {
      const byName = new Map(current.map((f) => [f.name, f]));
      files.forEach((f) => byName.set(f.name, f));
      return [...byName.values()];
    });
  }

  const missingExpected = expectedFiles.filter((name) => !code.some((f) => f.name === name));
  const mine = studentId ? previous[studentId] : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const found = blockingProblems(studentId, recording, code);
    setProblems(found);
    if (found.length > 0 || !recording) {
      return;
    }

    const form = new FormData();
    form.set('studentId', studentId);
    form.set('assignmentId', assignmentId);
    form.set('recording', recording, recording.name);
    code.forEach((file) => form.append('code', file, file.name));

    setUploading(true);
    try {
      const response = await fetch('/api/submissions', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (response.status === 201 && body.id) {
        router.push(`/submissions/${body.id}`);
        return;
      }
      setError(body.error ?? 'The submission did not go through. Try again.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setUploading(false);
  }

  return (
    <section className="submit-panel" aria-labelledby="submit-heading">
      <h2 id="submit-heading">Submit Assignment</h2>
      <form onSubmit={onSubmit} aria-busy={uploading} noValidate>
        <fieldset disabled={uploading}>
          <div className="field">
            <label htmlFor="studentId">Who are you?</label>
            <select id="studentId" name="studentId" value={studentId} onChange={(e) => chooseStudent(e.target.value)}>
              <option value="" disabled>
                Choose your name
              </option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
            <p className="hint">This demo has no sign-in. This browser remembers your choice.</p>
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
            help={`Drop ${expectedFiles.join(', ')} here, or click to choose. You can add several .c and .h files.`}
            accept=".c,.h"
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
