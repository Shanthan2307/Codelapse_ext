import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { formatClock, formatCount, formatDateTime, formatDuration, plural } from '@/components/format';
import { findAssignment, findStudent } from '@/lib/course';
import { getAnswers, getEvaluation, getQuestionSet, getSubmission, readSubmittedCode } from '@/lib/store';
import type { AnswerSet, GeneratedQuestion, QuestionSet } from '@/lib/questions/types';
import { RetryQuestionsButton } from '@/components/RetryQuestionsButton';
import { RetryButton } from '@/components/RetryButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OpenDetailsOnHash } from '@/components/OpenDetailsOnHash';
import { WatchMomentLink, replayHref } from '@/components/ReplayLink';
import { AnswerEvaluationView, HighlightedAnswer, LevelCounts } from '@/components/AnswerReview';
import { RatingPanel } from '@/components/RatingPanel';
import { getFeedback } from '@/lib/research/feedback';
import type { AnswerEvaluation, EvaluationSet } from '@/lib/evaluation/types';
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
  const questionSet = await getQuestionSet(submission.id);
  const answers = await getAnswers(submission.id);
  const evaluation = answers ? await getEvaluation(submission.id) : null;
  const momentsById = new Map(submission.moments.map((m) => [m.id, m]));
  const closed = Date.now() > submission.questionsCloseAt;
  const feedback = answers && questionSet?.status === 'ready' ? await getFeedback(submission.id) : null;
  const reviewLevels = new Map(
    (evaluation?.status === 'ready' ? evaluation.evaluations : []).map((e) => [e.questionId, e.level])
  );

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
      <p>
        <a className="button button-primary" href={replayHref(submission.id)}>
          Watch replay
        </a>
      </p>

      <OpenDetailsOnHash />
      <SummaryStrip
        verdict={submission.replay.verdict}
        questions={questionSet}
        answers={answers}
        evaluation={evaluation}
        closed={closed}
        closesAt={submission.questionsCloseAt}
      />

      <section className="card" id="recording">
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

      <details className="section" id="code">
        <summary>
          <h2>Submitted code</h2>
          <span className="muted">{plural(code.length, 'file')}</span>
        </summary>
        <div className="section-body">
          {code.map(({ file, text }) => (
            <div key={file.name} className="code-block">
              <p className="code-name">
                <code>{file.name}</code> <span className="muted">{formatCount(file.size)} bytes</span>
              </p>
              <pre>{text ?? 'This file could not be read.'}</pre>
            </div>
          ))}
        </div>
      </details>

      <QuestionsSection
        submissionId={submission.id}
        set={questionSet}
        answers={answers}
        evaluation={evaluation}
        closed={closed}
        closesAt={submission.questionsCloseAt}
        momentsById={momentsById}
      />

      {feedback && questionSet && (
        <RatingPanel
          submissionId={submission.id}
          initial={feedback}
          questions={questionSet.questions.map((q, i) => ({
            id: q.id,
            number: i + 1,
            type: q.type,
            text: q.text,
            reviewLevel: reviewLevels.get(q.id) ?? null
          }))}
        />
      )}

      <details className="section" id="moments">
        <summary>
          <h2>Decision moments ({submission.moments.length})</h2>
        </summary>
        <div className="section-body">
          <p className="hint">
            Points in the recording worth asking about, in time order. The process questions are built from these.
          </p>
          {submission.moments.length === 0 ? (
            <p className="muted">No moments were found in this recording.</p>
          ) : (
            <ol className="moments">
              {submission.moments.map((moment) => (
                <MomentItem key={moment.id} moment={moment} showSession={recording.sessionCount > 1} submissionId={submission.id} />
              ))}
            </ol>
          )}
        </div>
      </details>
    </CourseShell>
  );
}

