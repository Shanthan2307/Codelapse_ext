import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { formatCount, formatDateTime, formatDuration, plural } from '@/components/format';
import { COURSE, findAssignment, findStudent } from '@/lib/course';
import { getAnswers, getQuestionSet, getSubmission } from '@/lib/store';
import { studentView } from '@/lib/questions/answers';
import { QuestionsForm, QuestionsState } from '@/components/QuestionsForm';

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
  const set = await getQuestionSet(id);
  const answers = await getAnswers(id);
  // Only what the student may see: question text and excerpts, never the generator's notes.
  const questions: QuestionsState = {
    status: set?.status ?? 'pending',
    closesAt: submission.questionsCloseAt,
    questions: set?.status === 'ready' ? studentView(set) : [],
    answered: answers !== null,
    answers: answers?.answers ?? [],
    answeredAt: answers?.submittedAt
  };

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

      <QuestionsForm submissionId={submission.id} initial={questions} />

      <p>
        <Link href={assignmentHref}>Back to the assignment</Link>
      </p>
    </CourseShell>
  );
}
