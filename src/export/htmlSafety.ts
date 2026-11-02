// Pure helpers for building standalone HTML reports (no `vscode` import, so unit-testable).

/**
 * JSON for embedding inside a <script> tag. Recorded code can contain
 * "</script>" (Vite's index.html does), which would otherwise end the tag
 * early and break the report; "<" is escaped as \u003c, which JSON allows.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