function MomentItem({ moment, showSession, submissionId }: { moment: Moment; showSession: boolean; submissionId: string }) {
  const failedOutput = typeof moment.evidence.failedOutput === 'string' ? moment.evidence.failedOutput : null;
  return (
    <li className="moment" id={moment.id}>
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
      <p>
        {moment.summary} <WatchMomentLink submissionId={submissionId} moment={moment} />
      </p>
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

const STATUS_TEXT: Record<QuestionSet['status'], string> = {
  pending: 'Preparing',
  ready: 'Ready',
  failed: 'Failed'
};

function QuestionsSection({
  submissionId,
  set,
  answers,
  evaluation,
  closed,
  closesAt,
  momentsById
}: {
  submissionId: string;
  set: QuestionSet | null;
  answers: AnswerSet | null;
  evaluation: EvaluationSet | null;
  closed: boolean;
  closesAt: number;
  momentsById: Map<string, Moment>;
}) {
  const status = set?.status ?? 'pending';
  const answerById = new Map((answers?.answers ?? []).map((a) => [a.questionId, a.text]));
  const notAnswered = closed ? 'Not answered' : 'Not answered yet';
  const reviewById = new Map(
    (evaluation?.status === 'ready' ? evaluation.evaluations : []).map((e) => [e.questionId, e])
  );

  return (
    <section className="card" id="questions">
      <h2>
        Questions and answers <span className={`q-status q-status-${status}`}>{STATUS_TEXT[status]}</span>
      </h2>
      <p className="hint">
        {set?.model ? `Written by ${set.model} (prompt ${set.promptVersion}). ` : ''}
        {answers
          ? `Answers received ${formatDateTime(answers.submittedAt)}.`
          : closed
            ? `Answers closed ${formatDateTime(closesAt)} without a reply.`
            : `Answers close ${formatDateTime(closesAt)}.`}
      </p>

      {status === 'pending' && <p className="muted">The questions are being prepared. Refresh in a minute.</p>}

      {status === 'failed' && (
        <div className="callout callout-error">
          <p>
            <strong>The questions could not be prepared.</strong> {set?.error ?? 'No reason was recorded.'}
          </p>
          <p className="muted">The student sees only that their questions could not be prepared.</p>
          <RetryQuestionsButton submissionId={submissionId} />
        </div>
      )}

      {set && (set.notesForInstructor || set.injectionSignals.length > 0) && (
        <div className="callout">
          {set.injectionSignals.length > 0 && (
            <>
              <p>
                <strong>Text in the submitted files that addresses an AI or grader</strong>
              </p>
              <ul className="signal-list">
                {set.injectionSignals.map((signal) => (
                  <li key={`${signal.file}:${signal.line}`}>
                    <code>
                      {signal.file}:{signal.line}
                    </code>{' '}
                    <span className="signal-text">{signal.text}</span>
                  </li>
                ))}
              </ul>
              <p className="hint">The question writer was told to ignore such text. This is shown for you to judge.</p>
            </>
          )}
          {set.notesForInstructor && (
            <p>
              <strong>Note from the question writer:</strong> {set.notesForInstructor}
            </p>
          )}
        </div>
      )}

      {answers && status === 'ready' && <ReviewSummary submissionId={submissionId} evaluation={evaluation} />}

      {status === 'ready' && set && (
        <ol className="question-list">
          {set.questions.map((q) => (
            <InstructorQuestion
              key={q.id}
              question={q}
              moment={q.momentId ? momentsById.get(q.momentId) : undefined}
              submissionId={submissionId}
              answer={answerById.get(q.id)}
              review={reviewById.get(q.id)}
              notAnswered={notAnswered}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function InstructorQuestion({
  question,
  moment,
  answer,
  review,
  notAnswered,
  submissionId
}: {
  question: GeneratedQuestion;
  moment: Moment | undefined;
  submissionId: string;
  answer: string | undefined;
  review: AnswerEvaluation | undefined;
  notAnswered: string;
}) {
  return (
    <li className="question">
      <div className="question-meta">
        <span className={`badge badge-${question.type}`}>{question.type === 'process' ? 'Process' : 'Code'}</span>
        {question.concept && <span className="muted">{question.concept}</span>}
        {question.type === 'process' && question.momentId && (
          <a href={`#${question.momentId}`} className="question-ref">
            {moment ? `${KIND_LABELS[moment.kind]} at ${formatClock(moment.at)}` : `Moment ${question.momentId}`}
          </a>
        )}
        {question.type === 'process' && moment && <WatchMomentLink submissionId={submissionId} moment={moment} />}
        {question.type === 'code' && question.codeRef && (
          <code className="question-ref">
            {question.codeRef.file}, lines {question.codeRef.startLine}–{question.codeRef.endLine}
          </code>
        )}
      </div>
      <p className="question-text">{question.text}</p>
      {question.excerpts.length > 0 && (
        <div className={question.excerpts.length > 1 ? 'excerpts excerpts-pair' : 'excerpts'}>
          {question.excerpts.map((excerpt) => (
            <div key={excerpt.label}>
              <p className="code-name">{excerpt.label}</p>
              <pre>{excerpt.code || '(empty)'}</pre>
            </div>
          ))}
        </div>
      )}
      <dl className="question-notes">
        <div>
          <dt>Why this was asked</dt>
          <dd>{question.rationale}</dd>
        </div>
        {question.strongAnswerPoints.length > 0 && (
          <div>
            <dt>A strong answer might mention</dt>
            <dd>
              <ul>
                {question.strongAnswerPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <span className="hint">Hints for the reviewer, not an answer key: other correct answers count.</span>
            </dd>
          </div>
        )}
      </dl>
      <p className="answer-label">Student&apos;s answer</p>
      {answer ? (
        <HighlightedAnswer text={answer} quotes={review?.evidenceQuotes ?? []} />
      ) : (
        <p className="muted">{notAnswered}</p>
      )}
      {answer && review && <AnswerEvaluationView evaluation={review} />}
    </li>
  );
}

const REVIEW_STATUS: Record<EvaluationSet['status'], string> = {
  pending: 'Reviewing',
  ready: 'Reviewed',
  failed: 'Failed',
  skipped: 'Not reviewed'
};

/** The answer evaluator's overall review, shown above the questions. Instructors only. */
function ReviewSummary({ submissionId, evaluation }: { submissionId: string; evaluation: EvaluationSet | null }) {
  const status = evaluation?.status ?? 'pending';
  return (
    <div className="review-summary">
      <h3>
        Answer review <span className={`q-status q-status-${status === 'skipped' ? 'pending' : status}`}>{REVIEW_STATUS[status]}</span>
      </h3>
      <p className="hint">
        {evaluation?.model ? `Reviewed by ${evaluation.model} (prompt ${evaluation.promptVersion}). ` : ''}
        This review describes the answers; it is not a grade or a judgement of honesty. You decide.
      </p>

      {status === 'pending' && (
        <>
          <p className="muted">Reviewing answers…</p>
          <AutoRefresh everyMs={5000} />
        </>
      )}

      {status === 'failed' && (
        <div className="callout callout-error">
          <p>
            <strong>The answers could not be reviewed.</strong> {evaluation?.error ?? 'No reason was recorded.'}
          </p>
          <RetryButton url={`/api/submissions/${submissionId}/evaluation`} />
        </div>
      )}

      {status === 'ready' && evaluation && (
        <>
          <p className="review-counts">
            <LevelCounts counts={evaluation.counts} />
          </p>
          {evaluation.summary && <p>{evaluation.summary}</p>}
        </>
      )}

      {evaluation && (evaluation.notesForInstructor || evaluation.injectionSignals.length > 0) && (
        <div className="callout">
          {evaluation.injectionSignals.length > 0 && (
            <>
              <p>
                <strong>Text in the answers that addresses an AI or grader</strong>
              </p>
              <ul className="signal-list">
                {evaluation.injectionSignals.map((signal) => (
                  <li key={`${signal.file}:${signal.line}`}>
                    <code>
                      {signal.file}, line {signal.line}
                    </code>{' '}
                    <span className="signal-text">{signal.text}</span>
                  </li>
                ))}
              </ul>
              <p className="hint">The reviewer was told to ignore such text. This is shown for you to judge.</p>
            </>
          )}
          {evaluation.notesForInstructor && (
            <p>
              <strong>Note from the reviewer:</strong> {evaluation.notesForInstructor}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One line at the top with the state of everything, plus links to the sections. */
function SummaryStrip({
  verdict,
  questions,
  answers,
  evaluation,
  closed,
  closesAt
}: {
  verdict: 'consistent' | 'inconsistent';
  questions: QuestionSet | null;
  answers: AnswerSet | null;
  evaluation: EvaluationSet | null;
  closed: boolean;
  closesAt: number;
}) {
  const qStatus = questions?.status ?? 'pending';
  const review = !answers ? null : evaluation?.status ?? 'pending';
  return (
    <div className="summary-strip">
      <div className="summary-item">
        <span className="summary-label">Recording check</span>
        {verdict === 'consistent' ? (
          <span className="pill pill-ok">Consistent</span>
        ) : (
          <span className="pill pill-look">Needs a look</span>
        )}
      </div>
      <div className="summary-item">
        <span className="summary-label">Questions</span>
        <span className={`q-status q-status-${qStatus}`}>{STATUS_TEXT[qStatus]}</span>
      </div>
      <div className="summary-item">
        <span className="summary-label">Answers</span>
        <span>
          {answers
            ? `Received ${formatDateTime(answers.submittedAt)}`
            : closed
              ? 'Closed without a reply'
              : `Open until ${formatDateTime(closesAt)}`}
        </span>
      </div>
      <div className="summary-item">
        <span className="summary-label">Review</span>
        {review === null ? (
          <span className="muted">—</span>
        ) : review === 'ready' && evaluation ? (
          <LevelCounts counts={evaluation.counts} />
        ) : (
          <span className={`q-status q-status-${review === 'failed' ? 'failed' : 'pending'}`}>
            {REVIEW_STATUS[review]}
          </span>
        )}
      </div>
      <nav className="jump-links" aria-label="Sections">
        <a href="#recording">Recording</a>
        <a href="#questions">Questions</a>
        <a href="#code">Code</a>
        <a href="#moments">Moments</a>
      </nav>
    </div>
  );
}
