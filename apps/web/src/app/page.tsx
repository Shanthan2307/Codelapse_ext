import { redirect } from 'next/navigation';
import { COURSE } from '@/lib/course';

export default function Home() {
  redirect(`/courses/${COURSE.id}`);
}
