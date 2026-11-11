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

- **Consent.** Record each student's consent outside CodeLapse (a signed form or an email). The site has no consent step. Students agreed to their code being sent to Claude (Anthropic). The site now uses Featherless by default, a different company, so ask them to agree to that provider too, and name it in the consent text.
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

## The research database

The site keeps each submission as files in `apps/web/data/submissions/<id>/`. For analysis, one command gathers all of it into a single SQLite database file:

```bash
npm run research:db
```

This writes `research/codelapse-research-<date>.sqlite` (git ignores `research/`). Open it with [DB Browser for SQLite](https://sqlitebrowser.org), Python (`sqlite3`, pandas), R (`RSQLite`) or the `sqlite3` command. Rebuild it any time; it is a snapshot and never changes the site's data.

| Option | Effect |
|---|---|
| `--out <file>` | Write somewhere else. |
| `--include-archives` | Also read earlier runs kept by `npm run demo:reset` (`apps/web/data-archive-*`). Each submission records which run it came from. |
| `--names` | Include student names. Without it, students appear only as participant codes, the same ones as in the CSV export. |

Example: `npm run research:db -- --include-archives --out research/pilot.sqlite`

The file holds students' code and answers even without names, so keep it private and share it only as your consent terms allow.

### Tables

Times are ISO 8601 (UTC) unless the column ends in `_ms`. Every table except `meta`, `assignments` and `participants` is keyed by `submission_id`.

| Table | One row per | Columns |
|---|---|---|
| `meta` | setting | `key`, `value`: `schema_version`, `created_at`, `source_runs`, `salt_source` (where the participant-code salt came from; never the salt), `includes_names`, `app_version`, `participant_ids` (how codes are made) |
| `assignments` | assignment | `id`, `course_id`, `title`, `language` (`c` or `python`), `description`, `points`, `due_at` |
| `participants` | student | `participant_id` (P + 8 hex digits), `name` (only with `--names`, otherwise empty) |
| `submissions` | submission | `submission_id`, `participant_id`, `assignment_id`, `submitted_at`, `questions_close_at`, `source_run` (`current` or the archive folder), `replay_verdict` (`consistent`/`inconsistent`), `session_count`, `recorded_ms`, `typed_chars`, `bulk_inserted_chars`, `pre_existing_chars`, `runs_passed`, `runs_failed`, `runs_unknown`, `extension_version`, `bundle_sha256` |
| `recordings` | submission | `submission_id`, `bundle`: the uploaded `.codelapse` file itself, so nothing is lost |
| `files` | submitted file | `submission_id`, `name`, `recorded_path` (its path in the recording), `size`, `sha256`, `content` (the code) |
| `replay_checks` | file checked | `submission_id`, `path`, `status` (`match`, `whitespace-only`, `differs`, `not-recorded`, `not-submitted`), `reason`, `typed_chars`, `bulk_inserted_chars`, `pre_existing_chars` |
| `sessions` | recorded session | `submission_id`, `session_id`, `started_at`, `ended_at`, `snapshots`, `runs` |
| `runs` | build or run | `submission_id`, `session_id`, `at_ms` (time into the session), `command`, `success` (1, 0, or empty when unknown), `duration_ms`, `output` |
| `moments` | decision moment | `submission_id`, `moment_id`, `kind`, `session_id`, `at_ms`, `file`, `function_name`, `summary`, `before`, `after` (code excerpts), `score` |
| `question_sets` | submission with questions | `submission_id`, `status` (`pending`/`ready`/`failed`), `error`, `provider`, `model`, `prompt_version`, `started_at`, `finished_at`, `notes_for_instructor` |
| `questions` | question | `submission_id`, `question_id`, `position` (1–4), `type` (`process`/`code`), `concept`, `text`, `moment_id` (process questions), `code_file`, `code_start`, `code_end` (code questions), `rationale` and `strong_answer_points` (JSON list) from the question writer, `generator_provider`, `generator_model`, `prompt_version` |
| `answers` | answer | `submission_id`, `question_id`, `text`, `chars`, `words`, `submitted_at` |
| `review_summaries` | reviewed submission | `submission_id`, `status`, `summary`, `notes`, `error`, `strong`, `partial`, `limited` (answer counts) |
| `reviews` | reviewed answer | `submission_id`, `question_id`, `addresses_question` (1/0), `specificity`, `consistency`, `reasoning` (0–3 each), `total` (0–9), `level` (`strong`/`partial`/`limited`), `evidence_quotes` and `concerns` (JSON lists), `explanation`, `reviewer_provider`, `reviewer_model`, `prompt_version` |
| `instructor_ratings` | rated question | `submission_id`, `question_id`, `agreement` (`agree`/`too-high`/`too-low`), `own_level`, `answer_note`, `question_useful` (1, 0 or empty), `question_note` |
| `instructor_overall` | rated submission | `submission_id`, `note`, `follow_up` (1/0), `updated_at` |
| `ai_calls` | AI request | `submission_id`, `role` (`questions`/`review`), `attempt`, `at`, `provider`, `model`, `system_prompt`, `user_prompt`, `output` (JSON reply), `validation_errors` (JSON list), `input_tokens`, `output_tokens`: the dataset for comparing or fine-tuning models |
| `injection_signals` | flagged line | `submission_id`, `source` (`code`/`answers`), `file`, `line`, `text`: text that addressed an AI or grader |

### Views

| View | Shows |
|---|---|
| `v_answer_reviews` | Each question with its answer, the review's scores and level, and your rating, side by side. |
| `v_process_vs_code` | For process and code questions: reviewed answers, average total score, strong/partial/limited counts, and how many you marked useful (Table 1 above). |
| `v_reviewer_agreement` | Review level against your own level and agreement, with counts (Table 2 above). |

For example, `SELECT * FROM v_process_vs_code;` answers the first research question directly.

## Data handling

- **Where data lives:** everything is in `apps/web/data` on the machine running the site (or `CODELAPSE_DATA_DIR`): the uploaded code, recordings, questions, answers, reviews and your ratings. Git ignores this folder.
- **Pseudonymisation:** exports use participant codes made from a salted hash of each student id. The salt is `CODELAPSE_RESEARCH_SALT` if set, otherwise a random value saved in `research-salt.txt` in the data folder on the first export. Anyone with that salt and the class list can recompute the codes, so keep the file private and don't share it with the exports. Exports never contain names, student ids or code; answer text only when asked for.
- **Deleting:** `npm run demo:reset` moves the data into `apps/web/data-archive-<date-time>`. Delete that folder yourself when the data is no longer needed under your consent terms.
- **Data sent to the AI provider:** to write questions and review answers, the site sends each student's code, the decision moments from their recording (short code excerpts and build output) and their answers to the configured provider (Featherless by default; see **Choosing the AI** in the README). Names are not sent. Mention the provider in your consent form.
- **Instructor password:** the instructor pages and the export are behind the instructor password that `npm run demo` prints. Students have no sign-in, so run the site only on a trusted network, and stop it after the session.

## Known limitations

- **Small sample.** Five students cannot show a reliable difference between question types. Look for patterns and clear examples.
- **Scripted recordings are not evidence.** The recordings in `fixtures/recordings` were made by a script for testing, not by people. Never include them in the results.
- **The timer starts at upload.** Time spent waiting for questions to appear counts against the student's hour.
- **Terminal recording needs shell integration.** Commands typed in a terminal are only recorded with bash, zsh, fish or PowerShell and VS Code shell integration on. Other terminals show as "not recorded"; the student's builds are then missing from the recording, which affects process questions about failed builds.
- **Bulk inserted is not the same as pasted.** A large single edit can also be autocomplete, formatting or undo.
- **The reviewer is not a grader.** Its levels describe the answers. Decisions about students stay with the instructor.
