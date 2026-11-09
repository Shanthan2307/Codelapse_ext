#include <stdio.h>
#include <string.h>
#include <ctype.h>

void reverse(char *s) {
    for (int i = 0, j = strlen(s) - 1; i < j; ++i, --j) {
        char swap = s[i];
        s[i] = s[j];
        s[j] = swap;
    }
}

int count_vowels(const char *s) {
    int total = 0;
    while (*s) {
        switch (tolower((unsigned char)*s++)) {
            case 'a': case 'e': case 'i': case 'o': case 'u':
                total++;
        }
    }
    return total;
}

int main(void) {
    char text[] = "codelapse";
    reverse(text);
    printf("%s\n", text);
    printf("%d\n", count_vowels(text));
    return 0;
}
