/**
 * Tmux Target Utilities
 * Provides helpers for working with tmux session:window.pane targets
 *
 * Cross-platform notes:
 *   - On Ubuntu (snap tmux), spawnSync/execSync stdout is empty even when
 *     commands succeed.  Piping through `| cat` via bash resolves this.
 *   - On macOS (Homebrew tmux), direct stdout capture works normally.
 *   - Both paths are attempted; the first that succeeds wins.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Run a tmux command and return its stdout.
 * Tries direct spawnSync first (macOS); if stdout is empty, retries through
 * `bash -c "tmux ... | cat"` which resolves snap-tmux stdout issues on Ubuntu.
 *
 * @param {string[]} args - tmux command arguments (e.g. ['list-panes', '-a'])
 * @returns {string} trimmed stdout, or '' on failure
 */
function tmuxExec(args) {
    // Attempt 1: direct stdout capture (works on macOS)
    try {
        const result = spawnSync('tmux', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3000
        });
        if (result.status === 0 && result.stdout && result.stdout.trim()) {
            return result.stdout.trim();
        }
    } catch (error) {
        // Fall through
    }

    // Attempt 2: pipe through cat via bash (snap-tmux workaround for Ubuntu).
    // snap-tmux returns empty stdout when piped directly, but works with | cat.
    try {
        const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
        const result = spawnSync('bash', ['-c', `tmux ${escaped} 2>/dev/null | cat`], {
            encoding: 'utf8',
            timeout: 3000
        });
        if (result.status === 0 && result.stdout && result.stdout.trim()) {
            return result.stdout.trim();
        }
    } catch (error) {
        // Fall through
    }

    return '';
}

/**
 * Capture tmux pane content, working around snap-tmux stdout issues.
 * Tries capture-pane -p via tmuxExec first; falls back to named-buffer +
 * save-buffer if stdout capture fails entirely.
 *
 * @param {string} target - tmux target (session:window.pane)
 * @param {number} lines  - number of history lines to capture
 * @returns {string} pane content, or '' on failure
 */
