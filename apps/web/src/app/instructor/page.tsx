import Link from 'next/link';
import { CourseShell } from '@/components/CourseShell';
import { formatCount, formatDuration, formatShortDateTime, plural } from '@/components/format';
import { COURSE } from '@/lib/course';
import { latestSubmissions } from '@/lib/store';
import type { SubmissionRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InstructorPage() {
  const assignment = COURSE.assignments[0];
  const byStudent = new Map<string, SubmissionRecord>(
    (await latestSubmissions(assignment.id)).map((s) => [s.studentId, s])
  );

  return (
    <CourseShell active="instructor" crumbs={[{ label: 'Instructor view' }]}>
      <h1>Submissions: {assignment.title}</h1>
      <p className="lead">
        Each student&apos;s latest submission. The recording check compares the end of the recording with the
        submitted code. These numbers describe the recording; you decide what they mean.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Submitted</th>
              <th scope="col">Recorded</th>
              <th scope="col">Typed</th>
              <th scope="col">Bulk inserted</th>
              <th scope="col">Builds</th>
              <th scope="col">Recording check</th>
              <th scope="col">Moments</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
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
                    {student.name}
                  </th>
                  <td className="nowrap">{formatShortDateTime(s.submittedAt)}</td>
                  <td className="nowrap">
                    {formatDuration(s.recording.recordedMs)}
                    <span className="sub">{plural(s.recording.sessionCount, 'session')}</span>
                  </td>
                  <td className="num">{formatCount(s.recording.typedChars)}</td>
                  <td className="num">{formatCount(s.recording.bulkInsertedChars)}</td>
                  <td className="nowrap">
                    {s.recording.runs.passed} passed, {s.recording.runs.failed} failed
                    {s.recording.runs.unknown > 0 && `, ${s.recording.runs.unknown} unknown`}
                  </td>
                  <td>
                    {s.replay.verdict === 'consistent' ? (
                      <span className="pill pill-ok">Consistent</span>
                    ) : (
                      <span className="pill pill-look">
                        Needs a look ({needsLook} {needsLook === 1 ? 'file' : 'files'})
                      </span>
                    )}
                  </td>
                  <td className="num">{s.moments.length}</td>
                  <td>
                    <Link href={`/instructor/submissions/${s.id}`}>Details</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CourseShell>
  );
}
