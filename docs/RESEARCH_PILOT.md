# Research pilot protocol

A plan for running CodeLapse with the five student testers on Assignment 3 (Reverse a String), and for reading the results afterwards.

## What the pilot is for

CodeLapse asks each student four short questions about their own submission: two about decisions in their recording (**process questions**) and two about specific lines of their code (**code questions**). A second AI reviews the answers. The pilot looks at two questions:

1. **Do process questions separate understanding better than code questions?** If they do, a student who understands their work should do clearly better than one who doesn't on process questions, more than on code questions.
2. **Does the AI reviewer agree with the instructor?** The instructor rates every review. How often they agree, and in which direction they disagree, tells us whether the reviewer can be trusted.

Five students is a small number. Treat the results as a check that the method works and as a source of examples, not as proof.

## Roles

- **Instructor:** runs the site, watches the session, rates every review afterwards and exports the data.
- **Students:** do the assignment in VS Code with CodeLapse, submit, and answer the four questions.
- **Observer (optional):** notes questions students ask and anything that confuses them.

## Before the session

- **Consent.** Record each student's consent outside CodeLapse (a signed form or an email). The site has no consent step. Students have already agreed to their code being sent to Claude; repeat that in the consent text.
- **Tell students what is collected:** typing in the chosen folder, builds run as Tasks or in the terminal, switches between files, the uploaded code, the recording and their four answers. Not collected: other folders, absolute file paths, anything outside VS Code.
- **Set up** as in [RUNNING_THE_DEMO.md](RUNNING_THE_DEMO.md): build the `.vsix`, check that `apps/web/.env.local` holds an API key with credit, and edit the five names in `apps/web/src/lib/course.ts`.
- **Start from empty data.** Run `npm run demo:reset` (it moves old submissions into an archive folder, it never deletes them), then `npm run demo`.
- **Do a dry run yourself** with one of the scripted recordings in `fixtures/recordings`, so you know questions are being generated. Reset again afterwards.

## Session script (about 75 minutes)

| Time | Step |
|---|---|
| 0–10 min | Welcome and consent check. Students install the `.vsix` and set **CodeLapse: Submission Url** to the address `npm run demo` printed. |
| 10–15 min | Students create an empty folder and choose it in CodeLapse (status bar). Check every status bar says it is recording that folder. |
| 15–50 min | Students write `reverse.c` and build with `gcc` in the terminal as they normally would. Don't help with the code. Answer only questions about the tools. |
| 50–55 min | Students run **CodeLapse: Export Assignment Bundle**, open the submission page and upload the `.codelapse` file with `reverse.c`. |
| 55–70 min | Students answer the four questions. They have one hour from uploading; most need 10–20 minutes. |
| 70–75 min | Short debrief: which questions felt fair, which were confusing. The observer writes this down. |

The one-hour answer window starts when a student uploads, not when they open the questions. If questions take long to appear, note it.

## After the session

1. **Rate every review.** On each student's instructor page, for every answer: say whether you agree with the reviewer's level (**agree**, **too high** or **too low**), give your own level (strong, partial or limited), and add a note if useful. Mark whether each question was useful, and tick **follow up** for any student you want to talk to. Rate before looking at other students, so the comparison stays independent.
2. **Export the data** (instructor-only):
   - `/api/research/export?assignment=a3-reverse&table=answers` — one row per answered question (CSV).
   - `/api/research/export?assignment=a3-reverse&table=submissions` — one row per student (CSV).
   - Add `&format=json` for both tables in one file. Add `&includeText=1` only if you need the answer text itself; it is left out by default.
3. **Fill in the two tables below.**

### Columns: answers table

| Column | Meaning |
|---|---|
| `participant` | Participant code, `P` plus 8 hex digits. Stable within one pilot. |
| `question` | `q1`–`q4` |
| `question_type` | `process` or `code` |
| `concept` | The programming idea the question checks |
| `cites_moment_kind` | For process questions, what happened in the recording (for example `fix-after-failed-run`) |
| `generator_model`, `generator_prompt` | Which model and prompt version wrote the question |
| `minutes_to_answers` | Minutes from uploading to submitting the answers |
| `answer_chars`, `answer_words` | Length of the answer |
| `answer_text` | Only with `includeText=1` |
| `evaluator_model`, `evaluator_prompt` | Which model and prompt version reviewed the answer |
| `addresses_question` | Whether the reviewer thought the answer answered the question |
| `score_specificity`, `score_consistency`, `score_reasoning` | The reviewer's 0–3 scores |
| `score_total` | Their sum, 0–9 |
| `evaluator_level` | `strong` (7–9), `partial` (4–6) or `limited` (0–3) |
| `evaluator_concerns` | How many concerns the reviewer raised |
| `instructor_agreement` | `agree`, `too-high`, `too-low`, or empty if not rated |
| `instructor_level` | Your own level for the answer |
| `instructor_question_useful` | Whether you marked the question useful |

