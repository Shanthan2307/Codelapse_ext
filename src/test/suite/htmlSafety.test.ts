import * as assert from 'assert';
import { serializeForScript, escapeHtml } from '../../export/htmlSafety';

describe('Standalone HTML Report Embedding Tests', () => {
  it('never lets recorded code close the surrounding <script> tag', () => {
    // A Vite index.html, exactly the kind of file testers will edit.
    const data = { content: '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>' };
    const out = serializeForScript(data);

    assert.ok(!/<\/script/i.test(out), 'output must not contain a closing script tag');
    assert.ok(!out.includes('<'), 'every "<" is escaped');
    // Still valid JSON and a valid JS expression that round-trips exactly.
    assert.deepStrictEqual(JSON.parse(out), data);
    assert.deepStrictEqual(new Function(`return ${out};`)(), data);
  });

  it('escapes HTML special characters in titles', () => {
    assert.strictEqual(escapeHtml('a<b & "c">'), 'a&lt;b &amp; &quot;c&quot;&gt;');
  });
});
