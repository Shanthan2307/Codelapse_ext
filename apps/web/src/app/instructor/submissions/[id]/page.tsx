import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { formatClock, formatCount, formatDateTime, formatDuration, plural } from '@/components/format';
import { findAssignment, findStudent } from '@/lib/course';
import { getSubmission, readSubmittedCode } from '@/lib/store';
import type { FileCheck, Moment } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<FileCheck['status'], string> = {
  match: 'Matches',
  'whitespace-only': 'Matches (whitespace differs)',
  differs: 'Differs',
  'not-recorded': 'Not in the recording',
  'not-submitted': 'Recorded, not submitted'
};

const KIND_LABELS: Record<Moment['kind'], string> = {
  'fix-after-failed-run': 'Fix after a failed build',
  'repeated-failures': 'Repeated failed builds',
  'bulk-insert': 'Bulk insert',
  rewrite: 'Rewrite',
  'abandoned-approach': 'Removed code',
  'function-written': 'Function written'
};

export default async function InstructorSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await getSubmission(id);
  if (!submission) {
    notFound();
  }
  const student = findStudent(submission.studentId);
  const assignment = findAssignment(submission.assignmentId);
  const code = await Promise.all(
    submission.files.map(async (file) => ({ file, text: await readSubmittedCode(submission.id, file.name) }))
  );
  const { recording } = submission;

  return (
    <CourseShell
      active="instructor"
      crumbs={[{ label: 'Instructor view', href: '/instructor' }, { label: student?.name ?? 'Submission' }]}
    >
      <h1>
        {student?.name ?? submission.studentId}: {assignment?.title ?? submission.assignmentId}
      </h1>
      <p className="lead">
        Submitted {formatDateTime(submission.submittedAt)}. Everything below describes what the recording shows. It
        is not a judgement: you decide what it means.
      </p>

      <section className="card">
        <h2>Recording</h2>
        <dl className="facts facts-grid">
          <div>
            <dt>Sessions</dt>
            <dd>{recording.sessionCount}</dd>
          </div>
          <div>
            <dt>Recorded time</dt>
            <dd>{formatDuration(recording.recordedMs)}</dd>
          </div>
          <div>
            <dt>Typed</dt>
            <dd>{formatCount(recording.typedChars)} characters</dd>
          </div>
          <div>
            <dt>Bulk inserted</dt>
            <dd>{formatCount(recording.bulkInsertedChars)} characters</dd>
          </div>
          <div>
            <dt>Already in files</dt>
            <dd>{formatCount(recording.preExistingChars)} characters</dd>
          </div>
          <div>
            <dt>Builds</dt>
            <dd>
              {recording.runs.passed} passed, {recording.runs.failed} failed
              {recording.runs.unknown > 0 && `, ${recording.runs.unknown} unknown`}
            </dd>
          </div>
        </dl>
        <p className="hint">
          Bulk inserted means one edit added many characters at once: a paste, autocomplete or formatting. Folder
          &ldquo;{recording.folderName}&rdquo;, exported {formatDateTime(recording.bundleCreatedAt)} with CodeLapse{' '}
          {recording.extensionVersion}.
        </p>
      </section>

      <section className="card">
        <h2>
          Recording check:{' '}
          {submission.replay.verdict === 'consistent' ? (
            <span className="pill pill-ok">Consistent</span>
          ) : (
            <span className="pill pill-look">Needs a look</span>
          )}
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Result</th>
                <th scope="col">Typed</th>
                <th scope="col">Bulk inserted</th>
                <th scope="col">Already there</th>
              </tr>
            </thead>
            <tbody>
              {submission.replay.files.map((file) => (
                <tr key={file.path}>
                  <th scope="row">
                    <code>{file.path}</code>
                  </th>
                  <td>
                    <span className={`status status-${file.status}`}>{STATUS_LABELS[file.status]}</span>
                    <span className="reason">{file.reason}</span>
                  </td>
                  <td className="num">{file.authorship ? formatCount(file.authorship.typedChars) : '–'}</td>
                  <td className="num">{file.authorship ? formatCount(file.authorship.bulkInsertedChars) : '–'}</td>
                  <td className="num">{file.authorship ? formatCount(file.authorship.preExistingChars) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Submitted code</h2>
        {code.map(({ file, text }) => (
          <div key={file.name} className="code-block">
            <p className="code-name">
              <code>{file.name}</code> <span className="muted">{formatCount(file.size)} bytes</span>
            </p>
            <pre>{text ?? 'This file could not be read.'}</pre>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Moments ({submission.moments.length})</h2>
        <p className="hint">
          Points in the recording worth asking about, in time order. The feedback questions will be built from these.
        </p>
        {submission.moments.length === 0 ? (
          <p className="muted">No moments were found in this recording.</p>
        ) : (
          <ol className="moments">
            {submission.moments.map((moment) => (
              <MomentItem key={moment.id} moment={moment} showSession={recording.sessionCount > 1} />
            ))}
          </ol>
        )}
      </section>
    </CourseShell>
  );
}

function MomentItem({ moment, showSession }: { moment: Moment; showSession: boolean }) {
  const failedOutput = typeof moment.evidence.failedOutput === 'string' ? moment.evidence.failedOutput : null;
  return (
    <li className="moment">
      <div className="moment-head">
        <span className={`kind kind-${moment.kind}`}>{KIND_LABELS[moment.kind]}</span>
        <span className="moment-time">
          {showSession && `Session ${moment.sessionIndex + 1} · `}
          {formatClock(moment.at)}
        </span>
        {moment.filePath && (
          <code className="moment-where">
            {moment.filePath}
            {moment.functionName && ` · ${moment.functionName}()`}
          </code>
        )}
      </div>
      <p>{moment.summary}</p>
      {failedOutput && (
        <details>
          <summary>Build output</summary>
          <pre>{failedOutput}</pre>
        </details>
      )}
      {(moment.before || moment.after) && (
        <div className="before-after">
          {moment.before !== undefined && (
            <div>
              <p className="code-name">Before</p>
              <pre>{moment.before || '(empty)'}</pre>
            </div>
          )}
          {moment.after !== undefined && (
            <div>
              <p className="code-name">After</p>
              <pre>{moment.after || '(empty)'}</pre>
            </div>
          )}
        </div>
      )}
      <p className="moment-id muted">
        {typeof moment.evidence.linesChanged === 'number' && `${plural(moment.evidence.linesChanged, 'line')} changed · `}
        id {moment.id}
      </p>
    </li>
  );
}