function tmuxCapture(target, lines = 200) {
    // Attempt 1: capture-pane -p via tmuxExec (handles both macOS and Ubuntu | cat)
    const directResult = tmuxExec(['capture-pane', '-t', target, '-p', '-S', `-${lines}`]);
    if (directResult) return directResult;

    // Attempt 2: named-buffer + save-buffer (last resort)
    const bufName = `cap-${process.pid}`;
    const tmpFile = path.join(os.tmpdir(), `tmux-cap-${process.pid}-${Date.now()}.tmp`);
    try {
        const r1 = spawnSync('tmux', ['capture-pane', '-t', target, '-b', bufName, '-S', `-${lines}`], {
            encoding: 'utf8', stdio: 'ignore', timeout: 3000
        });
        if (r1.status !== 0) return '';

        const r2 = spawnSync('tmux', ['save-buffer', '-b', bufName, tmpFile], {
            encoding: 'utf8', stdio: 'ignore', timeout: 3000
        });
        if (r2.status !== 0) return '';

        return fs.readFileSync(tmpFile, 'utf8');
    } catch (error) {
        return '';
    } finally {
        try { spawnSync('tmux', ['delete-buffer', '-b', bufName], { stdio: 'ignore', timeout: 1000 }); } catch (_) {}
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
}

/**
 * Get the current tmux target in "session:window.pane" format.
 * Prefers TMUX_PANE env var (process-specific, accurate in hook subprocesses)
 * over display-message (returns currently focused pane, unreliable in multi-pane).
 *
 * @returns {string|null} Full tmux target or null if not in tmux
 */
function getCurrentTmuxTarget() {
    // Primary: TMUX_PANE (process-specific, always accurate in hook subprocesses)
    const paneId = process.env.TMUX_PANE;
    if (paneId) {
        const result = tmuxExec([
            'list-panes', '-a',
            '-f', `#{==:#{pane_id},${paneId}}`,
            '-F', '#{session_name}:#{window_index}.#{pane_index}'
        ]);
        if (result) return result;
    }

    // Fallback: display-message (when TMUX_PANE unavailable, e.g. launchd)
    const target = tmuxExec(['display-message', '-p', '#S:#I.#P']);
    if (target) return target;

    return null;
}

/**
 * Extract the session name from a tmux target string.
 * "mac-dev:0.1" → "mac-dev"
 * "mac-dev"     → "mac-dev" (backward compatible)
 * @param {string} tmuxTarget - Full target or session name
 * @returns {string} Session name only
 */
function extractSessionName(tmuxTarget) {
    if (!tmuxTarget) return '';
    return tmuxTarget.split(':')[0];
}

/**
 * Run a tmux command that produces no stdout (set-option, set-hook, etc.).
 * Unlike tmuxExec which requires stdout to confirm success, this only checks
 * the exit status. Prevents double-execution for side-effect-only commands.
 *
 * @param {string[]} args - tmux command arguments
 * @returns {boolean} true if command succeeded
 */
function tmuxRun(args) {
    try {
        const result = spawnSync('tmux', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3000
        });
        if (result.status === 0) return true;
    } catch {
        // Fall through
    }

    // Attempt 2: bash workaround for snap-tmux on Ubuntu
    try {
        const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
        const result = spawnSync('bash', ['-c', `tmux ${escaped} 2>/dev/null`], {
            encoding: 'utf8',
            timeout: 3000
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

/**
 * Extract window target from a full pane target.
 * "mac-dev:3.1" → "mac-dev:3"
 * "mac-dev:3"   → "mac-dev:3"
 * "mac-dev"     → "mac-dev"
 * @param {string} tmuxTarget - Full target (session:window.pane)
 * @returns {string} Window-level target (session:window)
 */
function extractWindowTarget(tmuxTarget) {
    if (!tmuxTarget) return '';
    return tmuxTarget.replace(/\.\d+$/, '');
}

/**
 * Set window alert (blinking red) to signal that user input is needed.
 * Sets both window-status-style (visible from other windows) and
 * window-status-current-style (visible in the current window).
 * Registers session-window-changed hooks so the alert auto-clears when
 * the user switches TO the alert window.
 *
 * Note: pane-focus-in hooks don't fire on Ubuntu snap tmux, so we use
 * session-window-changed with if-shell to check the target window index.
 *
 * @param {string} tmuxTarget - Full target (session:window.pane)
 * @returns {boolean} true if alert was set
 */
function setWindowAlert(tmuxTarget) {
    const windowTarget = extractWindowTarget(tmuxTarget);
    if (!windowTarget) return false;

    tmuxRun(['set-window-option', '-t', windowTarget, 'window-status-style', 'bg=red,blink']);
    tmuxRun(['set-window-option', '-t', windowTarget, 'window-status-current-style', 'bg=red,blink']);

    // Auto-clear: session-window-changed fires when user switches windows.
    // if-shell -F checks if user switched TO the alert window, then clears.
    const windowIndex = windowTarget.includes(':') ? windowTarget.split(':')[1] : '';
    if (windowIndex) {
        tmuxRun(['set-hook', '-g', 'session-window-changed[98]',
            `if-shell -F "#{==:#{window_index},${windowIndex}}" "set-window-option -u window-status-style"`]);
        tmuxRun(['set-hook', '-g', 'session-window-changed[99]',
            `if-shell -F "#{==:#{window_index},${windowIndex}}" "set-window-option -u window-status-current-style"`]);
    }
    return true;
}

/**
 * Clear window alert, restoring default status style.
 *
 * @param {string} tmuxTarget - Full target (session:window.pane)
 * @returns {boolean} true if alert was cleared
 */
function clearWindowAlert(tmuxTarget) {
    const windowTarget = extractWindowTarget(tmuxTarget);
    if (!windowTarget) return false;

    tmuxRun(['set-window-option', '-t', windowTarget, '-u', 'window-status-style']);
    tmuxRun(['set-window-option', '-t', windowTarget, '-u', 'window-status-current-style']);
    // Clean up auto-clear hooks
    tmuxRun(['set-hook', '-ug', 'session-window-changed[98]']);
    tmuxRun(['set-hook', '-ug', 'session-window-changed[99]']);
    return true;
}

module.exports = {
    getCurrentTmuxTarget, extractSessionName, tmuxExec, tmuxCapture,
    tmuxRun, extractWindowTarget, setWindowAlert, clearWindowAlert
};