### Columns: submissions table

| Column | Meaning |
|---|---|
| `participant` | Participant code |
| `answered`, `minutes_to_answers` | Whether and how fast the student answered |
| `questions_status`, `evaluation_status` | Whether questions and the review were produced (`ready`, `failed`, …) |
| `session_count`, `recorded_minutes` | How much was recorded |
| `typed_chars`, `bulk_inserted_chars`, `pre_existing_chars` | Typed text, text added in large single edits (paste, autocomplete, formatting or undo), and text already in files |
| `runs_passed`, `runs_failed`, `runs_unknown` | Builds and runs by result |
| `replay_verdict`, `replay_files_differing` | Whether the recording ends at the submitted code |
| `moments_*` | How many decision moments of each kind were found |
| `review_strong`, `review_partial`, `review_limited` | The reviewer's levels across the four answers |
| `instructor_follow_up` | Whether you ticked follow up |

### Table 1: process vs code questions

Use your own level (`instructor_level`) as the measure of understanding. Count answers per cell:

| | Strong | Partial | Limited |
|---|---|---|---|
| Process questions | | | |
| Code questions | | | |

Then compare students: for each participant, write their process-question levels next to their code-question levels. If process questions separate students better, students you consider weaker should drop more on process questions than on code questions.

### Table 2: reviewer vs instructor

Count rated answers by `evaluator_level` (rows) and `instructor_level` (columns):

| Reviewer \ You | Strong | Partial | Limited |
|---|---|---|---|
| Strong | | | |
| Partial | | | |
| Limited | | | |

Agreement is the diagonal divided by the total. Also count `instructor_agreement`: many `too-high` ratings mean the reviewer is generous; many `too-low` ratings mean it is harsh. Read the notes on every disagreement: they are more useful than the numbers at this size.

## Data handling

- **Where data lives:** everything is in `apps/web/data` on the machine running the site (or `CODELAPSE_DATA_DIR`): the uploaded code, recordings, questions, answers, reviews and your ratings. Git ignores this folder.
- **Pseudonymisation:** exports use participant codes made from a salted hash of each student id. The salt is `CODELAPSE_RESEARCH_SALT` if set, otherwise a random value saved in `research-salt.txt` in the data folder on the first export. Anyone with that salt and the class list can recompute the codes, so keep the file private and don't share it with the exports. Exports never contain names, student ids or code; answer text only when asked for.
- **Deleting:** `npm run demo:reset` moves the data into `apps/web/data-archive-<date-time>`. Delete that folder yourself when the data is no longer needed under your consent terms.
- **Data sent to Anthropic:** to write questions and review answers, the site sends each student's code, the decision moments from their recording (short code excerpts and build output) and their answers to the Anthropic API. Names are not sent.
- **No sign-in:** anyone who can reach the site can open the instructor pages and the export. Run it only on a trusted network, and stop it after the session.

## Known limitations

- **Small sample.** Five students cannot show a reliable difference between question types. Look for patterns and clear examples.
- **Scripted recordings are not evidence.** The recordings in `fixtures/recordings` were made by a script for testing, not by people. Never include them in the results.
- **The timer starts at upload.** Time spent waiting for questions to appear counts against the student's hour.
- **Terminal recording needs shell integration.** Commands typed in a terminal are only recorded with bash, zsh, fish or PowerShell and VS Code shell integration on. Other terminals show as "not recorded"; the student's builds are then missing from the recording, which affects process questions about failed builds.
- **Bulk inserted is not the same as pasted.** A large single edit can also be autocomplete, formatting or undo.
- **The reviewer is not a grader.** Its levels describe the answers. Decisions about students stay with the instructor.
