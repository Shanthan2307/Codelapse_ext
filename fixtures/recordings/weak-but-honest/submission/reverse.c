#include <stdio.h>
#include <string.h>
#include <ctype.h>

void reverse(char *s) {
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

int count_vowels(const char *s) {
    int n = 0;
    for (int i = 0; s[i] != '\0'; i++) {
        switch (tolower((unsigned char)s[i])) {
        case 'a': case 'e': case 'i': case 'o': case 'u':
            n++;
            break;
        }
    }
    return n;
}

int main(void) {
    char text[] = "hello world";
    reverse(text);
    printf("%s\n", text);
    printf("%d\n", count_vowels("hello world"));
    return 0;
}
