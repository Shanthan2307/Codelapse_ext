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
- **CodeLapse: Export Standalone HTML Report** writes one `.html` file with the replay and the recorded code embedded, so it opens in a browser without VS Code.
- **CodeLapse: Save Session Data to Folder** copies the sessions you choose into one new folder: the raw `.jsonl` log, the `.json` session file and an HTML report for each.

Reports and exports contain the full text of recorded files, so check them before sharing.

## How recording is stored

Sessions are saved in the extension's global storage in two forms:

- **`codelapse-<timestamp>.jsonl`:** an append-only log of keyframes, deltas, runs and events. A file's first capture is a keyframe with its full text, and another is written every 50 edits. Deltas in between hold only the changes.
- **`codelapse-<timestamp>.json`:** the whole session, rewritten to disk periodically with `JSON.stringify`.

While a session is recording, every snapshot is held in memory as full file text, so memory use and the `.json` file both grow with session length.

Recordings are plain text and are not signed or encrypted.

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
- **CodeLapse: Open Session Replay & Analytics**
- **CodeLapse: Export Standalone HTML Report**
- **CodeLapse: Save Session Data to Folder**

### Development

```bash
npm run lint               # ESLint
npm run typecheck          # TypeScript, no output
npm test                   # Unit tests
npm run test:integration   # End-to-end tests in a real VS Code window
```

## Repository structure

```
src/
├── analytics/engine.ts          # Session metrics and activity buckets
├── events/
│   ├── EventMonitor.ts          # Tasks, debug sessions, terminal runs, idle detection
│   └── terminalRuns.ts          # Terminal command filtering and output clean-up
├── export/
│   ├── ReportExporter.ts        # Standalone HTML report
│   ├── SubmissionExporter.ts    # Save session data to a folder
│   └── htmlSafety.ts            # Safe embedding of recorded code in HTML
├── storage/LogStreamer.ts       # Append-only .jsonl log
├── tracker/
│   ├── DeltaEngine.ts           # Keyframes, deltas and reconstruction
│   ├── DocumentTracker.ts       # Editor change, selection and focus capture
│   ├── RecordingScope.ts        # Chosen folder: picker, persistence, filtering
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
├── extension.ts                 # Activation and commands
└── models.ts                    # Session data types
```

## Project direction

CodeLapse is part of a research project on whether students understand the code they submit. C is the first language being studied. This repository currently contains only the recorder and report described above.

## License

[MIT](./LICENSE) © Shanthan & CodeLapse Contributors
