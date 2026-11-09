import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { MarkPhrases, NumberedCode, SignalChips, agreementText, pct } from '@/components/CompareParts';
import { formatClock, formatCount, formatDuration } from '@/components/format';
import { COURSE } from '@/lib/course';
import { findPair } from '@/lib/cohort';
import { getSubmission, readAllSubmittedCode } from '@/lib/store';
import type { SubmissionRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ a: string; b: string }> };

export default async function PairPage({ params }: Params) {
  const { a, b } = await params;
  const assignment = COURSE.assignments[0];
  const found = await findPair(assignment.id, a, b);
  const [recordA, recordB] = await Promise.all([getSubmission(a), getSubmission(b)]);
  if (!found || !recordA || !recordB) {
    notFound();
  }
  const { pair } = found;
  const [codeA, codeB] = await Promise.all([readAllSubmittedCode(recordA), readAllSubmittedCode(recordB)]);

  return (
    <CourseShell
      active="instructor"
      crumbs={[
        { label: 'Instructor view', href: '/instructor' },
        { label: 'Compare students', href: '/instructor/compare' },
        { label: `${pair.a.name} and ${pair.b.name}` }
      ]}
    >
      <h1>
        {pair.a.name} and {pair.b.name}
      </h1>
      <p className="lead">
        Where these two submissions resemble each other. Similar work can have innocent causes; this page shows the
        evidence side by side so you can judge it.
      </p>

      <section className="card">
        <h2>Signals</h2>
        <p className="compare-agreement">{agreementText(pair)}</p>
        <SignalChips pair={pair} />
        <ul className="pair-reasons">
          {pair.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Recordings</h2>
        <div className="compare-columns">
          <RecordingSummary name={pair.a.name} record={recordA} />
          <RecordingSummary name={pair.b.name} record={recordB} />
        </div>
      </section>

      <section className="card">
        <h2>Code</h2>
        {pair.code.files.length === 0 ? (
          <p className="muted">The two submissions have no code file with the same name.</p>
        ) : (
          pair.code.files.map((file) => (
            <div key={file.name} className="compare-file">
              <h3>
                <code>{file.name}</code>{' '}
                <span className="muted compare-file-meta">
                  structure {pct(file.structural)} similar · exact {pct(file.exact)}
                </span>
              </h3>
              <p className="muted compare-note">Highlighted lines match between the two files when names are ignored.</p>
              <div className="compare-columns">
                <div>
                  <div className="compare-col-title">{pair.a.name}</div>
                  <NumberedCode code={codeA.find((f) => f.name === file.name)?.content ?? ''} highlight={file.matchedLinesA} />
                </div>
                <div>
                  <div className="compare-col-title">{pair.b.name}</div>
                  <NumberedCode code={codeB.find((f) => f.name === file.name)?.content ?? ''} highlight={file.matchedLinesB} />
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>Blocks inserted in one edit</h2>
        {pair.pasted.score === null ? (
          <p className="muted">At least one of the recordings has no large block inserted in one edit.</p>
        ) : pair.pasted.matches.length === 0 ? (
          <p className="muted">Both recordings have blocks inserted in one edit, but none of them match.</p>
        ) : (
          <>
            <p className="muted compare-note">
              A block inserted in one edit can be a paste, an autocomplete or a formatter. The same block in two
              recordings is worth a look, not proof of anything.
            </p>
            {pair.pasted.matches.map((m, i) => (
              <div key={i} className="compare-block">
                <div className="compare-block-score">{pct(m.score)} alike</div>
                <div className="compare-columns">
                  <div>
                    <div className="compare-col-title">
                      {pair.a.name} · {m.a.filePath} at {formatClock(m.a.at)} · {formatCount(m.a.chars)} characters
                    </div>
                    <pre className="compare-code">{m.a.text}</pre>
                  </div>
                  <div>
                    <div className="compare-col-title">
                      {pair.b.name} · {m.b.filePath} at {formatClock(m.b.at)} · {formatCount(m.b.chars)} characters
                    </div>
                    <pre className="compare-code">{m.b.text}</pre>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="card">
        <h2>Answers</h2>
        {!pair.answers.available ? (
          <p className="muted">Both students need to have answered their questions to compare answers.</p>
        ) : pair.answers.matches.length === 0 ? (
          <p className="muted">
            No pair of answers is notably alike (closest {pct(pair.answers.score)}). Each student got different
            questions, so answers usually differ.
          </p>
        ) : (
          <>
            <p className="muted compare-note">
              Each student got different questions, so closely matching wording across them stands out. Shared phrases
              are marked.
            </p>
            {pair.answers.matches.map((m, i) => (
              <div key={i} className="compare-block">
                <div className="compare-block-score">{pct(m.score)} alike</div>
                <div className="compare-columns">
                  <AnswerColumn name={pair.a.name} question={m.a.question} answer={m.a.answer} phrases={m.sharedPhrases} />
                  <AnswerColumn name={pair.b.name} question={m.b.question} answer={m.b.answer} phrases={m.sharedPhrasesB} />
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </CourseShell>
  );
}

function RecordingSummary({ name, record }: { name: string; record: SubmissionRecord }) {
  const r = record.recording;
  return (
    <div className="compare-summary">
      <div className="compare-col-title">
        <Link href={`/instructor/submissions/${record.id}`}>{name}</Link>
      </div>
      <dl>
        <dt>Recorded</dt>
        <dd>
          {formatDuration(r.recordedMs)} in {r.sessionCount} {r.sessionCount === 1 ? 'session' : 'sessions'}
        </dd>
        <dt>Typed</dt>
        <dd>{formatCount(r.typedChars)} characters</dd>
        <dt>Bulk inserted</dt>
        <dd>{formatCount(r.bulkInsertedChars)} characters</dd>
        <dt>Builds</dt>
        <dd>
          {r.runs.passed} passed, {r.runs.failed} failed
        </dd>
        <dt>Recording check</dt>
        <dd>{record.replay.verdict === 'consistent' ? 'Consistent' : 'Needs a look'}</dd>
      </dl>
    </div>
  );
}

function AnswerColumn({ name, question, answer, phrases }: { name: string; question: string; answer: string; phrases: string[] }) {
  return (
    <div>
      <div className="compare-col-title">{name}</div>
      {question && <p className="compare-question">{question}</p>}
      <p className="compare-answer">
        <MarkPhrases text={answer} phrases={phrases} />
      </p>
    </div>
  );
}
