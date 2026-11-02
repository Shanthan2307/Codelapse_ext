#include <stdio.h>
#include <string.h>

void reverse(char *s) {
    size_t len = strlen(s);
    for (size_t i = 0; i < len / 2; i++) {
        char swap = s[i];
        s[i] = s[len - 1 - i];
        s[len - 1 - i] = swap;
    }
}

int count_vowels(const char *s) {
    int total = 0;
    for (; *s; s++) {
        if (strchr("aeiouAEIOU", *s)) {
            total++;
        }
    }
    return total;
}

int main(void) {
    char text[] = "codelapse";
    reverse(text);
    printf("%s\n", text);
    printf("%d\n", count_vowels("codelapse"));
    return 0;
}
