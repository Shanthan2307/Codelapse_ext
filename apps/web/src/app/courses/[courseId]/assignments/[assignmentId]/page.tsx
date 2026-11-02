import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { SubmitPanel } from '@/components/SubmitPanel';
import { formatDateTime } from '@/components/format';
import { COURSE, findAssignment } from '@/lib/course';

export default async function AssignmentPage({
  params,
  searchParams
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
  searchParams: Promise<{ submit?: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const { submit } = await searchParams;
  const assignment = findAssignment(assignmentId);
  if (courseId !== COURSE.id || !assignment) {
    notFound();
  }

  return (
    <CourseShell
      active="assignments"
      crumbs={[{ label: 'Assignments', href: `/courses/${COURSE.id}#assignments` }, { label: assignment.title }]}
    >
      <div className="title-row">
        <h1>{assignment.title}</h1>
        <SubmitPanelSlot
          assignmentId={assignment.id}
          expectedFiles={assignment.expectedFiles}
          initiallyOpen={submit === '1'}
        />
      </div>

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

      <div className="description">
        {assignment.description.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </CourseShell>
  );
}

function SubmitPanelSlot({
  assignmentId,
  expectedFiles,
  initiallyOpen
}: {
  assignmentId: string;
  expectedFiles: string[];
  initiallyOpen: boolean;
}) {
  return (
    <div className="submit-slot">
      <SubmitPanel
        assignmentId={assignmentId}
        students={COURSE.students}
        expectedFiles={expectedFiles}
        initiallyOpen={initiallyOpen}
      />
    </div>
  );
}
