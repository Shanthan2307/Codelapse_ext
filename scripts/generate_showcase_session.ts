import * as fs from 'fs';
import * as path from 'path';
import { Session, Snapshot, RunEvent, SessionEvent } from '../src/models';
import { computeSessionAnalytics } from '../src/analytics/engine';
import { SessionSummarizer } from '../src/ai/SessionSummarizer';

/**
 * Generates an ultra-realistic, comprehensive full-stack coding session (React + Node.js Express + CSS + TS).
 * Contains 14 files and 50+ granular progression steps simulating a developer building a project from scratch.
 */
export function createComprehensiveFullStackSession(): Session {
  const startTime = Date.now() - 60 * 60 * 1000; // 1 hour session
  let t = 0; // ms offset

  const snapshots: Snapshot[] = [];
  const runs: RunEvent[] = [];
  const events: SessionEvent[] = [];

  events.push({
    type: 'start',
    timestamp: 0,
    detail: 'Session started: TaskMaster Pro (Full-Stack React + Node.js + TypeScript)'
  });

  // ==========================================
  // PHASE A: BACKEND ARCHITECTURE (Node / Express / TS)
  // ==========================================

  // 1. server/src/types.ts - Initial interface
  t += 15000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/types.ts',
    content: `export type Priority = 'low' | 'medium' | 'high';\n\nexport interface Task {\n  id: string;\n  title: string;\n  priority: Priority;\n  completed: boolean;\n  createdAt: number;\n}\n`,
    cursorStart: 120,
    cursorEnd: 120
  });

  // 2. server/src/db/connection.ts - Database layer
  t += 20000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/db/connection.ts',
    content: `import { Task } from '../types';\n\n// In-memory persistent collection\nexport const database = {\n  tasks: [\n    {\n      id: 'task-1',\n      title: 'Initialize repository and configure CI/CD',\n      priority: 'high' as const,\n      completed: true,\n      createdAt: Date.now() - 3600000\n    }\n  ] as Task[]\n};\n`,
    cursorStart: 210,
    cursorEnd: 210
  });

  // 3. NPM Package Install Event
  t += 10000;
  events.push({
    type: 'event' as any,
    timestamp: t,
    detail: '📦 [Node/NPM] Installed 16 packages (express, cors, dotenv, zod)'
  });

  // 4. server/src/controllers/taskController.ts - Controller logic
  t += 35000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/controllers/taskController.ts',
    content: `import { Request, Response } from 'express';\nimport { database } from '../db/connection';\nimport { Task, Priority } from '../types';\n\nexport const getTasks = (req: Request, res: Response) => {\n  res.json({ success: true, count: database.tasks.length, data: database.tasks });\n};\n\nexport const createTask = (req: Request, res: Response) => {\n  const { title, priority } = req.body;\n  if (!title || typeof title !== 'string') {\n    return res.status(400).json({ error: 'Title is required' });\n  }\n  const newTask: Task = {\n    id: \`task-\${Date.now()}\`,\n    title,\n    priority: (priority as Priority) || 'medium',\n    completed: false,\n    createdAt: Date.now()\n  };\n  database.tasks.push(newTask);\n  res.status(201).json(newTask);\n};\n`,
    cursorStart: 620,
    cursorEnd: 620
  });

  // 5. server/src/routes/taskRoutes.ts - Route definitions
  t += 25000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/routes/taskRoutes.ts',
    content: `import { Router } from 'express';\nimport { getTasks, createTask } from '../controllers/taskController';\n\nexport const taskRouter = Router();\n\ntaskRouter.get('/', getTasks);\ntaskRouter.post('/', createTask);\n`,
    cursorStart: 180,
    cursorEnd: 180
  });

  // 6. server/src/index.ts - Express application setup
  t += 30000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/index.ts',
    content: `import express from 'express';\nimport cors from 'cors';\nimport { taskRouter } from './routes/taskRoutes';\n\nconst app = express();\nconst PORT = process.env.PORT || 5000;\n\napp.use(cors());\napp.use(express.json());\n\napp.use('/api/tasks', taskRouter);\n\napp.listen(PORT, () => {\n  console.log(\`🚀 Server running on port \${PORT}\`);\n});\n`,
    cursorStart: 280,
    cursorEnd: 280
  });

  // 7. Node server starts listening
  t += 10000;
  events.push({
    type: 'run-pass',
    timestamp: t,
    detail: '🚀 [Node Server] Listening on port :5000'
  });

  // 8. Backend Test Run: Initially FAILS due to missing delete/toggle handlers
  t += 15000;
  runs.push({
    timestamp: t,
    command: 'npm run test:server',
    output: 'FAIL server/src/tasks.test.ts\n✕ DELETE /api/tasks/:id should delete item (404 Not Found)\n✕ PATCH /api/tasks/:id/toggle should flip status (404 Not Found)\nTests: 2 failed, 2 passed, 4 total',
    success: false,
    durationMs: 1350
  });
  events.push({
    type: 'run-fail',
    timestamp: t,
    detail: 'Backend test suite failed: 2 missing endpoints'
  });

  // 9. Fix Controller by adding deleteTask and toggleTask
  t += 35000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/controllers/taskController.ts',
    content: `import { Request, Response } from 'express';\nimport { database } from '../db/connection';\nimport { Task, Priority } from '../types';\n\nexport const getTasks = (req: Request, res: Response) => {\n  res.json({ success: true, count: database.tasks.length, data: database.tasks });\n};\n\nexport const createTask = (req: Request, res: Response) => {\n  const { title, priority } = req.body;\n  if (!title || typeof title !== 'string') {\n    return res.status(400).json({ error: 'Title is required' });\n  }\n  const newTask: Task = {\n    id: \`task-\${Date.now()}\`,\n    title,\n    priority: (priority as Priority) || 'medium',\n    completed: false,\n    createdAt: Date.now()\n  };\n  database.tasks.push(newTask);\n  res.status(201).json(newTask);\n};\n\nexport const deleteTask = (req: Request, res: Response) => {\n  const { id } = req.params;\n  const idx = database.tasks.findIndex(t => t.id === id);\n  if (idx === -1) return res.status(404).json({ error: 'Task not found' });\n  database.tasks.splice(idx, 1);\n  res.status(204).send();\n};\n\nexport const toggleTask = (req: Request, res: Response) => {\n  const { id } = req.params;\n  const task = database.tasks.find(t => t.id === id);\n  if (!task) return res.status(404).json({ error: 'Task not found' });\n  task.completed = !task.completed;\n  res.json(task);\n};\n`,
    cursorStart: 1100,
    cursorEnd: 1100
  });

  // 10. Update Routes
  t += 15000;
  snapshots.push({
    timestamp: t,
    filePath: 'server/src/routes/taskRoutes.ts',
    content: `import { Router } from 'express';\nimport { getTasks, createTask, deleteTask, toggleTask } from '../controllers/taskController';\n\nexport const taskRouter = Router();\n\ntaskRouter.get('/', getTasks);\ntaskRouter.post('/', createTask);\ntaskRouter.delete('/:id', deleteTask);\ntaskRouter.patch('/:id/toggle', toggleTask);\n`,
    cursorStart: 290,
    cursorEnd: 290
  });

  // 11. Re-run Backend Tests -> PASS!
  t += 15000;
  runs.push({
    timestamp: t,
    command: 'npm run test:server',
    output: 'PASS server/src/tasks.test.ts\n✓ GET /api/tasks returns all tasks (14ms)\n✓ POST /api/tasks creates task with priority (18ms)\n✓ DELETE /api/tasks/:id removes task (10ms)\n✓ PATCH /api/tasks/:id/toggle flips completion (12ms)\nTests: 4 passed, 4 total\nTime: 1.12s',
    success: true,
    durationMs: 1120
  });
  events.push({
    type: 'run-pass',
    timestamp: t,
    detail: 'Backend test suite passed (4/4 endpoints verified)'
  });

  // ==========================================
  // PHASE B: FRONTEND ARCHITECTURE (React + CSS + Hooks)
  // ==========================================

  // 12. client/src/types/index.ts - Frontend Types
  t += 20000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/types/index.ts',
    content: `export type Priority = 'low' | 'medium' | 'high';\n\nexport interface Task {\n  id: string;\n  title: string;\n  priority: Priority;\n  completed: boolean;\n  createdAt: number;\n}\n`,
    cursorStart: 130,
    cursorEnd: 130
  });

  // 13. client/src/styles/App.css - Rich Theme & Component Styling
  t += 40000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/styles/App.css',
    content: `:root {\n  --primary: #6366f1;\n  --primary-hover: #4f46e5;\n  --bg: #0f172a;\n  --surface: #1e293b;\n  --border: #334155;\n  --text: #f8fafc;\n  --text-muted: #94a3b8;\n  --priority-high: #ef4444;\n  --priority-med: #f59e0b;\n  --priority-low: #10b981;\n}\n\nbody {\n  margin: 0;\n  background-color: var(--bg);\n  color: var(--text);\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n}\n\n.app-shell {\n  max-width: 760px;\n  margin: 40px auto;\n  padding: 0 20px;\n}\n\n.card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  padding: 24px;\n  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);\n}\n\n.task-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 16px;\n  border-bottom: 1px solid var(--border);\n  transition: all 0.2s ease;\n}\n\n.task-item.completed span {\n  text-decoration: line-through;\n  opacity: 0.5;\n}\n`,
    cursorStart: 780,
    cursorEnd: 780
  });

  // 14. client/src/hooks/useTasks.ts - Custom React Hook
  t += 45000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/hooks/useTasks.ts',
    content: `import { useState, useEffect } from 'react';\nimport { Task, Priority } from '../types';\n\nconst API_BASE = 'http://localhost:5000/api/tasks';\n\nexport function useTasks() {\n  const [tasks, setTasks] = useState<Task[]>([]);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState<string | null>(null);\n\n  useEffect(() => {\n    fetchTasks();\n  }, []);\n\n  const fetchTasks = async () => {\n    try {\n      const res = await fetch(API_BASE);\n      const json = await res.json();\n      setTasks(json.data || []);\n    } catch (err: any) {\n      setError('Failed to fetch tasks');\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  const addTask = async (title: string, priority: Priority) => {\n    const res = await fetch(API_BASE, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ title, priority })\n    });\n    const newTask = await res.json();\n    setTasks(prev => [...prev, newTask]);\n  };\n\n  const toggleTask = async (id: string) => {\n    const res = await fetch(\`\${API_BASE}/\${id}/toggle\`, { method: 'PATCH' });\n    const updated = await res.json();\n    setTasks(prev => prev.map(t => t.id === id ? updated : t));\n  };\n\n  const deleteTask = async (id: string) => {\n    await fetch(\`\${API_BASE}/\${id}\`, { method: 'DELETE' });\n    setTasks(prev => prev.filter(t => t.id !== id));\n  };\n\n  return { tasks, loading, error, addTask, toggleTask, deleteTask };\n}\n`,
    cursorStart: 1350,
    cursorEnd: 1350
  });

  // 15. client/src/components/TaskHeader.tsx - Header component
  t += 25000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/components/TaskHeader.tsx',
    content: `import React from 'react';\n\ninterface TaskHeaderProps {\n  totalCount: number;\n  completedCount: number;\n}\n\nexport const TaskHeader: React.FC<TaskHeaderProps> = ({ totalCount, completedCount }) => {\n  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;\n\n  return (\n    <div className="task-header">\n      <div>\n        <h2>⚡ TaskMaster Pro</h2>\n        <p className="subtitle">Full-Stack Enterprise Task Management</p>\n      </div>\n      <div className="progress-badge">\n        <span>{percent}% Done</span>\n        <small>{completedCount}/{totalCount} completed</small>\n      </div>\n    </div>\n  );\n};\n`,
    cursorStart: 540,
    cursorEnd: 540
  });

  // 16. client/src/components/TaskCard.tsx - Task Card Component
  t += 35000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/components/TaskCard.tsx',
    content: `import React from 'react';\nimport { Task } from '../types';\n\ninterface TaskCardProps {\n  task: Task;\n  onToggle: (id: string) => void;\n  onDelete: (id: string) => void;\n}\n\nexport const TaskCard: React.FC<TaskCardProps> = ({ task, onToggle, onDelete }) => {\n  return (\n    <div className={\`task-item \${task.completed ? 'completed' : ''}\`}>\n      <label className="checkbox-container">\n        <input\n          type="checkbox"\n          checked={task.completed}\n          onChange={() => onToggle(task.id)}\n        />\n        <span className="checkmark" />\n      </label>\n      <span className="task-title">{task.title}</span>\n      <span className={\`priority-pill \${task.priority}\`}>{task.priority}</span>\n      <button className="btn-icon-delete" onClick={() => onDelete(task.id)} title="Delete Task">\n        ✕\n      </button>\n    </div>\n  );\n};\n`,
    cursorStart: 760,
    cursorEnd: 760
  });

  // 17. client/src/components/TaskInput.tsx - Input Form
  t += 30000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/components/TaskInput.tsx',
    content: `import React, { useState } from 'react';\nimport { Priority } from '../types';\n\ninterface TaskInputProps {\n  onAdd: (title: string, priority: Priority) => void;\n}\n\nexport const TaskInput: React.FC<TaskInputProps> = ({ onAdd }) => {\n  const [title, setTitle] = useState('');\n  const [priority, setPriority] = useState<Priority>('medium');\n\n  const handleSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!title.trim()) return;\n    onAdd(title.trim(), priority);\n    setTitle('');\n  };\n\n  return (\n    <form onSubmit={handleSubmit} className="task-form">\n      <input\n        type="text"\n        placeholder="What needs to be done?"\n        value={title}\n        onChange={(e) => setTitle(e.target.value)}\n        className="input-title"\n      />\n      <select\n        value={priority}\n        onChange={(e) => setPriority(e.target.value as Priority)}\n        className="select-priority"\n      >\n        <option value="low">Low Priority</option>\n        <option value="medium">Medium Priority</option>\n        <option value="high">High Priority</option>\n      </select>\n      <button type="submit" className="btn-add">Add Task</button>\n    </form>\n  );\n};\n`,
    cursorStart: 980,
    cursorEnd: 980
  });

  // 18. client/src/App.tsx - Master Component Integration
  t += 40000;
  snapshots.push({
    timestamp: t,
    filePath: 'client/src/App.tsx',
    content: `import React from 'react';\nimport { useTasks } from './hooks/useTasks';\nimport { TaskHeader } from './components/TaskHeader';\nimport { TaskInput } from './components/TaskInput';\nimport { TaskCard } from './components/TaskCard';\nimport './styles/App.css';\n\nexport const App: React.FC = () => {\n  const { tasks, loading, error, addTask, toggleTask, deleteTask } = useTasks();\n  const completedCount = tasks.filter(t => t.completed).length;\n\n  return (\n    <div className="app-shell">\n      <div className="card">\n        <TaskHeader totalCount={tasks.length} completedCount={completedCount} />\n        <TaskInput onAdd={addTask} />\n        \n        {loading && <div className="loading-spinner">Loading tasks from API...</div>}\n        {error && <div className="error-banner">{error}</div>}\n\n        <div className="task-list">\n          {tasks.map(task => (\n            <TaskCard\n              key={task.id}\n              task={task}\n              onToggle={toggleTask}\n              onDelete={deleteTask}\n            />\n          ))}\n        </div>\n      </div>\n    </div>\n  );\n};\n`,
    cursorStart: 950,
    cursorEnd: 950
  });

  // 19. Vite HMR Fast Refresh Event
  t += 8000;
  events.push({
    type: 'event' as any,
    timestamp: t,
    filePath: 'client/src/App.tsx',
    detail: '⚛️ [React/Vite] HMR updated: client/src/App.tsx (19ms)'
  });

  // 20. End-to-End Test Suite Executed -> ALL PASS!
  t += 20000;
  runs.push({
    timestamp: t,
    command: 'npm run test:e2e',
    output: 'PASS client/src/App.test.tsx\n✓ renders TaskHeader with progress calculation (32ms)\n✓ adds task and sends POST to express backend (55ms)\n✓ toggles task completion state (28ms)\n✓ removes task from UI and database (35ms)\n\nTest Suites: 2 passed, 2 total\nTests: 8 passed, 8 total\nSnapshots: 0 total\nTime: 2.14s',
    success: true,
    durationMs: 2140
  });
  events.push({
    type: 'run-pass',
    timestamp: t,
    detail: 'Full-Stack E2E test suite passed (8/8 tests verified)'
  });

  t += 10000;
  events.push({
    type: 'end',
    timestamp: t,
    detail: 'Session completed. Full-Stack TaskMaster Pro fully implemented and verified.'
  });

  return {
    id: 'fullstack-taskmaster-pro',
    workspaceName: 'FullStack-TaskMaster-Pro (React + Node.js + TS)',
    startTime,
    endTime: startTime + t,
    snapshots,
    runs,
    events
  };
}

// Generate the standalone HTML report
export function exportShowcaseFile(outputPath: string): void {
  const session = createComprehensiveFullStackSession();
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
