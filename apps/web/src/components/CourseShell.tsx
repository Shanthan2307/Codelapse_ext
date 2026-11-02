import Link from 'next/link';
import { COURSE } from '@/lib/course';

export interface Crumb {
  label: string;
  href?: string;
}

interface CourseShellProps {
  /** Which course-nav entry is current. */
  active: 'home' | 'assignments' | 'instructor' | 'none';
  crumbs: Crumb[];
  children: React.ReactNode;
}

/**
 * The page frame: a narrow global nav, the course nav and a breadcrumb, laid
 * out like a learning management system. It is a demo, and says so.
 */
export function CourseShell({ active, crumbs, children }: CourseShellProps) {
  const courseHref = `/courses/${COURSE.id}`;
  return (
    <div className="app">
      <nav className="global-nav" aria-label="Site">
        <Link href={courseHref} className="global-nav-brand" title="Demo course site">
          <span aria-hidden="true">CL</span>
          <span className="sr-only">Demo course site</span>
        </Link>
        <Link href={courseHref} className="global-nav-item">
          <span className="global-nav-icon" aria-hidden="true">▤</span>
          Courses
        </Link>
        <Link href="/instructor" className="global-nav-item">
          <span className="global-nav-icon" aria-hidden="true">◎</span>
          Instructor
        </Link>
      </nav>

      <div className="page">
        <header className="topbar">
          <ol className="breadcrumb" aria-label="Breadcrumb">
            <li>
              <Link href={courseHref}>{COURSE.code}</Link>
            </li>
            {crumbs.map((crumb, i) => (
              <li key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                {crumb.href && i < crumbs.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
              </li>
            ))}
          </ol>
          <span className="demo-badge">Demo course site · not a real LMS</span>
        </header>

        <div className="page-body">
          <nav className="course-nav" aria-label="Course">
            <p className="course-nav-term">{COURSE.term}</p>
            <Link href={courseHref} className={active === 'home' ? 'active' : undefined}>
              Home
            </Link>
            <Link href={`${courseHref}#assignments`} className={active === 'assignments' ? 'active' : undefined}>
              Assignments
            </Link>
            <span className="disabled" aria-disabled="true" title="Grades are not part of this demo">
              Grades
            </span>
            <Link href="/instructor" className={active === 'instructor' ? 'active' : undefined}>
              Instructor view
            </Link>
          </nav>
          <main className="content">{children}</main>
        </div>
      </div>
    </div>
  );
}
