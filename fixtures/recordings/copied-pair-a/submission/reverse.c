#include <stdio.h>
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
    printf("%s\n", word);
    printf("%d\n", count_vowels(word));
    return 0;
}
