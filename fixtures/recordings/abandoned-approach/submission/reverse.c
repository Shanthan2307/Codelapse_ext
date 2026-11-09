#include <stdio.h>
#include <string.h>
#include <ctype.h>

void reverse(char *s) {
    char *end = s + strlen(s) - 1;
    while (s < end) {
        char t = *s;
        *s++ = *end;
        *end-- = t;
    }
}

int count_vowels(const char *s) {
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

int main(void) {
    char name[] = "programming";
    reverse(name);
    printf("%s\n", name);
    printf("%d\n", count_vowels("programming"));
    return 0;
}
