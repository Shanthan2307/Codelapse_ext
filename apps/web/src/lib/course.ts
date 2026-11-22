/**
 * The demo course. Everything here is made up for the demo: edit it to match
 * the assignment and the testers you are running it with.
 */
export interface Student {
  id: string;
  name: string;
}

export type Language = 'c' | 'python' | 'java';

export interface Assignment {
  id: string;
  title: string;
  /** A short name for tabs and lists, e.g. "Python: Grades". */
  label: string;
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
      label: 'C: Reverse',
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
      label: 'Python: Reverse',
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
    },
    {
      id: 'a4-grades-py',
      title: 'Assignment 4 (Python): Grade Statistics',
      label: 'Python: Grades',
      language: 'python',
      briefPdf: '/assignments/assignment-4-python-grade-statistics.pdf',
      points: 20,
      dueAt: '2026-11-24T23:59:00',
      description: [
        'Write grades.py in Python. Implement average(scores) (0.0 for an empty list), highest(scores) (None for an empty list), letter_grade(score) (A from 90, B from 80, C from 70, D from 60, otherwise F) and count_passing(scores, pass_mark=60).',
        'Write the loops yourself: do not use sum(), max(), min(), sorted() or any import.',
        'Under if __name__ == "__main__": run them on a list of scores and print the results. Run it with python3 grades.py.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with grades.py.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['grades.py']
    },
    {
      id: 'a5-wordcount-py',
      title: 'Assignment 5 (Python): Word Frequency',
      label: 'Python: Words',
      language: 'python',
      briefPdf: '/assignments/assignment-5-python-word-frequency.pdf',
      points: 20,
      dueAt: '2026-11-24T23:59:00',
      description: [
        'Write wordcount.py in Python. Implement clean_word(word) (strip punctuation from both ends, lower case), count_words(text) (a dictionary from each word to its count) and top_words(counts, n) (the n most frequent words as (word, count) tuples, ties in alphabetical order).',
        'Count with a dictionary of your own: do not use collections.Counter, re or any other import.',
        'Under if __name__ == "__main__": count the words of a short text and print the top 3. Run it with python3 wordcount.py.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with wordcount.py.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['wordcount.py']
    },
    {
      id: 'a6-library-py',
      title: 'Assignment 6 (Python): Library Checkout',
      label: 'Python: Library',
      language: 'python',
      briefPdf: '/assignments/assignment-6-python-library-checkout.pdf',
      points: 30,
      dueAt: '2026-11-24T23:59:00',
      description: [
        'A medium assignment in two files. In library.py, write a module with a LibraryError exception and Book and Library classes: add_book, available, checkout, return_book and loans_of, enforcing the rules in the brief (copies on the shelf, one copy per member, at most 3 books per member). The module never prints; it raises LibraryError when a rule is broken.',
        'In main.py, import the module and write run(commands, library), which processes commands such as "checkout 111 ana" and returns one output line each, turning a LibraryError into an "error: ..." line and carrying on.',
        'Under if __name__ == "__main__": in main.py, build the sample library from the brief and print the results of the sample commands. Run it with python3 main.py.',
        'Record your work with the CodeLapse extension in VS Code. When you are done, run "CodeLapse: Export Assignment Bundle" and upload the .codelapse file together with library.py and main.py.',
        'After you submit, you will get four short questions about your work. You have one hour from submission to answer them.'
      ],
      expectedFiles: ['library.py', 'main.py']
    },
    {
      id: 'a7-palindrome-py',
      title: 'Assignment 7 (Python): Valid Palindrome',
      label: 'Python: Palindrome',
      language: 'python',
      briefPdf: '/assignments/assignment-7-python-valid-palindrome.pdf',
      points: 20,
      dueAt: '2026-11-28T23:59:00',
      description: [
        'Given a string s, return true if it is a palindrome, otherwise return false. A palindrome reads the same forward and backward; it is case-insensitive and ignores all non-alphanumeric characters.',
        'Write palindrome.py with def is_palindrome(s: str) -> bool. Run it with python3 palindrome.py.',
        'Record your work with the CodeLapse extension, export the bundle, and upload the .codelapse file together with palindrome.py. You then have one hour to answer four short questions.'
      ],
      expectedFiles: ['palindrome.py']
    },
    {
      id: 'a7-palindrome-java',
      title: 'Assignment 7 (Java): Valid Palindrome',
      label: 'Java: Palindrome',
      language: 'java',
      briefPdf: '/assignments/assignment-7-java-valid-palindrome.pdf',
      points: 20,
      dueAt: '2026-11-28T23:59:00',
      description: [
        'Given a string s, return true if it is a palindrome, otherwise return false. A palindrome reads the same forward and backward; it is case-insensitive and ignores all non-alphanumeric characters.',
        'Write Palindrome.java with public static boolean isPalindrome(String s). Run it with javac Palindrome.java && java Palindrome.',
        'Record your work with the CodeLapse extension, export the bundle, and upload the .codelapse file together with Palindrome.java. You then have one hour to answer four short questions.'
      ],
      expectedFiles: ['Palindrome.java']
    }
  ]
};

