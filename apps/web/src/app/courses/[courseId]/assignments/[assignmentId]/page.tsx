import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { PreviousSubmission, SubmitPanel } from '@/components/SubmitPanel';
import { formatDateTime } from '@/components/format';
import { COURSE, findAssignment } from '@/lib/course';
import { latestSubmissions } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function AssignmentPage({
  params
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const assignment = findAssignment(assignmentId);
  if (courseId !== COURSE.id || !assignment) {
    notFound();
  }

  // The demo has no sign-in, so the form looks up the remembered name in this list.
  const previous: Record<string, PreviousSubmission> = Object.fromEntries(
    (await latestSubmissions(assignment.id)).map((s) => [
      s.studentId,
      { id: s.id, submittedAt: formatDateTime(s.submittedAt) }
    ])
  );

  return (
    <CourseShell
      active="assignments"
      crumbs={[{ label: 'Assignments', href: `/courses/${COURSE.id}#assignments` }, { label: assignment.title }]}
    >
      <h1>{assignment.title}</h1>
      <dl className="facts">
        <div>
          <dt>Due</dt>
          <dd>{formatDateTime(assignment.dueAt)}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{assignment.points}</dd>
        </div>
        <div>
          <dt>Submitting</dt>
          <dd>{assignment.expectedFiles.join(', ')} and a .codelapse recording</dd>
        </div>
      </dl>

      <div className="assignment-layout">
        <div>
          <h2>How to submit</h2>
          <ol className="steps">
            <li>
              <div>
                <strong>Record your work in VS Code</strong>
                <span>Click &ldquo;CodeLapse: Choose folder&rdquo; in the status bar and pick your assignment folder.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Export your recording</strong>
                <span>
                  When you are done, run &ldquo;CodeLapse: Export Assignment Bundle&rdquo; from the Command Palette.
                </span>
              </div>
            </li>
            <li>
              <div>
                <strong>Upload it here</strong>
                <span>Add the .codelapse file and {assignment.expectedFiles.join(', ')} to the form, then submit.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Answer four questions</strong>
                <span>Short questions about your work appear right after you submit. You have one hour.</span>
              </div>
            </li>
          </ol>

          <h2>Assignment</h2>
          <div className="description">
            {assignment.description.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>

        <div className="submit-slot">
          <SubmitPanel
            assignmentId={assignment.id}
            students={COURSE.students}
            expectedFiles={assignment.expectedFiles}
            previous={previous}
          />
        </div>
      </div>
    </CourseShell>
  );
}
