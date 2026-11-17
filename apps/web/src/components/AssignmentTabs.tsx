import Link from 'next/link';
import { COURSE, type Assignment } from '@/lib/course';

/** Switches the instructor pages between the course's assignments. */
export function AssignmentTabs({ basePath, current }: { basePath: string; current: Assignment }) {
  return (
    <nav className="assignment-tabs" aria-label="Assignment">
      {COURSE.assignments.map((assignment) => (
        <Link
          key={assignment.id}
          href={withAssignment(basePath, assignment.id)}
          aria-current={assignment.id === current.id ? 'page' : undefined}
        >
          {assignment.label}
        </Link>
      ))}
    </nav>
  );
}

/** A link that keeps the chosen assignment. */
export function withAssignment(path: string, assignmentId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}assignment=${encodeURIComponent(assignmentId)}`;
}
