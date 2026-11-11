/**
 * The demo course. Everything here is made up for the demo: edit it to match
 * the assignment and the testers you are running it with.
 */
export interface Student {
  id: string;
  name: string;
}

export type Language = 'c' | 'python';

export interface Assignment {
  id: string;
  title: string;
  /** The programming language students write the assignment in. */
  language: Language;
  /** Site path of the PDF brief with the full assignment, e.g. /assignments/….pdf */
  briefPdf: string;
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
      title: 'Assignment 3 (C): Reverse a String',
      language: 'c',
      briefPdf: '/assignments/assignment-3-c-reverse-a-string.pdf',
      points: 20,
      dueAt: '2026-11-20T23:59:00',
      description: [
        'Write reverse.c in C. Implement void reverse(char *s), which reverses a string in place, and int count_vowels(const char *s), which returns the number of vowels in a string.',
        'Your main function should call both and print the results. It must compile without warnings using gcc -Wall.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with reverse.c.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['reverse.c']
    },
    {
      id: 'a3-reverse-py',
      title: 'Assignment 3 (Python): Reverse a String',
      language: 'python',
      briefPdf: '/assignments/assignment-3-python-reverse-a-string.pdf',
      points: 20,
      dueAt: '2026-11-20T23:59:00',
      description: [
        'Write reverse.py in Python. Implement def reverse(text: str) -> str, which returns the string reversed, and def count_vowels(text: str) -> int, which returns the number of vowels (a, e, i, o, u in either case).',
        'Reverse the string with a loop: do not use slicing such as text[::-1], reversed(), or any other helper that reverses for you. Use only the standard library.',
        'Under if __name__ == "__main__": call both functions and print the results. Run it with python3 reverse.py.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with reverse.py.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['reverse.py']
    }
  ]
};

export function findAssignment(assignmentId: string): Assignment | undefined {
  return COURSE.assignments.find((a) => a.id === assignmentId);
}

export function findStudent(studentId: string): Student | undefined {
  return COURSE.students.find((s) => s.id === studentId);
}

export const LANGUAGE_LABELS: Record<Language, string> = { c: 'C', python: 'Python' };

/** Which code files a student may upload for each language. */
const CODE_FILE_PATTERNS: Record<Language, RegExp> = {
  c: /^(?:[\w.-]+\.(?:c|h)|Makefile|makefile)$/,
  python: /^[\w.-]+\.py$/
};

export function isAllowedCodeFile(language: Language, name: string): boolean {
  return CODE_FILE_PATTERNS[language].test(name);
}

/** File extensions for the file picker's accept list. */
export const CODE_FILE_ACCEPT: Record<Language, string> = { c: '.c,.h', python: '.py' };

/** Plain words for what may be uploaded, used in messages. */
export const CODE_FILE_HELP: Record<Language, { kind: string; upload: string }> = {
  c: { kind: 'a C source file', upload: 'Upload .c and .h files (or a Makefile).' },
  python: { kind: 'a Python file', upload: 'Upload your .py files.' }
};

/** The assignment the instructor pages show: the one asked for, or the first. */
export function selectedAssignment(assignmentId: string | string[] | undefined): Assignment {
  const id = Array.isArray(assignmentId) ? assignmentId[0] : assignmentId;
  return (id && findAssignment(id)) || COURSE.assignments[0];
}
