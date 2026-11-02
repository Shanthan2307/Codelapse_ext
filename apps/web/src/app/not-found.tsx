import Link from 'next/link';
import { CourseShell } from '@/components/CourseShell';

export default function NotFound() {
  return (
    <CourseShell active="none" crumbs={[{ label: 'Not found' }]}>
      <h1>Page not found</h1>
      <p>This page does not exist, or the link is out of date.</p>
      <p>
        <Link href="/">Back to the course</Link>
      </p>
    </CourseShell>
  );
}
