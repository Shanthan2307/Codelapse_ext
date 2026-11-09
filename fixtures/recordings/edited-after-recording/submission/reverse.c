#include <stdio.h>
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
    /* final tweak */
    char word[] = "research";
    reverse(word);
    printf("%s\n", word);
    printf("%d\n", count_vowels("codelapse"));
    return 0;
}
