import * as fs from 'fs';
import * as path from 'path';
import { Session, Snapshot, RunEvent, SessionEvent } from '../src/models';
import { computeSessionAnalytics } from '../src/analytics/engine';
import { SessionSummarizer } from '../src/ai/SessionSummarizer';

// Generates a realistic, highly detailed multi-file coding session of a developer building
// a full-stack React + Node.js TypeScript application from scratch.
export function createRealisticFullStackSession(): Session {
  const startTime = Date.now() - 45 * 60 * 1000; // 45 minutes ago
  let currentTime = 0; // ms offset

  const snapshots: Snapshot[] = [];
  const runs: RunEvent[] = [];
  const events: SessionEvent[] = [];

  events.push({
    type: 'start',
    timestamp: 0,
    detail: 'Session started in workspace: FullStack-TaskMaster (React + Node + TS)'
  });

  // Step 1: Backend Type Definitions (server/src/types.ts)
  currentTime += 15000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'server/src/types.ts',
    content: `export interface Task {\n  id: string;\n  title: string;\n  completed: boolean;\n  createdAt: number;\n}`,
    cursorStart: 95,
    cursorEnd: 95
  });

  // Step 2: Backend Express Server Init (server/src/index.ts)
  currentTime += 25000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'server/src/index.ts',
    content: `import express from 'express';\nimport cors from 'cors';\n\nconst app = express();\nconst PORT = 5000;\n\napp.use(cors());\napp.use(express.json());\n`,
    cursorStart: 130,
    cursorEnd: 130
  });

  // Step 3: Install Packages Event
  currentTime += 10000;
  events.push({
    type: 'event' as any,
    timestamp: currentTime,
    detail: '📦 [Node/NPM] Installed 14 packages (express, cors, ts-node-dev)'
  });

  // Step 4: Backend Routes & In-Memory Store (server/src/index.ts)
  currentTime += 35000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'server/src/index.ts',
    content: `import express from 'express';\nimport cors from 'cors';\nimport { Task } from './types';\n\nconst app = express();\nconst PORT = 5000;\n\napp.use(cors());\napp.use(express.json());\n\nconst tasks: Task[] = [\n  { id: '1', title: 'Setup project scaffolding', completed: true, createdAt: Date.now() }\n];\n\napp.get('/api/tasks', (req, res) => {\n  res.json(tasks);\n});\n`,
    cursorStart: 320,
    cursorEnd: 320
  });

  // Step 5: Node Server Starts listening
  currentTime += 15000;
  events.push({
    type: 'run-pass',
    timestamp: currentTime,
    detail: '🚀 [Node Server] Listening on port :5000'
  });

  // Step 6: Add POST Route (server/src/index.ts)
  currentTime += 40000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'server/src/index.ts',
    content: `import express from 'express';\nimport cors from 'cors';\nimport { Task } from './types';\n\nconst app = express();\nconst PORT = 5000;\n\napp.use(cors());\napp.use(express.json());\n\nconst tasks: Task[] = [\n  { id: '1', title: 'Setup project scaffolding', completed: true, createdAt: Date.now() }\n];\n\napp.get('/api/tasks', (req, res) => {\n  res.json(tasks);\n});\n\napp.post('/api/tasks', (req, res) => {\n  const { title } = req.body;\n  if (!title) return res.status(400).json({ error: 'Title required' });\n  const newTask: Task = {\n    id: String(tasks.length + 1),\n    title,\n    completed: false,\n    createdAt: Date.now()\n  };\n  tasks.push(newTask);\n  res.status(201).json(newTask);\n});\n\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n`,
    cursorStart: 710,
    cursorEnd: 710
  });

  // Step 7: Run backend API test (Fails initially due to missing DELETE endpoint)
  currentTime += 20000;
  runs.push({
    timestamp: currentTime,
    command: 'npm run test:api',
    output: 'FAIL server/src/tasks.test.ts\n✕ DELETE /api/tasks/:id should remove task (404 Not Found)\nTests: 2 passed, 1 failed, 3 total',
    success: false,
    durationMs: 1400
  });
  events.push({
    type: 'run-fail',
    timestamp: currentTime,
    detail: 'API test failed: DELETE /api/tasks/:id returned 404'
  });

  // Step 8: Fix backend by implementing DELETE route
  currentTime += 30000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'server/src/index.ts',
    content: `import express from 'express';\nimport cors from 'cors';\nimport { Task } from './types';\n\nconst app = express();\nconst PORT = 5000;\n\napp.use(cors());\napp.use(express.json());\n\nlet tasks: Task[] = [\n  { id: '1', title: 'Setup project scaffolding', completed: true, createdAt: Date.now() }\n];\n\napp.get('/api/tasks', (req, res) => {\n  res.json(tasks);\n});\n\napp.post('/api/tasks', (req, res) => {\n  const { title } = req.body;\n  if (!title) return res.status(400).json({ error: 'Title required' });\n  const newTask: Task = {\n    id: String(tasks.length + 1),\n    title,\n    completed: false,\n    createdAt: Date.now()\n  };\n  tasks.push(newTask);\n  res.status(201).json(newTask);\n});\n\napp.delete('/api/tasks/:id', (req, res) => {\n  const { id } = req.params;\n  tasks = tasks.filter(t => t.id !== id);\n  res.status(204).send();\n});\n\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n`,
    cursorStart: 840,
    cursorEnd: 840
  });

  // Step 9: Re-run API tests -> PASS!
  currentTime += 15000;
  runs.push({
    timestamp: currentTime,
    command: 'npm run test:api',
    output: 'PASS server/src/tasks.test.ts\n✓ GET /api/tasks (12ms)\n✓ POST /api/tasks (18ms)\n✓ DELETE /api/tasks/:id (9ms)\nTests: 3 passed, 3 total\nTime: 1.1s',
    success: true,
    durationMs: 1100
  });
  events.push({
    type: 'run-pass',
    timestamp: currentTime,
    detail: 'API test suite passed (3/3 tests)'
  });

  // Step 10: Switch to React Frontend - client/src/types.ts
  currentTime += 25000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'client/src/types.ts',
    content: `export interface Task {\n  id: string;\n  title: string;\n  completed: boolean;\n  createdAt: number;\n}\n`,
    cursorStart: 95,
    cursorEnd: 95
  });

  // Step 11: Build React TaskCard Component (client/src/components/TaskCard.tsx)
  currentTime += 35000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'client/src/components/TaskCard.tsx',
    content: `import React from 'react';\nimport { Task } from '../types';\n\ninterface TaskCardProps {\n  task: Task;\n  onToggle: (id: string) => void;\n  onDelete: (id: string) => void;\n}\n\nexport const TaskCard: React.FC<TaskCardProps> = ({ task, onToggle, onDelete }) => {\n  return (\n    <div className={\`task-card \${task.completed ? 'completed' : ''}\`}>\n      <input\n        type="checkbox"\n        checked={task.completed}\n        onChange={() => onToggle(task.id)}\n      />\n      <span className="task-title">{task.title}</span>\n      <button className="btn-delete" onClick={() => onDelete(task.id)}>\n        ✕\n      </button>\n    </div>\n  );\n};\n`,
    cursorStart: 420,
    cursorEnd: 420
  });

  // Step 12: Build Main React App UI with State & Fetching (client/src/App.tsx)
  currentTime += 45000;
  snapshots.push({
    timestamp: currentTime,
    filePath: 'client/src/App.tsx',
    content: `import React, { useState, useEffect } from 'react';\nimport { Task } from './types';\nimport { TaskCard } from './components/TaskCard';\n\nexport const App: React.FC = () => {\n  const [tasks, setTasks] = useState<Task[]>([]);\n  const [inputTitle, setInputTitle] = useState('');\n  const [loading, setLoading] = useState(true);\n\n  useEffect(() => {\n    fetch('http://localhost:5000/api/tasks')\n      .then(res => res.json())\n      .then(data => {\n        setTasks(data);\n        setLoading(false);\n      });\n  }, []);\n\n  const handleAddTask = async (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!inputTitle.trim()) return;\n    const res = await fetch('http://localhost:5000/api/tasks', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ title: inputTitle })\n    });\n    const newTask = await res.json();\n    setTasks(prev => [...prev, newTask]);\n    setInputTitle('');\n  };\n\n  const handleDeleteTask = async (id: string) => {\n    await fetch(\`http://localhost:5000/api/tasks/\${id}\`, { method: 'DELETE' });\n    setTasks(prev => prev.filter(t => t.id !== id));\n  };\n\n  const handleToggle = (id: string) => {\n    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));\n  };\n\n  return (\n    <div className="app-container">\n      <header className="app-header">\n        <h1>🚀 TaskMaster Pro</h1>\n        <p>Full-Stack React + Node.js Application</p>\n      </header>\n\n      <form onSubmit={handleAddTask} className="task-form">\n        <input\n          type="text"\n          placeholder="Enter a new task..."\n          value={inputTitle}\n          onChange={(e) => setInputTitle(e.target.value)}\n        />\n        <button type="submit">Add Task</button>\n      </form>\n\n      {loading ? (\n        <p>Loading tasks...</p>\n      ) : (\n        <div className="task-list">\n          {tasks.map(task => (\n            <TaskCard\n              key={task.id}\n              task={task}\n              onToggle={handleToggle}\n              onDelete={handleDeleteTask}\n            />\n          ))}\n        </div>\n      )}\n    </div>\n  );\n};\n`,
    cursorStart: 1200,
    cursorEnd: 1200
  });

  // Step 13: Vite HMR Event Triggered
  currentTime += 10000;
  events.push({
    type: 'event' as any,
    timestamp: currentTime,
    filePath: 'client/src/App.tsx',
    detail: '⚛️ [React/Vite] HMR updated: client/src/App.tsx (22ms)'
  });

  // Step 14: End-to-End Test Suite Run -> PASS!
  currentTime += 20000;
  runs.push({
    timestamp: currentTime,
    command: 'npm run test:e2e',
    output: 'PASS client/src/App.test.tsx\n✓ renders task dashboard correctly (45ms)\n✓ adds new task and communicates with backend (65ms)\n✓ deletes task upon click (30ms)\n\nTest Suites: 2 passed, 2 total\nTests: 6 passed, 6 total\nSnapshots: 0 total\nTime: 2.34s',
    success: true,
    durationMs: 2340
  });
  events.push({
    type: 'run-pass',
    timestamp: currentTime,
    detail: 'Full-stack test suite passed (6/6 tests)'
  });

  currentTime += 10000;
  events.push({
    type: 'end',
    timestamp: currentTime,
    detail: 'Session ended. Full-stack MVP completed and verified.'
  });

  return {
    id: 'demo-fullstack-showcase',
    workspaceName: 'FullStack-TaskMaster (React + Node.js + TS)',
    startTime,
    endTime: startTime + currentTime,
    snapshots,
    runs,
    events
  };
}

