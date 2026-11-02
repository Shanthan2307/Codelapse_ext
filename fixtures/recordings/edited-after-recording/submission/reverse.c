#include <stdio.h>
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
    /* final tweak */
    char word[] = "research";
    reverse(word);
    printf("%s\n", word);
    printf("%d\n", count_vowels("codelapse"));
    return 0;
}
