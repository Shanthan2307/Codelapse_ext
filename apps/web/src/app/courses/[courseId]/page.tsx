import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseShell } from '@/components/CourseShell';
import { formatDateTime } from '@/components/format';
import { COURSE, LANGUAGE_LABELS } from '@/lib/course';

export default async function CourseHome({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  if (courseId !== COURSE.id) {
    notFound();
  }
  return (
    <CourseShell active="home" crumbs={[{ label: 'Home' }]}>
      <h1>
        {COURSE.code}: {COURSE.title}
      </h1>
      <p className="lead">{COURSE.term}. Submit your code here together with your CodeLapse recording.</p>

      <h2 id="assignments">Assignments</h2>
      <p className="hint">Assignment 3 comes in C and Python. Assignments 4 and 5 are short Python programs in one file; assignment 6 is a medium Python program in two files. Assignment 7, Valid Palindrome, is a short DSA problem in Python or Java. Do the one your instructor gives you.</p>
      <ul className="item-list">
        {COURSE.assignments.map((assignment) => (
          <li key={assignment.id}>
            <span className="item-head">
              <span className={`lang-badge lang-${assignment.language}`}>{LANGUAGE_LABELS[assignment.language]}</span>
              <Link href={`/courses/${COURSE.id}/assignments/${assignment.id}`} className="item-title">
                {assignment.title}
              </Link>
            </span>
            <span className="item-meta">
              Due {formatDateTime(assignment.dueAt)} · {assignment.points} pts ·{' '}
              <a href={assignment.briefPdf} target="_blank" rel="noopener">
                Brief (PDF)
              </a>
            </span>
          </li>
        ))}
      </ul>
    </CourseShell>
  );
}
