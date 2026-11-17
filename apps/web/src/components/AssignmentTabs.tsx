import Link from 'next/link';
import { COURSE, LANGUAGE_LABELS, type Assignment } from '@/lib/course';

/** Switches the instructor pages between the C and Python versions of the assignment. */
export function AssignmentTabs({ basePath, current }: { basePath: string; current: Assignment }) {
  return (
    <nav className="assignment-tabs" aria-label="Assignment">
      {COURSE.assignments.map((assignment) => (
        <Link
          key={assignment.id}
          href={withAssignment(basePath, assignment.id)}
          aria-current={assignment.id === current.id ? 'page' : undefined}
        >
          {LANGUAGE_LABELS[assignment.language]}
        </Link>
      ))}
    </nav>
  );
}

/** A link that keeps the chosen assignment. */
export function withAssignment(path: string, assignmentId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}assignment=${encodeURIComponent(assignmentId)}`;
}
