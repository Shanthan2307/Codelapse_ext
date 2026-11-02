# CodeLapse

A VS Code extension that records the work done in one folder you choose, then replays it as a timelapse with session metrics.

Requires VS Code 1.93 or newer.

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

### File navigation graph
- Shows files grouped by top-level folder, with an arrow for each move between files. Thicker arrows were taken more often.
- Arrows appear in sync with the replay. Click one to list each time that move happened, then jump to it or replay that visit.
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

## Repository structure

The extension is at the repository root. Logic that the extension and the future submission server share lives in `packages/core`, an npm workspace package.

```
packages/core/                   # @codelapse/core: shared, no VS Code dependency
├── src/
│   ├── models.ts                # Session data types
│   ├── deltaEngine.ts           # Keyframes, deltas, reconstruction, edit stats
│   ├── analytics.ts             # Session metrics and activity buckets
│   ├── sessionLog.ts            # Rebuilds a session from its .jsonl log
│   ├── replayCheck.ts           # Does the recording end at the submitted code?
│   ├── moments.ts               # Decision moments for questions to cite
│   ├── cFunctions.ts            # Finds C function definitions
│   └── bundleFormat.ts          # The .codelapse format (Node only)
├── node.ts                      # Node-only entry point: @codelapse/core/node
└── test/                        # Includes tests on the scripted recordings
fixtures/recordings/             # Scripted C recordings made with the real extension
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
│   ├── components/              # Metrics, activity chart, player, navigation graph
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

CodeLapse is part of a research project on whether students understand the code they submit. C is the first language being studied. This repository currently contains only the recorder and report described above.

## License

[MIT](./LICENSE) © Shanthan & CodeLapse Contributors
