'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import type { Student } from '@/lib/course';

interface SubmitPanelProps {
  assignmentId: string;
  students: Student[];
  expectedFiles: string[];
  /** Start with the form open, e.g. from a "submit" link. */
  initiallyOpen?: boolean;
}

/** The submission form: who is submitting, the .codelapse recording and the code. */
export function SubmitPanel({ assignmentId, students, expectedFiles, initiallyOpen = false }: SubmitPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    form.set('assignmentId', assignmentId);

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

  if (!open) {
    return (
      <button type="button" className="button button-primary" onClick={() => setOpen(true)}>
        Submit Assignment
      </button>
    );
  }

  return (
    <section className="submit-panel" aria-labelledby="submit-heading">
      <h2 id="submit-heading">Submit Assignment</h2>
      <form onSubmit={onSubmit} aria-busy={uploading}>
        <fieldset disabled={uploading}>
          <div className="field">
            <label htmlFor="studentId">Who are you?</label>
            <select id="studentId" name="studentId" required defaultValue="">
              <option value="" disabled>
                Choose your name
              </option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
            <p className="hint">This demo has no sign-in: pick your name from the list.</p>
          </div>

          <div className="field">
            <label htmlFor="recording">CodeLapse recording (.codelapse)</label>
            <input id="recording" name="recording" type="file" accept=".codelapse" required />
            <p className="hint">In VS Code, run &ldquo;CodeLapse: Export Assignment Bundle&rdquo; to create it.</p>
          </div>

          <div className="field">
            <label htmlFor="code">Code files</label>
            <input id="code" name="code" type="file" accept=".c,.h" multiple required />
            <p className="hint">Expected: {expectedFiles.join(', ')}. You can select several files.</p>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="button button-primary">
              {uploading ? 'Submitting…' : 'Submit Assignment'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
