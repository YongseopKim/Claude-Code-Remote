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

module.exports = { getCurrentTmuxTarget, extractSessionName, tmuxExec, tmuxCapture };
