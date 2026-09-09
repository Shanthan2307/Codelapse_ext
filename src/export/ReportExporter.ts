import * as vscode from 'vscode';
import { Session } from '../models';
import { computeSessionAnalytics } from '../analytics/engine';
import { SessionSummarizer } from '../ai/SessionSummarizer';

export class ReportExporter {
  /**
   * Generates a self-contained, single-file HTML report with embedded React UI,
   * PrismJS highlighter, metrics, timeline, and the complete session replay dataset.
   */
  public static async exportStandaloneHtml(
    extensionUri: vscode.Uri,
    session: Session
  ): Promise<vscode.Uri | null> {
    // Prompt user for save destination
    const defaultFileName = `codelapse-report-${session.workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${session.id}.html`;
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri || extensionUri,
        defaultFileName
      ),
      filters: {
        'HTML Report': ['html']
      },
      title: 'Export CodeLapse Interactive HTML Report'
    });

    if (!saveUri) {
      return null;
    }

    try {
      // Read the bundled webview.js
      const webviewBundleUri = vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js');
      const webviewJsData = await vscode.workspace.fs.readFile(webviewBundleUri);
      const webviewJsText = new TextDecoder().decode(webviewJsData);

      const analytics = computeSessionAnalytics(session);
      const aiSummary = SessionSummarizer.generateSummary(session);

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

      const data = new TextEncoder().encode(htmlContent);
      await vscode.workspace.fs.writeFile(saveUri, data);

      vscode.window.showInformationMessage(
        `CodeLapse: Standalone HTML report exported successfully!`,
        'Open in Browser'
      ).then((selection) => {
        if (selection === 'Open in Browser') {
          vscode.env.openExternal(saveUri);
        }
      });

      return saveUri;
    } catch (err) {
      console.error('Failed to export CodeLapse standalone HTML report:', err);
      vscode.window.showErrorMessage(`Export failed: ${err}`);
      return null;
    }
  }
}
