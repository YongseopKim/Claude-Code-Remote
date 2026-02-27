/**
 * Tmux Target Utilities
 * Provides helpers for working with tmux session:window.pane targets
 */

const { execSync } = require('child_process');

/**
 * Get the current tmux target in "session:window.pane" format.
 * Uses execSync with a fixed command string (no user input) so shell injection is not a concern.
 * @returns {string|null} Full tmux target or null if not in tmux
 */
function getCurrentTmuxTarget() {
    try {
        const target = execSync('tmux display-message -p "#S:#I.#P"', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return target || null;
    } catch (error) {
        return null;
    }
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

module.exports = { getCurrentTmuxTarget, extractSessionName };