// Generate the standalone HTML file
export function exportShowcaseFile(outputPath: string): void {
  const session = createRealisticFullStackSession();
  const analytics = computeSessionAnalytics(session);
  const aiSummary = SessionSummarizer.generateSummary(session);

  const webviewJsPath = path.resolve(__dirname, '../dist/webview.js');
  let webviewJsText = '';
  if (fs.existsSync(webviewJsPath)) {
    webviewJsText = fs.readFileSync(webviewJsPath, 'utf-8');
  }

  const initialPayload = JSON.stringify({
    session,
    analytics,
    aiSummary,
    isRecording: false,
    isPaused: false
  });

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeLapse Replay: ${session.workspaceName}</title>
  <style>
    /* Dark Theme Default for Standalone Web Export */
    :root {
      --vscode-editor-background: #1e1e1e;
      --vscode-editor-foreground: #d4d4d4;
      --vscode-sideBar-background: #252526;
      --vscode-editorWidget-background: #2d2d2d;
      --vscode-list-hoverBackground: #37373d;
      --vscode-widget-border: #3c3c3c;
      --vscode-panel-border: #3c3c3c;
      --vscode-button-background: #0e639c;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-button-foreground: #ffffff;
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-descriptionForeground: #9d9d9d;
      --vscode-gitDecoration-addedResourceForeground: #4ec9b0;
      --vscode-errorForeground: #f14c4c;
      --vscode-editorWarning-foreground: #cca700;
      --vscode-diffEditor-insertedTextBackground: rgba(46, 160, 67, 0.25);
      --vscode-diffEditor-removedTextBackground: rgba(248, 81, 73, 0.25);
      --vscode-editorCursor-foreground: #007acc;
      --vscode-editor-selectionBackground: rgba(38, 79, 120, 0.7);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Embedded standalone session dataset
    window.__CODELAPSE_STANDALONE_DATA__ = ${initialPayload};
  </script>
  <script>
    ${webviewJsText}
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, htmlContent, 'utf-8');
  console.log(`✅ Showcase standalone report generated at: ${outputPath}`);
}

if (require.main === module) {
  const target = path.resolve(__dirname, '../demo_showcase_report.html');
  exportShowcaseFile(target);
}
