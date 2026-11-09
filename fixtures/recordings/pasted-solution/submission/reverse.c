#include <stdio.h>
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
    for (size_t k = 0; s[k] != '\0'; k++) {
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
    printf("%d\n", count_vowels("algorithms"));
    return 0;
}
