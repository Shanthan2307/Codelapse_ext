# Scripted test recordings

**These recordings are scripted, not made by people.** A test script drove the real CodeLapse extension in a real VS Code: it typed into real files one character at a time, built with real `gcc` tasks, and exported real `.codelapse` bundles. Use them to test analysis code, never as evidence about how students work.

Regenerate them with:

```bash
npm run fixtures
```

The script is `src/test/fixtures/generate.fixture.ts`. A run takes about 3–4 minutes. Timestamps, durations and file hashes change on every run; the scripted behaviour does not.

## The assignment
Every scenario writes `reverse.c`: `void reverse(char *s)` reverses a string in place, `int count_vowels(const char *s)` counts vowels, and `main` prints both results. Builds run as a VS Code task: `gcc -Wall -o reverse reverse.c && ./reverse`.

## Files per scenario
| File | Contents |
|---|---|
| `<name>.codelapse` | The bundle exported by the extension |
| `submission/reverse.c` | The code that would be uploaded with it |
| `expected.json` | What the recording should show: build results in order, plus traits such as `bulkInsert` or `abandonedApproach` |

## Scenarios
| Scenario | What the script does | Builds |
|---|---|---|
| `honest-incremental` | Types `reverse()` and `main()` line by line, forgets a semicolon, fixes it, then adds `count_vowels()` | fail, pass, pass |
| `pasted-solution` | Inserts the whole solution in one edit | pass |
| `copied-pair-a` | Pastes the same solution as `pasted-solution` | pass |
| `copied-pair-b` | Pastes that solution with `tmp`, `count` and `word` renamed to `swap`, `total` and `text` | pass |
| `weak-but-honest` | Types slowly with real mistakes: missing semicolon, misspelt variable, then deletes and rewrites the loop with a missing parenthesis | fail, fail, fail, pass, pass |
| `abandoned-approach` | Writes a working recursive `reverse()`, keeps it about 10 seconds, deletes it and writes the loop version | pass, pass |
| `edited-after-recording` | Types the solution honestly; after export, `reverse.c` is changed outside VS Code, so the submission no longer matches the recording | pass |

## Limits to keep in mind
- **Time scale:** the abandoned recursive version lives for about 10 seconds, not minutes, to keep generation short. Any analysis threshold based on how long code existed should be configurable so these recordings can exercise it.
- **Typing speed:** "typed" text is inserted one character per edit with short pauses after each line, so it is faster and more regular than a person.
- **One session each:** every scenario is a single recording session.
