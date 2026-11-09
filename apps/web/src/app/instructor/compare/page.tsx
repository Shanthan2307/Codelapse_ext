import Link from 'next/link';
import { CourseShell } from '@/components/CourseShell';
import { CompareMatrix, SIGNAL_HELP, SIGNAL_LABELS, SignalChips, agreementText, pairHref, pct } from '@/components/CompareParts';
import { COURSE } from '@/lib/course';
import { SIGNALS, buildCohort } from '@/lib/cohort';

export const dynamic = 'force-dynamic';

export default async function ComparePage() {
  const assignment = COURSE.assignments[0];
  const cohort = await buildCohort(assignment.id);

  return (
    <CourseShell
      active="instructor"
      crumbs={[{ label: 'Instructor view', href: '/instructor' }, { label: 'Compare students' }]}
    >
      <h1>Compare students: {assignment.title}</h1>
      <p className="lead">
        These signals show where two submissions resemble each other more than usual. Similar work can have innocent
        causes: shared starter code, the assignment&apos;s wording, lecture examples, or working together where
        allowed. You decide.
      </p>

      {cohort.students.length < 2 ? (
        <section className="card">
          <p className="muted">At least two students need to submit before submissions can be compared.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>All pairs</h2>
            <p className="muted compare-note">
              Each dot is one kind of evidence that is high for that pair: similar code, the same block inserted in one
              edit, and similar answer wording. Everyone solved the same assignment, so similar code alone is common;
              pairs where several kinds agree stand out. Select a cell to compare the two side by side.
            </p>
            <CompareMatrix cohort={cohort} />
            <div className="compare-baseline">
              {cohort.stats.hasBaseline ? (
                <>
                  <span className="compare-baseline-title">Typical for this class (median of {cohort.stats.pairCount} pairs):</span>
                  {SIGNALS.map((s) => (
                    <span key={s} title={SIGNAL_HELP[s]}>
                      {SIGNAL_LABELS[s]} {pct(cohort.stats.median[s])}
                    </span>
                  ))}
                </>
              ) : (
                <span>
                  With only {cohort.stats.pairCount} {cohort.stats.pairCount === 1 ? 'pair' : 'pairs'}, there is not
                  enough to say what is typical for this class, so no signal is marked as above typical.
                </span>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Pairs, most similar first</h2>
            <p className="muted compare-note">
              Pairs where several kinds of evidence agree (code, the same inserted block, answer wording) come first.
            </p>
            <ol className="pair-list">
              {cohort.pairs.map((pair) => (
                <li key={`${pair.a.submissionId}-${pair.b.submissionId}`} className="pair-item">
                  <div className="pair-head">
                    <Link href={pairHref(pair)} className="pair-names">
                      {pair.a.name} and {pair.b.name}
                    </Link>
                    <span className="pair-strongest">{agreementText(pair)}</span>
                  </div>
                  <SignalChips pair={pair} />
                  <ul className="pair-reasons">
                    {pair.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </CourseShell>
  );
}
