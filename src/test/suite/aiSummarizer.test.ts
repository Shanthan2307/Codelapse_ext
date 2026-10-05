import * as assert from 'assert';
import { SessionSummarizer } from '../../ai/SessionSummarizer';
import { Session } from '../../models';

describe('SessionSummarizer AI & Standup Intelligence Tests', () => {
  it('generates structured conventional commits and PR summaries from session data', () => {
    const mockSession: Session = {
      id: 'session-ai-1',
      workspaceName: 'auth-service',
      startTime: 10000,
      endTime: 80000,
      snapshots: [
        {
          timestamp: 10000,
          filePath: 'src/auth/jwt.ts',
          content: 'export function verifyToken() {}',
          cursorStart: 10,
          cursorEnd: 10
        },
        {
          timestamp: 50000,
          filePath: 'src/auth/jwt.ts',
          content: 'export function verifyToken(token: string): boolean {\n  return token.length > 10;\n}',
          cursorStart: 45,
          cursorEnd: 45
        }
      ],
      runs: [
        {
          timestamp: 30000,
          command: 'npm test',
          output: 'FAIL jwt.test.ts',
          success: false,
          durationMs: 900
        },
        {
          timestamp: 60000,
          command: 'npm test',
          output: 'PASS jwt.test.ts',
          success: true,
          durationMs: 850
        }
      ],
      events: [
        { type: 'start', timestamp: 0, detail: 'Session started' },
        { type: 'framework', timestamp: 40000, detail: '⚛️ [React/Vite] HMR updated: src/auth/jwt.ts' },
        { type: 'end', timestamp: 70000, detail: 'Session ended' }
      ]
    };

    const summary = SessionSummarizer.generateSummary(mockSession);

    // Commit Message checks
    assert.ok(summary.commitMessage.startsWith('fix('), 'Should identify fix type after failed then passed run');
    assert.ok(summary.commitMessage.includes('auth'), 'Should extract auth scope from path');
    assert.ok(summary.commitMessage.includes('CodeLapse'));

    // PR Summary checks
    assert.ok(summary.pullRequestSummary.includes('## 📋 Pull Request Summary'));
    assert.ok(summary.pullRequestSummary.includes('`src/auth/jwt.ts`'));
    assert.ok(summary.pullRequestSummary.includes('100%') || summary.pullRequestSummary.includes('50%'));

    // Standup report checks
    assert.ok(summary.standupReport.includes('auth-service'));

    // Highlights
    assert.ok(summary.keyHighlights.some(h => h.includes('React/Vite')));
  });
});
