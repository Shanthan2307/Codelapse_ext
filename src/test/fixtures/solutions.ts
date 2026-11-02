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

/** The same solution with a few variables renamed, as a copy might be. */
export const RENAMED_SOLUTION = SOLUTION.replace(/\btmp\b/g, 'swap').replace(/\bcount\b/g, 'total').replace(/\bword\b/g, 'text');

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

export const MAIN_FULL = `int main(void) {
    char word[] = "codelapse";
    reverse(word);
    printf("%s\\n", word);
    printf("%d\\n", count_vowels("codelapse"));
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
