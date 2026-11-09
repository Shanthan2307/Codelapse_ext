import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { ReplayView } from '@/components/ReplayView';
import { findAssignment, findStudent } from '@/lib/course';
import { readSessions } from '@/lib/recording';
import { getSubmission } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The student's recording as a replay, for instructors. `?session=<id>&at=<ms>`
 * opens it at a moment, e.g. from a decision moment or a process question.
 */
export default async function ReplayPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string; at?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const submission = await getSubmission(id);
  const sessions = submission ? await readSessions(id) : null;
  if (!submission || !sessions || sessions.length === 0) {
    notFound();
  }
  const student = findStudent(submission.studentId);
  const assignment = findAssignment(submission.assignmentId);
  const at = Number(query.at);

  return (
    <CourseShell
      active="instructor"
      crumbs={[
        { label: 'Instructor view', href: '/instructor' },
        { label: student?.name ?? 'Submission', href: `/instructor/submissions/${id}` },
        { label: 'Replay' }
      ]}
    >
      <h1>
        Replay: {student?.name ?? submission.studentId}
      </h1>
      <p className="lead">
        {assignment?.title ?? submission.assignmentId}. Press Play to watch the work being written, or click a bar in the
        file journey to jump to a visit. <a href={`/instructor/submissions/${id}`}>Back to the submission</a>
      </p>
      <ReplayView
        sessions={sessions}
        initialSessionId={query.session}
        initialMs={Number.isFinite(at) && at >= 0 ? at : 0}
      />
    </CourseShell>
  );
}
