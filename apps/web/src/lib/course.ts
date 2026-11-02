/**
 * The demo course. Everything here is made up for the demo: edit it to match
 * the assignment and the testers you are running it with.
 */
export interface Student {
  id: string;
  name: string;
}

export interface Assignment {
  id: string;
  title: string;
  points: number;
  dueAt: string;
  /** Plain paragraphs shown on the assignment page. */
  description: string[];
  /** File names the student is asked to upload. */
  expectedFiles: string[];
}

export interface Course {
  id: string;
  code: string;
  title: string;
  term: string;
  students: Student[];
  assignments: Assignment[];
}

export const COURSE: Course = {
  id: 'cs101',
  code: 'CS 101',
  title: 'Programming Principles',
  term: 'Fall 2026',
  students: [
    { id: 'student-a', name: 'Student A' },
    { id: 'student-b', name: 'Student B' },
    { id: 'student-c', name: 'Student C' },
    { id: 'student-d', name: 'Student D' },
    { id: 'student-e', name: 'Student E' }
  ],
  assignments: [
    {
      id: 'a3-reverse',
      title: 'Assignment 3: Reverse a String',
      points: 20,
      dueAt: '2026-11-20T23:59:00',
      description: [
        'Write reverse.c in C. Implement void reverse(char *s), which reverses a string in place, and int count_vowels(const char *s), which returns the number of vowels in a string.',
        'Your main function should call both and print the results. It must compile without warnings using gcc -Wall.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with reverse.c.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['reverse.c']
    }
  ]
};

export function findAssignment(assignmentId: string): Assignment | undefined {
  return COURSE.assignments.find((a) => a.id === assignmentId);
}

export function findStudent(studentId: string): Student | undefined {
  return COURSE.students.find((s) => s.id === studentId);
}
