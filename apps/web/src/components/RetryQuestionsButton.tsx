'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Instructor action: write the questions again after generation failed. */
export function RetryQuestionsButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/questions`, { method: 'POST' });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? 'Could not start again.');
      }
      router.refresh();
    } catch {
      setError('Could not reach the site.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="retry">
      <button type="button" className="button" onClick={retry} disabled={busy}>
        {busy ? 'Starting…' : 'Try again'}
      </button>
      {error && <span className="form-error-inline">{error}</span>}
    </div>
  );
}
