def reverse(text: str) -> str:
    result = ""
    for i in range(len(text) - 1, -1, -1):
        result += text[i]
    return result


def count_vowels(text: str) -> int:
    count = 0
    for ch in text.lower():
        if ch in "aeiou":
            count += 1
    return count


if __name__ == "__main__":
    word = "codelapse"
    print(reverse(word))
    print(count_vowels(word))
