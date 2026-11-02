import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { formatCount, formatDateTime, formatDuration, plural } from '@/components/format';
import { COURSE, findAssignment, findStudent } from '@/lib/course';
import { getSubmission } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** What the student sees after submitting. The analysis is for the instructor only. */
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await getSubmission(id);
  if (!submission) {
    notFound();
  }
  const assignment = findAssignment(submission.assignmentId);
  const student = findStudent(submission.studentId);
  const assignmentHref = `/courses/${COURSE.id}/assignments/${submission.assignmentId}`;

  return (
    <CourseShell
      active="assignments"
      crumbs={[
        { label: 'Assignments', href: `/courses/${COURSE.id}#assignments` },
        { label: assignment?.title ?? 'Assignment', href: assignmentHref },
        { label: 'Submission' }
      ]}
    >
      <div className="notice notice-success" role="status">
        <strong>Submission received.</strong> {student?.name ?? 'Your'} submission for{' '}
        {assignment?.title ?? 'this assignment'} was received on {formatDateTime(submission.submittedAt)}.
      </div>

      <h1>Your submission</h1>

      <section className="card">
        <h2>Files</h2>
        <ul className="file-list">
          {submission.files.map((file) => (
            <li key={file.name}>
              <code>{file.name}</code> <span className="muted">{formatCount(file.size)} bytes</span>
            </li>
          ))}
          <li>
            <code>recording.codelapse</code>{' '}
            <span className="muted">
              {plural(submission.recording.sessionCount, 'recorded session')},{' '}
              {formatDuration(submission.recording.recordedMs)} recorded
            </span>
          </li>
        </ul>
      </section>

      <section className="card card-upcoming">
        <h2>Coming next: four questions about your work</h2>
        <p>
          Four short questions about the choices you made in this assignment will open on this page. Answer them
          before <strong>{formatDateTime(submission.questionsCloseAt)}</strong>, one hour after you submitted.
        </p>
        <p className="muted">The questions are not ready in this version of the demo yet.</p>
      </section>

      <p>
        <Link href={assignmentHref}>Back to the assignment</Link>
      </p>
    </CourseShell>
  );
}
