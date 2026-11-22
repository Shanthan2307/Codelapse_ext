import type { AuthorshipReport, AuthorshipSignal } from '@codelapse/core';
import type { ExternalAiCheck } from '@/lib/aidetect/types';
import { AutoRefresh } from './AutoRefresh';
import { formatDateTime } from './format';

export const LEVEL_LABELS: Record<AuthorshipReport['level'], string> = {
  low: 'Few signs',
  some: 'Some signs',
  high: 'Strong signs'
};

export const LEVEL_CLASS: Record<AuthorshipReport['level'], string> = {
  low: 'pill pill-ok',
  some: 'pill pill-look',
  high: 'pill pill-alert'
};

const STRENGTH_LABELS: Record<AuthorshipSignal['strength'], string> = {
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong'
};

const ORIGIN_LABELS: Record<string, string> = {
  t: 'Typed',
  p: 'Pasted (one large edit)',
  o: 'Not written while recording',
  '-': ''
};

/**
 * Signs of AI use for the instructor: the recording-based signals, where each
 * line of the final code came from, and the outside detector's score if one is
 * set up. Evidence only; the instructor decides.
 */
export function AuthorshipPanel({
  report,
  code,
  external,
  externalEnabled
}: {
  report: AuthorshipReport | null;
  code: { path: string; text: string | null }[];
  external: ExternalAiCheck | null;
  externalEnabled: boolean;
}) {
  if (!report) {
    return (
      <section className="card" id="ai-use">
        <h2>Signs of AI use</h2>
        <p className="muted">The recording could not be read, so these signals are not available.</p>
      </section>
    );
  }
  const total = report.lines.typed + report.lines.pasted + report.lines.outside;
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '–');

  return (
    <section className="card" id="ai-use">
      <h2>
        Signs of AI use: <span className={LEVEL_CLASS[report.level]}>{LEVEL_LABELS[report.level]}</span>
      </h2>
      <p className="hint">
        Read from how the code was written: what was pasted, what was never written while recording, and whether
        typed code looks copied from another screen. None of these proves AI use, and each has ordinary
        explanations; use them to decide what to ask the student.
      </p>

      <dl className="facts facts-grid">
        <div>
          <dt>Typed</dt>
          <dd>
            {report.lines.typed} lines ({pct(report.lines.typed)})
          </dd>
        </div>
        <div>
          <dt>Pasted</dt>
          <dd>
            {report.lines.pasted} lines ({pct(report.lines.pasted)})
          </dd>
        </div>
        <div>
          <dt>Not written while recording</dt>
          <dd>
            {report.lines.outside} lines ({pct(report.lines.outside)})
          </dd>
        </div>
        <div>
          <dt>Active editing</dt>
          <dd>{report.activeMinutes.toFixed(1)} min</dd>
        </div>
      </dl>

      {report.signals.length === 0 ? (
        <p>No signals: the code was typed in the recording, with the usual going back, corrections and runs.</p>
      ) : (
        <ul className="ai-signals">
          {report.signals.map((signal) => (
            <li key={signal.kind} className={`ai-signal ai-signal-${signal.strength}`}>
              <p className="ai-signal-title">
                <span className={`level ai-strength-${signal.strength}`}>{STRENGTH_LABELS[signal.strength]}</span>{' '}
                <strong>{signal.title}</strong>
              </p>
              <p>{signal.detail}</p>
              <p className="muted">Could also be: {signal.otherExplanations}</p>
            </li>
          ))}
        </ul>
      )}

      <ExternalResult check={external} enabled={externalEnabled} />

      <details className="ai-origins">
        <summary>Where each line came from</summary>
        <p className="hint">
          <span className="origin-key origin-t">Typed</span> <span className="origin-key origin-p">Pasted</span>{' '}
          <span className="origin-key origin-o">Not written while recording</span>. Each line is traced to the first
          moment it appeared in the recording, ignoring spacing.
        </p>
        {report.files.map((file) => {
          const text = code.find((c) => c.path === file.path)?.text;
          if (text == null) return null;
          const lines = text.split(/\r?\n/);
          return (
            <div key={file.path} className="code-block">
              <p className="code-name">
                <code>{file.path}</code>
              </p>
              <pre className="origin-code">
                {lines.map((line, i) => {
                  const origin = file.origins[i] ?? '-';
                  return (
                    <span key={i} className={`origin-line origin-${origin === '-' ? 'none' : origin}`} title={ORIGIN_LABELS[origin]}>
                      {line || ' '}
                      {'\n'}
                    </span>
                  );
                })}
              </pre>
            </div>
          );
        })}
      </details>
    </section>
  );
}

function ExternalResult({ check, enabled }: { check: ExternalAiCheck | null; enabled: boolean }) {
  if (!check) {
    return enabled ? <p className="muted">Outside detector (Codequiry): not run for this submission.</p> : null;
  }
  if (check.status === 'running') {
    return (
      <p className="muted">
        <AutoRefresh everyMs={30_000} />
        Outside detector (Codequiry): checking since {formatDateTime(check.startedAt)}. It usually takes 2 to 10
        minutes; this page checks again every 30 seconds.
      </p>
    );
  }
  if (check.status === 'failed') {
    return <p className="muted">Outside detector (Codequiry) did not give a result: {check.error}</p>;
  }
  return (
    <div className="ai-external">
      <p>
        <strong>Outside detector (Codequiry):</strong>{' '}
        {check.averageAiProbability !== undefined ? `${Math.round(check.averageAiProbability)}% AI probability` : 'no score'}
        {check.riskLevel && ` (${check.riskLevel} risk)`}.
      </p>
      {check.files.length > 0 && (
        <ul>
          {check.files.map((f) => (
            <li key={f.path}>
              <code>{f.path}</code>: {Math.round(f.aiProbability)}%{f.summary ? `: ${f.summary}` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        Detectors that read only the code are often wrong on short, simple programs like course assignments, both
        ways. Weigh this below the recording signals above.
      </p>
    </div>
  );
}
