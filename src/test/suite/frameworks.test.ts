import * as assert from 'assert';
import { ReactWatcher } from '../../frameworks/ReactWatcher';
import { NodeWatcher } from '../../frameworks/NodeWatcher';
import { DjangoWatcher } from '../../frameworks/DjangoWatcher';
import { SessionEvent, Snapshot } from '../../models';

class MockSessionManagerForFrameworks {
  public events: SessionEvent[] = [];
  public elapsedTime: number = 2500;
  public isRecordingActive: boolean = true;

  public isRecording(): boolean {
    return this.isRecordingActive;
  }

  public getElapsedTimeMs(): number {
    return this.elapsedTime;
  }

  public addSessionEvent(event: SessionEvent): void {
    this.events.push(event);
  }
}

describe('Framework Watchers Unit Tests', () => {
  it('ReactWatcher intercepts Vite and Next.js HMR compilation events', () => {
    const mockManager = new MockSessionManagerForFrameworks();
    const watcher = new ReactWatcher(mockManager as any);

    // Simulate Vite HMR log
    watcher.processTerminalOutput('terminal 1', '[vite] hmr update /src/components/Header.tsx (18ms)\n');
    assert.strictEqual(mockManager.events.length, 1);
    assert.ok(mockManager.events[0].detail?.includes('React/Vite'));
    assert.ok(mockManager.events[0].detail?.includes('/src/components/Header.tsx'));

    // Simulate Next.js build log
    watcher.processTerminalOutput('terminal 1', '✓ Compiled /api/auth in 320ms\n');
    assert.strictEqual(mockManager.events.length, 2);
    assert.ok(mockManager.events[1].detail?.includes('Next.js'));
    assert.ok(mockManager.events[1].detail?.includes('/api/auth'));
  });

  it('NodeWatcher intercepts Nodemon restarts, package additions, and server ports', () => {
    const mockManager = new MockSessionManagerForFrameworks();
    const watcher = new NodeWatcher(mockManager as any);

    // Simulate Nodemon restart
    watcher.processTerminalOutput('server terminal', '[nodemon] restarting due to changes...\n');
    assert.strictEqual(mockManager.events.length, 1);
    assert.ok(mockManager.events[0].detail?.includes('Node/Nodemon'));

    // Simulate Server listening
    watcher.processTerminalOutput('server terminal', 'Express server is running on http://localhost:8080\n');
    assert.strictEqual(mockManager.events.length, 2);
    assert.ok(mockManager.events[1].detail?.includes(':8080'));

    // Simulate NPM package add
    watcher.processTerminalOutput('npm terminal', 'added 24 packages in 1.4s\n');
    assert.strictEqual(mockManager.events.length, 3);
    assert.ok(mockManager.events[2].detail?.includes('24 packages'));
  });

  it('DjangoWatcher intercepts migrations, system checks, and StatReloader reloads', () => {
    const mockManager = new MockSessionManagerForFrameworks();
    const watcher = new DjangoWatcher(mockManager as any);

    // Simulate Django migration
    watcher.processTerminalOutput('django terminal', 'Applying blog.0002_add_comments... OK\n');
    assert.strictEqual(mockManager.events.length, 1);
    assert.ok(mockManager.events[0].detail?.includes('Django Migration'));
    assert.ok(mockManager.events[0].detail?.includes('blog.0002_add_comments'));

    // Simulate Django system check
    watcher.processTerminalOutput('django terminal', 'Django version 4.2, using settings mysite.settings\nSystem check identified no issues (0 silenced).\n');
    assert.strictEqual(mockManager.events.length, 2);
    assert.ok(mockManager.events[1].detail?.includes('Django Server'));
    assert.ok(mockManager.events[1].detail?.includes('System check passed'));

    // Simulate StatReloader
    watcher.processTerminalOutput('django terminal', 'Watching for file changes with StatReloader\n');
    assert.strictEqual(mockManager.events.length, 3);
    assert.ok(mockManager.events[2].detail?.includes('Django Reloader'));
  });
});
