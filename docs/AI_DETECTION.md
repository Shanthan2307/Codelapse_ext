# Signs of AI use

How the site looks for AI use in a submission, why it relies mostly on the recording, and how to add an outside detector.

## Why the recording comes first

Detectors that read only the finished code are weak on course assignments: the programs are short, there are only a few sensible ways to write them, and a student who retypes AI output, or a beginner with tidy habits, defeats them both ways. Research on AI-code detectors in education (e.g. [arXiv 2401.03676](https://arxiv.org/abs/2401.03676)) found them easy to fool and prone to false positives. Keystroke-based detection works well for prose ([arXiv 2406.15335](https://arxiv.org/abs/2406.15335)), and CodeLapse already records how the code was written, so that is where most of the evidence comes from.

### The state of "official" detectors (checked November 2026)

| Service | Source code? | Notes |
|---|---|---|
| Copyleaks | **No longer** | Its AI code endpoint was deprecated in August 2025, and AI detection for source code was removed from all endpoints on 16 December 2025 ([release notes](https://docs.copyleaks.com/resources/updates/release-notes)). Code plagiarism checking still works. |
| GPTZero | No | Prose only. Its API (`/v2/predict/text`) is for natural language. |
| Originality.ai, Pangram, Sapling, Turnitin | No | Prose only. |
| Codequiry | Yes | AI-code detection for universities and colleges (not offered in the EU, EEA or UK; accounts are verified). API: create a check, upload a ZIP, start, poll 2–10 minutes, read `/ai-results`. Its documentation contradicts itself in places, so the integration here is tested against its documented answers only, not a live account. |

So the site supports Codequiry as an optional, secondary opinion.

## What the recording shows

Code: `packages/core/src/authorship.ts`. No AI is involved; the same recording always gives the same result.

1. **Where each line came from.** Each line of the final code is followed back to the first snapshot that contained it, ignoring whitespace (so reindenting or a formatter does not move it). That snapshot's edit decides the origin: mostly one large insert is *pasted*; small edits are *typed*; content that was already in the file, changed while recording was off, or never appears is *not written while recording*. Lines shorter than 4 non-space characters (`}`, `else {`) are not counted.
2. **Signals**, each weak, moderate or strong:

| Signal | When | Strength |
|---|---|---|
| Pasted code | ≥ 10% of lines pasted | strong ≥ 50%, moderate ≥ 25% |
| Code from outside | ≥ 10% of lines not written while recording | strong ≥ 50%, moderate ≥ 20% |
| Away, then paste | ≥ 20 s with no activity, then one edit adding ≥ 80 characters | moderate; strong if it happens twice |
| Transcribed | mostly typed, ≥ 95% of typed lines appear in final-file order, deletions < 5% of typed characters, no failed runs | moderate; strong with two or more style tells |
| Straight through / few corrections | one of the above without the others | weak |
| Never debugged | no runs recorded, or ≥ 30 lines and no run ever failed | weak |
| Fast for its size | > 8 typed lines per active minute (> 20: moderate) | weak / moderate |
| AI style | two or more style tells, or one strong tell (chat leftovers, typographic characters) | weak; moderate with a strong tell or four tells |

3. **Level:** *Strong signs* if any signal is strong or the weights (weak 1, moderate 3, strong 6) add up to 7 or more; *Some signs* from 3; otherwise *Few signs*.

The thresholds are first guesses, set against the scripted recordings in `fixtures/recordings`. The pilot data should be used to tune them. Note that the scripted "honest" recordings show *Some signs*, correctly: a script types far faster than a person and never makes a typo.

### Known gaps

- **Leaving VS Code is not recorded.** The extension does not record when the editor window loses focus, so "away, then paste" relies on a pause in editing. Recording window focus changes (`vscode.window.onDidChangeWindowState`) would make that signal much stronger; it needs a new extension build for the testers.
- **AI inside the editor** (Copilot, Cursor) shows up as pasted code, since accepted suggestions arrive as one large edit. Short completions under 20 characters count as typing.
- **Typing rhythm** (pause lengths before lines, burst regularity) is not used yet; snapshots are taken after 0.5 s pauses, which limits how much rhythm can be read.

## Adding Codequiry (optional)

It sends the submitted code (not names or recordings) to Codequiry, a separate company, so the testers' consent must cover it first.

1. Get an API key from your Codequiry account.
2. Set it where the site runs: `CODEQUIRY_API_KEY=...` in `apps/web/.env.local`, or in the Vercel project's environment variables. Optionally `CODEQUIRY_TEST_TYPE` picks the detection engine (default `1`; check Codequiry's `GET /test-types` for the one that includes AI detection on your plan).
3. On the hosted site, run `apps/web/supabase/schema.sql` again in the Supabase SQL editor: it allows the new `ai_detection` record.

After each upload the site starts a check. The instructor page asks Codequiry for the result at most every 30 seconds while it is open, and gives up after 45 minutes. The score appears in the **Signs of AI use** card and as `external_ai_probability` in the research export.
