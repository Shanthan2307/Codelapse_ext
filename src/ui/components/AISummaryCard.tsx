import React, { useState } from 'react';
import { Session } from '../../models';
import { SessionSummarizer, AISummaryResult } from '../../ai/SessionSummarizer';

interface AISummaryCardProps {
  session: Session;
}

export const AISummaryCard: React.FC<AISummaryCardProps> = ({ session }) => {
  const [summary, setSummary] = useState<AISummaryResult>(() =>
    SessionSummarizer.generateSummary(session)
  );
  const [activeTab, setActiveTab] = useState<'commit' | 'pr' | 'standup'>('commit');
  const [copied, setCopied] = useState<string | null>(null);

  const handleRegenerate = () => {
    setSummary(SessionSummarizer.generateSummary(session));
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="section-card ai-summary-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span>🤖</span> AI Session Intelligence & Summarizer
          </h2>
          <span className="section-subtitle">
            Synthesizes code diffs, framework milestones, and test runs into structured developer reports.
          </span>
        </div>
        <button className="btn btn-secondary" onClick={handleRegenerate}>
          ⚡ Refresh AI Summary
        </button>
      </div>

      <div className="ai-tabs-bar">
        <button
          className={`ai-tab ${activeTab === 'commit' ? 'active' : ''}`}
          onClick={() => setActiveTab('commit')}
        >
          <span>💬</span> Commit Message
        </button>
        <button
          className={`ai-tab ${activeTab === 'pr' ? 'active' : ''}`}
          onClick={() => setActiveTab('pr')}
        >
          <span>📋</span> Pull Request Summary
        </button>
        <button
          className={`ai-tab ${activeTab === 'standup' ? 'active' : ''}`}
          onClick={() => setActiveTab('standup')}
        >
          <span>☕</span> Daily Standup
        </button>
      </div>

      <div className="ai-content-box">
        {activeTab === 'commit' && (
          <div className="ai-tab-content">
            <div className="ai-content-header">
              <span className="ai-content-title">Conventional Commit Format</span>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => handleCopy(summary.commitMessage, 'commit')}
              >
                {copied === 'commit' ? '✓ Copied' : '📋 Copy Commit'}
              </button>
            </div>
            <pre className="ai-code-block">{summary.commitMessage}</pre>
          </div>
        )}

        {activeTab === 'pr' && (
          <div className="ai-tab-content">
            <div className="ai-content-header">
              <span className="ai-content-title">Markdown PR Description</span>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => handleCopy(summary.pullRequestSummary, 'pr')}
              >
                {copied === 'pr' ? '✓ Copied' : '📋 Copy Markdown'}
              </button>
            </div>
            <pre className="ai-code-block">{summary.pullRequestSummary}</pre>
          </div>
        )}

        {activeTab === 'standup' && (
          <div className="ai-tab-content">
            <div className="ai-content-header">
              <span className="ai-content-title">Slack / Teams Standup Update</span>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => handleCopy(summary.standupReport, 'standup')}
              >
                {copied === 'standup' ? '✓ Copied' : '📋 Copy Standup'}
              </button>
            </div>
            <div className="ai-text-block">{summary.standupReport}</div>
          </div>
        )}
      </div>

      {summary.keyHighlights.length > 0 && (
        <div className="ai-highlights-list">
          <span className="highlights-label">Key Session Milestones:</span>
          {summary.keyHighlights.map((h, idx) => (
            <span key={idx} className="highlight-pill">
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
