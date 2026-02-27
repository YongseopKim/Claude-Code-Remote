/**
 * Controller Injector
 * Injects commands into tmux sessions or PTY
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('../core/logger');

class ControllerInjector {
    constructor(config = {}) {
        this.logger = new Logger('ControllerInjector');
        this.mode = config.mode || process.env.INJECTION_MODE || 'pty';
        this.defaultSession = config.defaultSession || process.env.TMUX_SESSION || 'claude-code';
        this._tmuxBinaryCache = null;
        this._tmuxSocketCache = null;
    }

    async injectCommand(command, sessionName = null) {
        const session = sessionName || this.defaultSession;
        
        if (this.mode === 'tmux') {
            return this._injectTmux(command, session);
        } else {
            return this._injectPty(command, session);
        }
    }

    _findTmuxBinary() {
        if (this._tmuxBinaryCache) return this._tmuxBinaryCache;

        // Try 'which tmux' first
        try {
            const result = execSync('which tmux', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            if (result) {
                this._tmuxBinaryCache = result;
                return this._tmuxBinaryCache;
            }
        } catch {}

        // Fall back to common paths across platforms
        const candidates = [
            '/opt/homebrew/bin/tmux',   // macOS ARM (Homebrew)
            '/usr/local/bin/tmux',      // macOS Intel / custom install
            '/usr/bin/tmux',            // Linux (apt, yum, etc.)
            '/snap/bin/tmux',           // Ubuntu Snap
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                this._tmuxBinaryCache = p;
                return this._tmuxBinaryCache;
            }
        }

        this._tmuxBinaryCache = 'tmux';
        return this._tmuxBinaryCache;
    }

    _findTmuxSocket() {
        if (this._tmuxSocketCache) return this._tmuxSocketCache;

        const uid = process.getuid ? process.getuid() : (parseInt(process.env.UID) || 1000);

        // /tmp/tmux-{uid}/default works on both macOS and Linux
        // On macOS, /tmp is a symlink to /private/tmp
        const candidates = [
            `/tmp/tmux-${uid}/default`,
            `/private/tmp/tmux-${uid}/default`,
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                this._tmuxSocketCache = p;
                return this._tmuxSocketCache;
            }
        }

        // Default to standard path
        this._tmuxSocketCache = `/tmp/tmux-${uid}/default`;
        return this._tmuxSocketCache;
    }

    _getTmuxCommand() {
        const binary = this._findTmuxBinary();
        const socket = this._findTmuxSocket();
        return `${binary} -S ${socket}`;
    }

    _injectTmux(command, sessionName) {
        const tmux = this._getTmuxCommand();

        try {
            // Check if tmux session exists
            try {
                execSync(`${tmux} has-session -t ${sessionName}`, { stdio: 'ignore' });
            } catch (error) {
                throw new Error(`Tmux session '${sessionName}' not found`);
            }

            // Send command to tmux session and execute it
            const escapedCommand = command.replace(/'/g, "'\\''");

            // Send command first
            execSync(`${tmux} send-keys -t ${sessionName} '${escapedCommand}'`, { stdio: 'ignore' });
            // Then send Enter as separate command
            execSync(`${tmux} send-keys -t ${sessionName} Enter`, { stdio: 'ignore' });
            
            this.logger.info(`Command injected to tmux session '${sessionName}'`);
            return true;
        } catch (error) {
            this.logger.error('Failed to inject command via tmux:', error.message);
            throw error;
        }
    }

    _injectPty(command, sessionName) {
        try {
            // Find PTY session file
            const sessionMapPath = process.env.SESSION_MAP_PATH || 
                                   path.join(__dirname, '../data/session-map.json');
            
            if (!fs.existsSync(sessionMapPath)) {
                throw new Error('Session map file not found');
            }

            const sessionMap = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
            const sessionInfo = sessionMap[sessionName];
            
            if (!sessionInfo || !sessionInfo.ptyPath) {
                throw new Error(`PTY session '${sessionName}' not found`);
            }

            // Write command to PTY
            fs.writeFileSync(sessionInfo.ptyPath, command + '\n');
            
            this.logger.info(`Command injected to PTY session '${sessionName}'`);
            return true;
        } catch (error) {
            this.logger.error('Failed to inject command via PTY:', error.message);
            throw error;
        }
    }

    listSessions() {
        if (this.mode === 'tmux') {
            try {
                const tmux = this._getTmuxCommand();
                const output = execSync(`${tmux} list-sessions -F "#{session_name}"`, {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return output.trim().split('\n').filter(Boolean);
            } catch (error) {
                return [];
            }
        } else {
            try {
                const sessionMapPath = process.env.SESSION_MAP_PATH || 
                                       path.join(__dirname, '../data/session-map.json');
                
                if (!fs.existsSync(sessionMapPath)) {
                    return [];
                }

                const sessionMap = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
                return Object.keys(sessionMap);
            } catch (error) {
                return [];
            }
        }
    }
}

module.exports = ControllerInjector;