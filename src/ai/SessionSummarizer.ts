import { Session } from '../models';
import { computeSessionAnalytics, SessionAnalytics } from '../analytics/engine';

export interface AISummaryResult {
  commitMessage: string;
  pullRequestSummary: string;
  standupReport: string;
  keyHighlights: string[];
}

export class SessionSummarizer {
  /**
   * Generates structured commit messages, pull request summaries, and daily standup reports
   * based on the recorded session telemetry, framework milestones, and test runs.
   */
  public static generateSummary(session: Session): AISummaryResult {
    const analytics: SessionAnalytics = computeSessionAnalytics(session);
    const files = Object.keys(analytics.files);
    const topFiles = files.slice(0, 3);

    // 1. Determine primary focus / type
    const hasFailedRunsThenPassed = session.runs.some(r => !r.success) && session.runs[session.runs.length - 1]?.success;
    const hasOnlyPassedRuns = session.runs.length > 0 && session.runs.every(r => r.success);
    const isNetPositive = analytics.netLinesWritten >= 0;

    let commitType = 'feat';
    let commitScope = 'core';
    if (files[0]) {
      const cleanPath = files[0].replace(/^src\//, '');
      const parts = cleanPath.split('/');
      commitScope = parts.length > 1 ? parts[0] : (parts[0].split('.')[0] || 'core');
    }

    if (hasFailedRunsThenPassed) {
      commitType = 'fix';
    } else if (analytics.netLinesWritten < -30) {
      commitType = 'refactor';
    } else if (topFiles.some(f => f.includes('test') || f.includes('spec'))) {
      commitType = 'test';
    }

    // 2. Extract Framework Milestones
    const frameworkEvents = session.events.filter(
      (e) =>
        e.type === 'framework' ||
        e.detail?.includes('React') ||
        e.detail?.includes('Next.js') ||
        e.detail?.includes('Node') ||
        e.detail?.includes('Django')
    );

    const highlights: string[] = [];

    if (files.length > 0) {
      highlights.push(`Modified ${files.length} ${files.length === 1 ? 'file' : 'files'} (${topFiles.join(', ')}${files.length > 3 ? ` +${files.length - 3} more` : ''}) with net ${analytics.netLinesWritten >= 0 ? '+' : ''}${analytics.netLinesWritten} lines.`);
    }

    if (session.runs.length > 0) {
      highlights.push(`Executed ${session.runs.length} test/build runs (${analytics.passRate}% pass rate).`);
    }

    for (const fe of frameworkEvents.slice(0, 3)) {
      if (fe.detail) {
        highlights.push(fe.detail);
      }
    }

    // 3. Generate Conventional Commit Message
    const primaryFileBasename = files[0] ? files[0].split('/').pop()?.replace(/\.[^/.]+$/, '') : 'workspace';
    const commitDescription = hasFailedRunsThenPassed
      ? `resolve issue and pass verification in ${primaryFileBasename}`
      : `update ${primaryFileBasename} logic with ${analytics.totalKeystrokes.toLocaleString()} keystrokes`;

    const commitMessage = `${commitType}(${commitScope}): ${commitDescription}\n\n- Net lines: ${analytics.netLinesWritten >= 0 ? '+' : ''}${analytics.netLinesWritten} across ${files.length} files\n- Verified with ${session.runs.length} runs (${analytics.successfulRuns} passed)\n- Recorded by CodeLapse (${analytics.formattedDuration})`;

    // 4. Generate Pull Request Summary Markdown
    const pullRequestSummary = `## 📋 Pull Request Summary

### 🔍 Overview
- **Session Duration:** ${analytics.formattedDuration}
- **Net Changes:** ${analytics.netLinesWritten >= 0 ? '+' : ''}${analytics.netLinesWritten} lines across ${files.length} files
- **Total Keystrokes:** ${analytics.totalKeystrokes.toLocaleString()}

### 📁 Modified Files
${files.map(f => `- \`${f}\` (+${analytics.files[f]?.netLines || 0} lines, ${analytics.files[f]?.totalSnapshots || 0} snapshots)`).join('\n')}

### 🚀 Verification & Test Runs
- **Total Executions:** ${session.runs.length}
- **Pass Rate:** ${analytics.passRate}% (${analytics.successfulRuns} passed, ${analytics.failedRuns} failed)

### ⚡ Framework & Milestone Highlights
${highlights.map(h => `- ${h}`).join('\n')}

---
*Auto-generated from CodeLapse session telemetry (${session.id})*`;

    // 5. Generate Standup Update
    const standupReport = `**Yesterday/Today:** Worked on ${session.workspaceName} (${analytics.formattedDuration}). Touched ${files.length} files with net ${analytics.netLinesWritten >= 0 ? '+' : ''}${analytics.netLinesWritten} lines. Executed ${session.runs.length} verification runs with ${analytics.passRate}% pass rate.\n**Blockers:** ${analytics.failedRuns > 0 && !hasFailedRunsThenPassed ? `${analytics.failedRuns} failing test runs require attention.` : 'None.'}`;

    return {
      commitMessage,
      pullRequestSummary,
      standupReport,
      keyHighlights: highlights
    };
  }
}