export function findAssignment(assignmentId: string): Assignment | undefined {
  return COURSE.assignments.find((a) => a.id === assignmentId);
}

export function findStudent(studentId: string): Student | undefined {
  return COURSE.students.find((s) => s.id === studentId);
}

export const MAX_NAME_LENGTH = 80;

/** Tidies a typed name: trimmed, single spaces, at most MAX_NAME_LENGTH characters. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * A stable id for a tester who typed their name, so the same name always maps
 * to the same student (their latest submission, the research pseudonym).
 */
export function testerId(name: string): string {
  const slug = cleanName(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `tester-${slug}` : '';
}

/** The name to show for a submission: the typed name, the roster name, or the id. */
export function displayName(record: { studentId: string; studentName?: string }): string {
  return record.studentName || findStudent(record.studentId)?.name || record.studentId;
}

export const LANGUAGE_LABELS: Record<Language, string> = { c: 'C', python: 'Python', java: 'Java' };

/** Which code files a student may upload for each language. */
const CODE_FILE_PATTERNS: Record<Language, RegExp> = {
  c: /^(?:[\w.-]+\.(?:c|h)|Makefile|makefile)$/,
  python: /^[\w.-]+\.py$/,
  java: /^[\w.-]+\.java$/
};

export function isAllowedCodeFile(language: Language, name: string): boolean {
  return CODE_FILE_PATTERNS[language].test(name);
}

/** File extensions for the file picker's accept list. */
export const CODE_FILE_ACCEPT: Record<Language, string> = { c: '.c,.h', python: '.py', java: '.java' };

/** Plain words for what may be uploaded, used in messages. */
export const CODE_FILE_HELP: Record<Language, { kind: string; upload: string; attach: string; extensions: string }> = {
  c: { kind: 'a C source file', upload: 'Upload .c and .h files (or a Makefile).', attach: 'Attach your code (.c or .h files).', extensions: '.c and .h' },
  python: { kind: 'a Python file', upload: 'Upload your .py files.', attach: 'Attach your code (.py files).', extensions: '.py' },
  java: { kind: 'a Java file', upload: 'Upload your .java files.', attach: 'Attach your code (.java files).', extensions: '.java' }
};

/** Languages whose code is compiled before it runs, so runs are called builds. */
export const COMPILED: Record<Language, boolean> = { c: true, python: false, java: true };

/** The assignment the instructor pages show: the one asked for, or the first. */
export function selectedAssignment(assignmentId: string | string[] | undefined): Assignment {
  const id = Array.isArray(assignmentId) ? assignmentId[0] : assignmentId;
  return (id && findAssignment(id)) || COURSE.assignments[0];
}
