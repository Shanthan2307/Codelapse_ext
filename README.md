# CodeLapse

A VS Code extension that records the work done in one folder you choose, then replays it as a timelapse with session metrics.

Requires VS Code 1.93 or newer.

## Pilot study: quick start

CodeLapse is being tried with a small group of student testers. Students install the extension and record their work in VS Code; the instructor runs a small website on their laptop where students upload the recording, answer four short questions, and the instructor reviews the results.

### For students

You need VS Code 1.93 or newer and a C compiler (`gcc --version` in a terminal should print a version). The full guide, with troubleshooting, is [docs/TESTER_GUIDE.md](docs/TESTER_GUIDE.md).

1. **Install the extension.** Download `codelapse-0.1.0.vsix` from the [pilot release](https://github.com/Shanthan2307/Codelapse_ext/releases/tag/v0.1.0-pilot) (under **Assets**). In VS Code, open **Extensions**, click **`···`**, choose **Install from VSIX…** and pick the file. A short walkthrough opens.
2. **Choose your assignment folder.** Create an empty folder, open it in VS Code, and click **CodeLapse: Choose folder** in the status bar. Only this folder is recorded.
3. **Write and build your code as usual.** Write `reverse.c` and build it in the VS Code terminal (`gcc -Wall -o reverse reverse.c && ./reverse`). Your edits and builds are recorded on your computer.
4. **Export your recording.** Run **CodeLapse: Export Assignment Bundle** from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`). This saves a `.codelapse` file.
5. **Open the submission page.** Click **Open Submission Page** in the message that appears. The first time, VS Code asks for the address your instructor gives you; paste it in.
6. **Submit.** Pick your name, drop in the `.codelapse` file and `reverse.c`, and click **Submit Assignment**.
7. **Answer the four questions** on the page that opens. You have one hour from submitting, and you can submit your answers once.

Nothing leaves your computer until you upload it yourself in step 6.

### For the instructor

You need Node.js 20 or newer, and your laptop and the students' laptops on the same Wi-Fi. The full guide is [docs/RUNNING_THE_DEMO.md](docs/RUNNING_THE_DEMO.md); the study plan is [docs/RESEARCH_PILOT.md](docs/RESEARCH_PILOT.md).

**Once, before the session**

1. Install: `npm install`.
2. Add a Featherless API key to `apps/web/.env.local` (the AI runs on open-source models served by [Featherless](https://featherless.ai); see [Choosing the AI](#choosing-the-ai) for OpenAI or Claude instead):
   ```bash
   echo 'FEATHERLESS_API_KEY=rc_...' >> apps/web/.env.local && chmod 600 apps/web/.env.local
   ```
3. Put your testers' names in place of "Student A" to "Student E" in `apps/web/src/lib/course.ts`.
4. Try the whole flow yourself: start the site (next step), upload `fixtures/recordings/honest-incremental/honest-incremental.codelapse` with `fixtures/recordings/honest-incremental/submission/reverse.c`, and check that four questions appear within a minute. Then clear it with `npm run demo:reset`.

**On the day**

1. Start the site:
   ```bash
   npm run demo
   ```
   It builds the site, then prints the **submission page address** to give students (for example `http://192.168.1.23:3100/courses/cs101/assignments/a3-reverse`) and the **instructor password**. Write the address on the board.
2. Open the instructor view on your laptop at http://localhost:3100/instructor. Your browser asks for a user name (anything) and the password.
3. As students submit, each row shows their recording, the check that the recording ends at the submitted code, their questions and, once they answer, the AI's review of the answers.

**After the session**

1. Open each student's page and fill in **Your ratings**: whether you agree with each review, and whether each question was useful.
2. Use **Compare students** to see which submissions resemble each other more than usual.
3. Download the **Research export** (CSV) from the instructor view. Names are replaced by participant codes.
4. Stop the site with `Ctrl+C`. Back up `apps/web/data` (it holds the students' work), then run `npm run demo:reset` before the next session.

**If something goes wrong**

| Problem | What to do |
|---|---|
| Students can't open the address | Check that everyone is on the same Wi-Fi (guest networks often block this) and that your firewall allows incoming connections for Node.js. |
| Questions say they couldn't be prepared | The instructor page shows why. Usually the API key is missing, the account has no credit, or the plan's concurrency limit was reached; fix it or wait a minute, then click **Try again**. |
| A student's builds don't appear | Their VS Code terminal must be bash, zsh, fish or PowerShell. Building with **Terminal → Run Task** also works. |
| The address changed | It depends on the Wi-Fi. Restart `npm run demo` and use the address it prints. Students can change it under **Settings → CodeLapse: Submission Url**. |

## What it does

### Records one chosen folder
- Nothing is recorded until you pick a folder: an open workspace folder, any folder via **Browse**, or right-click a folder in the Explorer and choose **CodeLapse: Choose Folder to Record**.
- Files outside that folder are ignored, as are `.git` and `node_modules`.
- Paths are stored relative to the chosen folder (`src/main.c`), never as absolute paths.
- The choice is remembered per workspace, and reopening VS Code resumes recording that folder. The status bar shows what is being recorded. Switching folders saves the current session and starts a new one.

### Replay
- Snapshots are diffed against the previous version of the file and animated character by character.
- Idle gaps can be skipped, and playback supports scrubbing, snapshot stepping and speeds of 1x, 2x, 5x and 10x.
- Keyboard shortcuts: `Space` play/pause, `←` / `→` previous/next snapshot, `Home` / `End` jump to start/end.
- The cursor and selection are shown as recorded.

### File journey
- One row per file, with time running left to right. Each stretch of work in a file is a bar: solid if the file was changed, outlined if it was only read. A thin line marks each switch between files, so back-and-forth work shows as a zigzag.
- A summary line gives the number of files and switches, where most of the time went, and which two files the student went back and forth between most.
- It follows the replay: a playhead moves across and what hasn't happened yet is faded. Click a bar to jump there with the lines typed during that visit highlighted, step to the previous or next visit, or replay it.
- Switching to a file counts as a visit even if it was only read. Glances under 3 seconds are ignored.

### Metrics
Metrics are calculated from recorded edits:

| Metric | Meaning |
|---|---|
| Typed | Characters entered in small edits |
| Bulk inserted | Characters added in one large edit. This can be a paste, autocomplete, formatting or undo; the recording cannot tell these apart |
| Unclassified | Characters changed in recordings made before edits were classified. Shown only when there are some |
| Pre-existing | Characters already in a file when it was first seen in the session |
| Net lines | Final line count minus first line count, across files |

The activity chart splits the session into 24 equal time slices, and hovering over one shows a small diff.

### Runs
| Source | Result recorded |
|---|---|
| Tasks | Pass or fail from the exit code, recorded as one run with the task's output when shell integration is available |
| Terminal commands | Pass or fail from the exit code. Commands such as `cd` and `ls` are skipped. A terminal without shell integration cannot be recorded, so the report says so |
| Debug sessions | Unknown: VS Code does not report a result, so none is shown |

The pass rate counts only runs with a known result, and is not shown when there are none.

### Reports and data export
- **CodeLapse: Export Assignment Bundle (.codelapse)** writes one file holding every recorded session of the chosen folder, ready to upload with the code. See [The .codelapse bundle](#the-codelapse-bundle).
- **CodeLapse: Export Standalone HTML Report** writes one `.html` file with the replay and the recorded code embedded, so it opens in a browser without VS Code.
- **CodeLapse: Save Session Data to Folder** copies the sessions you choose into one new folder: the raw `.jsonl` log, the `.json` session file and an HTML report for each.

Reports and exports contain the full text of recorded files, so check them before sharing.

## How recording is stored

Sessions are saved in the extension's global storage in two forms:

- **`codelapse-<timestamp>.jsonl`:** an append-only log of keyframes, deltas, runs and events. A file's first capture is a keyframe with its full text, and another is written every 50 edits. Deltas in between hold only the changes.
- **`codelapse-<timestamp>.json`:** the whole session, rewritten to disk periodically with `JSON.stringify`.

While a session is recording, every snapshot is held in memory as full file text, so memory use and the `.json` file both grow with session length.

Recordings are plain text and are not signed or encrypted.

## The .codelapse bundle

A `.codelapse` file is gzip-compressed JSON, so no special tools are needed to read it. It holds:

- **Sessions:** the raw `.jsonl` log of every session recorded in the folder, each with a SHA-256 hash.
- **Files:** the path, size and SHA-256 hash of every file in the folder at export, so a server can compare them with the submitted code.
- **Folder key:** a salted hash that groups one folder's sessions on one computer without revealing the folder's path or the username.

The hashes catch damaged or partly edited files. They do not prove that a recording is genuine, because anyone can recompute them. Sessions recorded before folder keys existed are matched by folder name.

## Getting started

Prerequisites: Node.js 20 or newer, and VS Code 1.93 or newer.

```bash
git clone https://github.com/Shanthan2307/Codelapse_ext.git
cd Codelapse_ext
npm install
npm run compile
```

Then open the folder in VS Code, press `F5` and, in the Extension Development Host window, click **CodeLapse: Choose folder** in the status bar.

### Commands
- **CodeLapse: Choose Folder to Record**
- **CodeLapse: Start Recording Session**
- **CodeLapse: Stop Recording Session** (opens the report)
- **CodeLapse: Show Session Report & Analytics**
- **CodeLapse: Export Standalone HTML Report**
- **CodeLapse: Export Assignment Bundle (.codelapse)**
- **CodeLapse: Save Session Data to Folder**

### Development

```bash
npm run lint               # ESLint
npm run typecheck          # TypeScript, no output
npm test                   # Unit tests
npm run test:integration   # End-to-end tests in a real VS Code window
npm run package            # Build the .vsix
```

## Analysis

`@codelapse/core` analyses a student's recording without any AI:

- **Replay check:** compares the final recorded state of each file with the submitted code. Each file is reported as matching, differing only in whitespace, differing (with the first different line), never recorded, or recorded but not submitted. For each file it also gives how much was typed, bulk inserted or already there.
- **Decision moments:** picks up to 40 moments worth asking about: a fix after a failed build, repeated failed builds, a bulk insert, a rewrite, removed code with nothing in its place, and when each C function was first written. Each moment has a stable ID, a plain summary and short before and after excerpts.

Neither says anyone cheated. They describe what the recording shows, for an instructor to judge.

`fixtures/recordings` holds scripted recordings of a small C assignment, made by driving the real extension (see its README). They are for testing, not evidence of how students work. Regenerate them with `npm run fixtures`.

## Demo submission site

`apps/web` is a small course website for the research demo, styled like a learning management system but not connected to one. Students pick who they are from a demo list, then upload their `.codelapse` file with their code. The server checks the upload with `@codelapse/core` and stores it.

```bash
npm run web:dev        # http://localhost:3100
```

| Page | For | Shows |
|---|---|---|
| `/courses/cs101/assignments/a3-reverse` | Students | The assignment and the submission form |
| `/submissions/<id>` | The student | Confirmation and the four feedback questions, with the time left to answer |
| `/instructor` | Instructors | Each student's latest submission: recording summary and replay check |
| `/instructor/submissions/<id>` | Instructors | Per-file replay check, the questions with why each was asked, the answers and their review, the code and the decision moments |

The course, assignment and the five demo students are defined in `apps/web/src/lib/course.ts`. Submissions are saved as plain files in `apps/web/data` (or `CODELAPSE_DATA_DIR`), which git ignores because it holds student code. Students have no sign-in. Set `CODELAPSE_INSTRUCTOR_PASSWORD` (`npm run demo` creates one) to put the instructor pages, comparison, ratings and research export behind a password; without it they are open to anyone who can reach the site.

`npm run web:build && npm run web:smoke` builds the site and submits the scripted recordings as all five students to check every page.

- **Running a session with testers:** [docs/RUNNING_THE_DEMO.md](docs/RUNNING_THE_DEMO.md). `npm run demo` starts the site for other computers on your network and prints the address testers need; `npm run demo:reset` moves old submissions aside.
- **Steps for student testers:** [docs/TESTER_GUIDE.md](docs/TESTER_GUIDE.md).

### Feedback questions

After an upload, the server asks a language model (see [Choosing the AI](#choosing-the-ai)) to write four questions for that student: two about decisions in their recording (each citing one decision moment) and two about specific lines of their code. The student's submission page shows them with a countdown. Answers can be sent once, and only within one hour of uploading.

- **Credentials:** without a working key, the questions are marked as failed with the reason, and the instructor page has a **Try again** button.
- **Checks on the questions:** the server rejects questions that cite a moment or lines that don't exist, repeat each other, or break the two-and-two mix, and asks once more with the problems listed.
- **Prompt injection:** the student's code and the recording go into clearly marked sections that the prompt says are material, never instructions. Text in the code that addresses an AI or grader is listed for the instructor, and the model can note it too.
- **Shared record:** each submission's `questions.json` holds the questions plus, for the instructor and the future answer evaluator only, why each was asked and what a strong answer might mention. It also keeps every prompt and reply, for research and for training a local model later. Students never see these parts.

### Answer review

When a student submits their answers, a second request to the same model reviews them for the instructor. It reads each answer next to the question, the question writer's reasons and hints from `questions.json` (as hypotheses, not an answer key), the code or recording evidence the question is about, and the full code. For each answer it gives:

- three scores from 0 to 3: **specificity** (refers to concrete details of this code), **consistency** (fits what the code and recording show) and **reasoning** (explains why, correctly)
- a level from the total: **strong** (7–9), **partial** (4–6) or **limited** (0–3, or if the answer doesn't address the question)
- short quotes from the answer that support the scores, which the server checks appear word for word
- a short explanation and any specific concerns, such as an answer naming a different build error from the one in the recording

It is told to judge understanding, not writing, and not to speculate about AI use or copying. Students never see the review. It is stored in each submission's `evaluation.json`, with every prompt and reply. The evaluator goes through its own `EvaluatorModel` interface (`apps/web/src/lib/evaluation/model.ts`), so it can be swapped the same way as the question writer.

### Comparing students

`/instructor/compare` puts every pair of students side by side on three kinds of evidence:

- **Code:** token fingerprints of the submitted code, compared both exactly and with names, numbers and strings ignored, so renamed variables don't hide a match. Shared starter code can be excluded.
- **Blocks inserted in one edit:** the same block (or the same structure with names changed) appearing in both recordings.
- **Answer wording:** answers to different questions that share long phrases.

Pairs are ranked by how many of these agree, then by strength. Each signal is compared with the class median, and only called above typical when it clearly stands out (this needs at least four pairs). The pair page shows the two submissions with matching code lines marked, the inserted blocks and the answers with shared wording highlighted. Everyone works on the same assignment, so some similarity is expected; the page says so and leaves the judgement to the instructor.

### Watching a replay

Each instructor detail page has **Watch replay**, and every decision moment and process question has **Watch this moment**, which opens the student's recording a few seconds before it. The player is the same one the VS Code extension uses (`packages/replay`).

### Research pilot

For the five-tester pilot, the instructor detail page has a **Your ratings** card: agree or disagree with each review, give your own level, mark useful questions and add notes. The instructor list has a **Research export** card with CSV and JSON downloads, in which names are replaced by participant codes and answer text is left out unless asked for. [docs/RESEARCH_PILOT.md](docs/RESEARCH_PILOT.md) has the session plan, what each column means and how to compare process and code questions.

**Research database:** `npm run research:db` builds one SQLite file in `research/` with everything from the pilot: assignments, recordings and code, replay checks, decision moments, questions, answers, AI reviews, your ratings, and every AI request and reply. Students appear as participant codes unless you add `--names`; add `--include-archives` to include earlier runs. Open it with DB Browser for SQLite, Python or R. The tables are described in [docs/RESEARCH_PILOT.md](docs/RESEARCH_PILOT.md#the-research-database). The file holds student code and answers, so keep it private.

### Choosing the AI

The question writer and the answer reviewer use the same provider, set in `apps/web/.env.local`:

| Provider | Key | Default model | Change the model with |
|---|---|---|---|
| **Featherless** (open-source models) | `FEATHERLESS_API_KEY` | questions: `deepseek-ai/DeepSeek-V3-0324`; review: `openai/gpt-oss-120b` | `CODELAPSE_FEATHERLESS_MODEL`, `CODELAPSE_FEATHERLESS_REVIEW_MODEL` |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-5.5` | `CODELAPSE_OPENAI_MODEL` |
| **Anthropic** (Claude) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `CODELAPSE_QUESTION_MODEL`, `CODELAPSE_EVALUATOR_MODEL` |

`CODELAPSE_AI_PROVIDER=featherless` (or `openai`, `anthropic`) picks one. Without it, the first provider with a key is used, in the order above. The site needs a restart after changing these.

Every provider returns JSON in the same shape, and the site checks every reply the same way: questions must cite real moments and lines, review quotes must appear in the answer, and a malformed reply is retried. Featherless does not always enforce the requested JSON shape, so its replies are parsed and checked by the site, with one extra try. DeepSeek V3 writes the questions there because it followed the shape reliably in testing. The review uses a different model, gpt-oss-120b, so no model marks its own questions: in testing, DeepSeek V3 rated a confidently wrong answer as strong, while gpt-oss-120b caught the mistake.

**Guards against made-up content.** The site rejects, and asks again for, any question that cites a moment or code lines that don't exist, mentions a function or variable that appears nowhere in the student's code or recording, or mentions a time later than the whole recording. Any review quote must appear word for word in the student's answer, and a "strong" review must quote the parts of the answer that support it. The reviewer is told to check every claim in an answer against the code, so a confident but wrong answer scores low.

To add another provider, such as a model served locally with Ollama or vLLM, write classes that implement `QuestionModel` (`apps/web/src/lib/questions/model.ts`) and `EvaluatorModel` (`apps/web/src/lib/evaluation/model.ts`), and return them from `createQuestionModel()` and `createEvaluatorModel()`. Servers with an OpenAI-compatible API can reuse the Featherless code with a different address. Compare a new model with the current one on the same submissions before relying on it; the prompts and replies stored in each `questions.json` and `evaluation.json` are a starting dataset for that.

## Repository structure

The extension is at the repository root. Logic shared by the extension and the submission site lives in `packages/core`, and the site is `apps/web`. Both are npm workspace packages.

```
packages/core/                   # @codelapse/core: shared, no VS Code dependency
├── src/
│   ├── models.ts                # Session data types
│   ├── deltaEngine.ts           # Keyframes, deltas, reconstruction, edit stats
│   ├── analytics.ts             # Session metrics and activity buckets
│   ├── sessionLog.ts            # Rebuilds a session from its .jsonl log
│   ├── replayCheck.ts           # Does the recording end at the submitted code?
│   ├── similarity.ts            # Code, inserted-block and answer similarity
│   ├── moments.ts               # Decision moments for questions to cite
│   ├── cFunctions.ts            # Finds C function definitions
│   └── bundleFormat.ts          # The .codelapse format (Node only)
├── node.ts                      # Node-only entry point: @codelapse/core/node
└── test/                        # Includes tests on the scripted recordings
fixtures/recordings/             # Scripted C recordings made with the real extension
packages/replay/                 # @codelapse/replay: the replay player, shared by the extension and the site
apps/web/                        # Demo submission site (Next.js)
├── src/lib/                     # Course data, upload processing, file storage
├── src/lib/questions/           # Question prompt, model, validation, answers
├── src/lib/evaluation/          # Answer review prompt, model, validation
├── src/lib/cohort.ts            # Comparing students
├── src/lib/research/            # Instructor ratings, research export, participant codes
├── src/app/                     # Pages and the upload API
├── test/                        # Upload processing tests
└── scripts/smoke.mjs            # End-to-end check of the built site
src/                             # The VS Code extension
├── events/
│   ├── EventMonitor.ts          # Tasks, debug sessions, terminal runs, idle detection
│   └── terminalRuns.ts          # Terminal command filtering and output clean-up
├── export/
│   ├── BundleExporter.ts        # .codelapse assignment bundle
│   ├── ReportExporter.ts        # Standalone HTML report
│   ├── SubmissionExporter.ts    # Save session data to a folder
│   └── htmlSafety.ts            # Safe embedding of recorded code in HTML
├── storage/LogStreamer.ts       # Append-only .jsonl log
├── tracker/
│   ├── DocumentTracker.ts       # Editor change, selection and focus capture
│   ├── RecordingScope.ts        # Chosen folder: picker, persistence, filtering, folder key
│   ├── SessionManager.ts        # Session lifecycle and persistence
│   └── folderScope.ts           # Path containment and relative paths
├── ui/
│   ├── App.tsx                  # Report shell
│   ├── components/              # Metrics, activity chart, player, file journey
│   ├── flow/FileFlowModel.ts    # Visits, moves and edges
│   ├── playback/PlaybackModel.ts # Typing interpolation and timeline
│   └── styles.css
├── webview/
│   ├── ReportPanel.ts           # Webview panel and message handling
│   └── index.tsx                # React entry point
├── test/                        # Unit tests (suite/) and VS Code tests (integration/)
└── extension.ts                 # Activation and commands
```

## Project direction

CodeLapse is part of a research project on whether students understand the code they submit. C is the first language being studied. All phases of the first plan are built. What remains is running the pilot and learning from it.

## License

[MIT](./LICENSE) © Shanthan & CodeLapse Contributors
