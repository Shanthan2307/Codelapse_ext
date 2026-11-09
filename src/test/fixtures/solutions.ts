/** The finished assignment: reverse a string in place and count its vowels. */
export const SOLUTION = `#include <stdio.h>
#include <string.h>

void reverse(char *s) {
    size_t len = strlen(s);
    for (size_t i = 0; i < len / 2; i++) {
        char tmp = s[i];
        s[i] = s[len - 1 - i];
        s[len - 1 - i] = tmp;
    }
}

int count_vowels(const char *s) {
    int count = 0;
    for (; *s; s++) {
        if (strchr("aeiouAEIOU", *s)) {
            count++;
        }
    }
    return count;
}

int main(void) {
    char word[] = "codelapse";
    reverse(word);
    printf("%s\\n", word);
    printf("%d\\n", count_vowels("codelapse"));
    return 0;
}
`;

export const HEADER = `#include <stdio.h>
#include <string.h>

`;

export const REVERSE_LOOP = `void reverse(char *s) {
    size_t len = strlen(s);
    for (size_t i = 0; i < len / 2; i++) {
        char tmp = s[i];
        s[i] = s[len - 1 - i];
        s[len - 1 - i] = tmp;
    }
}

`;

export const COUNT_VOWELS = `int count_vowels(const char *s) {
    int count = 0;
    for (; *s; s++) {
        if (strchr("aeiouAEIOU", *s)) {
            count++;
        }
    }
    return count;
}

`;

export const MAIN_REVERSE_ONLY = `int main(void) {
    char word[] = "codelapse";
    reverse(word);
    printf("%s\\n", word);
    return 0;
}
`;

export const REVERSE_RECURSIVE = `void reverse_range(char *s, int lo, int hi) {
    if (lo >= hi) {
        return;
    }
    char tmp = s[lo];
    s[lo] = s[hi];
    s[hi] = tmp;
    reverse_range(s, lo + 1, hi - 1);
}

void reverse(char *s) {
    reverse_range(s, 0, (int)strlen(s) - 1);
}

`;

// ---- Different students' own versions, so code similarity separates them ----

/** A solution found elsewhere, pasted by pasted-solution and the copied pair. */
export const PASTED_SOLUTION = `#include <stdio.h>
#include <string.h>
#include <ctype.h>

void reverse(char *s) {
    for (int i = 0, j = strlen(s) - 1; i < j; ++i, --j) {
        char tmp = s[i];
        s[i] = s[j];
        s[j] = tmp;
    }
}

int count_vowels(const char *s) {
    int count = 0;
    while (*s) {
        switch (tolower((unsigned char)*s++)) {
            case 'a': case 'e': case 'i': case 'o': case 'u':
                count++;
        }
    }
    return count;
}

int main(void) {
    char word[] = "codelapse";
    reverse(word);
    printf("%s\\n", word);
    printf("%d\\n", count_vowels(word));
    return 0;
}
`;

/** The pasted solution with a few variables renamed, as a copy might be. */
export const RENAMED_PASTED_SOLUTION = PASTED_SOLUTION.replace(/\btmp\b/g, 'swap')
  .replace(/\bcount\b/g, 'total')
  .replace(/\bword\b/g, 'text');

/** weak-but-honest: two indices meeting in the middle, and a switch for vowels. */
export const WEAK_HEADER = `#include <stdio.h>
#include <string.h>
#include <ctype.h>

`;

export const WEAK_REVERSE = `void reverse(char *s) {
    int left = 0;
    int right = strlen(s) - 1;
    while (left < right) {
        char c = s[left];
        s[left] = s[right];
        s[right] = c;
        left++;
        right--;
    }
}

`;

export const WEAK_COUNT_VOWELS = `int count_vowels(const char *s) {
    int n = 0;
    for (int i = 0; s[i] != '\\0'; i++) {
        switch (tolower((unsigned char)s[i])) {
        case 'a': case 'e': case 'i': case 'o': case 'u':
            n++;
            break;
        }
    }
    return n;
}

`;

export const WEAK_MAIN_REVERSE_ONLY = `int main(void) {
    char text[] = "hello world";
    reverse(text);
    printf("%s\\n", text);
    return 0;
}
`;

export const WEAK_COUNT_LINE = '    printf("%d\\n", count_vowels("hello world"));\n';

export const WEAK_SOLUTION =
  WEAK_HEADER + WEAK_REVERSE + WEAK_COUNT_VOWELS + WEAK_MAIN_REVERSE_ONLY.replace('    return 0;', WEAK_COUNT_LINE + '    return 0;');

/** abandoned-approach: starts recursive, ends with two pointers. */
export const POINTER_REVERSE = `void reverse(char *s) {
    char *end = s + strlen(s) - 1;
    while (s < end) {
        char t = *s;
        *s++ = *end;
        *end-- = t;
    }
}

`;

export const POINTER_COUNT_VOWELS = `int count_vowels(const char *s) {
    const char *vowels = "aeiou";
    int found = 0;
    while (*s) {
        if (strchr(vowels, tolower((unsigned char)*s)) != NULL) {
            found++;
        }
        s++;
    }
    return found;
}

`;

export const POINTER_MAIN = `int main(void) {
    char name[] = "programming";
    reverse(name);
    printf("%s\\n", name);
    printf("%d\\n", count_vowels("programming"));
    return 0;
}
`;

export const POINTER_SOLUTION = WEAK_HEADER + POINTER_REVERSE + POINTER_COUNT_VOWELS + POINTER_MAIN;

/** edited-after-recording: a for loop with two indices and explicit vowel checks. */
export const EDITED_SOLUTION = `#include <stdio.h>
#include <string.h>

void reverse(char *str) {
    int n = (int)strlen(str);
    for (int i = 0, j = n - 1; i < j; i++, j--) {
        char saved = str[i];
        str[i] = str[j];
        str[j] = saved;
    }
}

int count_vowels(const char *str) {
    int vowels = 0;
    for (int i = 0; str[i]; i++) {
        char c = str[i];
        if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' ||
            c == 'A' || c == 'E' || c == 'I' || c == 'O' || c == 'U') {
            vowels++;
        }
    }
    return vowels;
}

int main(void) {
    char word[] = "codelapse";
    reverse(word);
    printf("%s\\n", word);
    printf("%d\\n", count_vowels("codelapse"));
    return 0;
}
`;

/** pasted-solution: a different solution from elsewhere, pasted in one edit. */
export const ONLINE_SOLUTION = `#include <stdio.h>
#include <string.h>

static void swap_chars(char *a, char *b) {
    char t = *a;
    *a = *b;
    *b = t;
}

void reverse(char *s) {
    size_t n = strlen(s);
    for (size_t k = 0; k < n / 2; k++) {
        swap_chars(&s[k], &s[n - 1 - k]);
    }
}

int count_vowels(const char *s) {
    static const char table[] = "aeiouAEIOU";
    int hits = 0;
    for (size_t k = 0; s[k] != '\\0'; k++) {
        if (memchr(table, s[k], sizeof table - 1) != NULL) {
            hits++;
        }
    }
    return hits;
}

int main(void) {
    char msg[] = "algorithms";
    reverse(msg);
    puts(msg);
    printf("%d\\n", count_vowels("algorithms"));
    return 0;
}
`;
