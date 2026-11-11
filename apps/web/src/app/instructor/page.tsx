import Link from 'next/link';
import { CourseShell } from '@/components/CourseShell';
import { formatCount, formatDuration, formatShortDateTime, plural } from '@/components/format';
import { COURSE, selectedAssignment } from '@/lib/course';
import { getAnswers, getEvaluation, getQuestionSet, latestSubmissions } from '@/lib/store';
import { agreeingSignalNames, buildCohort } from '@/lib/cohort';
import { AssignmentTabs, withAssignment } from '@/components/AssignmentTabs';
import { LevelCounts } from '@/components/AnswerReview';
import type { EvaluationSet } from '@/lib/evaluation/types';
import type { AnswerSet, QuestionSet } from '@/lib/questions/types';
import type { SubmissionRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InstructorPage({ searchParams }: { searchParams: Promise<{ assignment?: string | string[] }> }) {
  const assignment = selectedAssignment((await searchParams).assignment);
  const latest = await latestSubmissions(assignment.id);
  const byStudent = new Map<string, SubmissionRecord>(latest.map((s) => [s.studentId, s]));
  const questionState = new Map<
    string,
    { set: QuestionSet | null; answers: AnswerSet | null; evaluation: EvaluationSet | null }
  >(
    await Promise.all(
      latest.map(
        async (s) =>
          [
            s.id,
            { set: await getQuestionSet(s.id), answers: await getAnswers(s.id), evaluation: await getEvaluation(s.id) }
          ] as const
      )
    )
  );
  // Each student's closest match among the others, for a quick pointer to the comparison.
  const cohort = latest.length >= 2 ? await buildCohort(assignment.id) : null;
  const closest = new Map<string, { name: string; count: number; evidence: string; href: string }>();
  for (const pair of cohort?.pairs ?? []) {
    for (const [self, other] of [
      [pair.a, pair.b],
      [pair.b, pair.a]
    ] as const) {
      if (!closest.has(self.submissionId)) {
        const names = agreeingSignalNames(pair);
        closest.set(self.submissionId, {
          name: other.name,
          count: names.length,
          evidence: names.length === 0 ? 'no strong signal' : names.join(', '),
          href: withAssignment(`/instructor/compare/${self.submissionId}/${other.submissionId}`, assignment.id)
        });
      }
    }
  }
  const now = Date.now();
  const states = [...questionState.values()];
  const overview = [
    { value: `${latest.length} of ${COURSE.students.length}`, label: 'students submitted' },
    { value: latest.filter((s) => s.replay.verdict !== 'consistent').length, label: 'recording checks need a look' },
    { value: states.filter((q) => q.answers).length, label: 'answered their questions' },
    { value: states.filter((q) => q.evaluation?.status === 'ready').length, label: 'answer sets reviewed' }
  ];

  return (
    <CourseShell active="instructor" crumbs={[{ label: 'Instructor view' }]}>
      <h1>Submissions: {assignment.title}</h1>
      <AssignmentTabs basePath="/instructor" current={assignment} />
      <p className="lead">
        Each student&apos;s latest submission. The recording check compares the end of the recording with the
        submitted code. These numbers describe the recording; you decide what they mean. Select a name for details.
      </p>

      {latest.length >= 2 && (
        <div className="compare-link-row">
          <Link href={withAssignment('/instructor/compare', assignment.id)} className="button button-primary">
            Compare students
          </Link>
          <span className="muted">See which submissions resemble each other more than usual.</span>
        </div>
      )}

      <div className="overview">
        {overview.map((item) => (
          <div key={item.label} className="overview-item">
            <span className="overview-value">{item.value}</span>
            <span className="overview-label">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Submitted</th>
              <th scope="col">Recorded</th>
              <th scope="col">Typed</th>
              <th scope="col">{assignment.language === 'c' ? 'Builds' : 'Runs'}</th>
              <th scope="col">Recording</th>
              <th scope="col">Moments</th>
              <th scope="col">Questions</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            {COURSE.students.map((student) => {
              const s = byStudent.get(student.id);
              if (!s) {
                return (
                  <tr key={student.id} className="row-empty">
                    <th scope="row" className="nowrap">
                      {student.name}
                    </th>
                    <td colSpan={8} className="muted">
                      Not submitted
                    </td>
                  </tr>
                );
              }
              const needsLook = s.replay.files.filter(
                (f) => f.status === 'differs' || f.status === 'not-recorded'
              ).length;
              return (
                <tr key={student.id}>
                  <th scope="row" className="nowrap">
                    <Link href={`/instructor/submissions/${s.id}`}>{student.name}</Link>
                    {closest.get(s.id) && (
                      <Link
                        href={closest.get(s.id)!.href}
                        className="most-similar"
                        title={`Most similar: ${closest.get(s.id)!.name}. High signals: ${closest.get(s.id)!.evidence}.`}
                      >
                        Closest: {closest.get(s.id)!.name} · {closest.get(s.id)!.count} of 3
                      </Link>
                    )}
                  </th>
                  <td className="nowrap">{formatShortDateTime(s.submittedAt)}</td>
                  <td className="nowrap">
                    {formatDuration(s.recording.recordedMs)}
                    <span className="sub">{plural(s.recording.sessionCount, 'session')}</span>
                  </td>
                  <td className="num nowrap">
                    {formatCount(s.recording.typedChars)}
                    <span className="sub">{formatCount(s.recording.bulkInsertedChars)} bulk inserted</span>
                  </td>
                  <td className="nowrap">
                    {s.recording.runs.passed} passed
                    <span className="sub">
                      {s.recording.runs.failed} failed
                      {s.recording.runs.unknown > 0 && `, ${s.recording.runs.unknown} unknown`}
                    </span>
                  </td>
                  <td>
                    {s.replay.verdict === 'consistent' ? (
                      <span className="pill pill-ok">Consistent</span>
                    ) : (
                      <>
                        <span className="pill pill-look">Needs a look</span>
                        <span className="sub">
                          {needsLook} {needsLook === 1 ? 'file' : 'files'}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="num">{s.moments.length}</td>
                  <td className="q-cell">
                    <QuestionCell
                      state={questionState.get(s.id) ?? { set: null, answers: null }}
                      closed={now > s.questionsCloseAt}
                    />
                  </td>
                  <td className="q-cell">
                    <ReviewCell
                      answered={Boolean(questionState.get(s.id)?.answers)}
                      evaluation={questionState.get(s.id)?.evaluation ?? null}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {latest.length > 0 && (
        <section className="card export-card">
          <h2>Research export</h2>
          <p className="hint">
            Spreadsheet-ready data for the pilot. Names are replaced with participant codes, and answer text is left
            out unless you ask for it. See docs/RESEARCH_PILOT.md for what each column means.
          </p>
          <div className="export-links">
            <a className="button" href={`/api/research/export?assignment=${assignment.id}&format=csv&table=answers`}>
              Answers (CSV)
            </a>
            <a className="button" href={`/api/research/export?assignment=${assignment.id}&format=csv&table=submissions`}>
              Submissions (CSV)
            </a>
            <a className="button" href={`/api/research/export?assignment=${assignment.id}&format=json`}>
              Everything (JSON)
            </a>
          </div>
        </section>
      )}
    </CourseShell>
  );
}

function QuestionCell({
  state,
  closed
}: {
  state: { set: QuestionSet | null; answers: AnswerSet | null };
  closed: boolean;
}) {
  const status = state.set?.status ?? 'pending';
  const label = status === 'ready' ? 'Ready' : status === 'failed' ? 'Failed' : 'Preparing';
  const answer = state.answers ? 'Answered' : closed ? 'Closed unanswered' : 'Not answered';
  return (
    <>
      <span className={`q-status q-status-${status}`}>{label}</span>
      {status === 'ready' && <span className="sub">{answer}</span>}
    </>
  );
}

function ReviewCell({ answered, evaluation }: { answered: boolean; evaluation: EvaluationSet | null }) {
  if (!answered) {
    return <span className="muted">—</span>;
  }
  if (!evaluation || evaluation.status === 'pending') {
    return <span className="q-status q-status-pending">Reviewing…</span>;
  }
  if (evaluation.status === 'failed') {
    return <span className="q-status q-status-failed">Review failed</span>;
  }
  if (evaluation.status === 'skipped') {
    return <span className="muted">—</span>;
  }
  return <LevelCounts counts={evaluation.counts} stacked />;
}
