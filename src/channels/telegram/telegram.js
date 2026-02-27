/**
 * Telegram Notification Channel
 * Sends notifications via Telegram Bot API with command support
 */

const NotificationChannel = require('../base/channel');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const TmuxMonitor = require('../../utils/tmux-monitor');
const { getCurrentTmuxTarget } = require('../../utils/tmux-utils');

class TelegramChannel extends NotificationChannel {
    constructor(config = {}) {
        super('telegram', config);
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.tmuxMonitor = new TmuxMonitor();
        this.apiBaseUrl = 'https://api.telegram.org';
        this.botUsername = null; // Cache for bot username
        
        this._ensureDirectories();
        this._validateConfig();
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    _validateConfig() {
        if (!this.config.botToken) {
            this.logger.warn('Telegram Bot Token not found');
            return false;
        }
        if (!this.config.chatId && !this.config.groupId) {
            this.logger.warn('Telegram Chat ID or Group ID must be configured');
            return false;
        }
        return true;
    }

    /**
     * Generate network options for axios requests
     * @returns {Object} Network options object
     */
    _getNetworkOptions() {
        const options = {};
        if (this.config.forceIPv4) {
            const http = require('http');
            const https = require('https');
            options.httpAgent = new http.Agent({ family: 4 });
            options.httpsAgent = new https.Agent({ family: 4 });
        }
        return options;
    }

    _generateToken() {
        // Generate short Token (uppercase letters + numbers, 8 digits)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    _getCurrentTmuxTarget() {
        return getCurrentTmuxTarget();
    }

    async _getBotUsername() {
        if (this.botUsername) {
            return this.botUsername;
        }

        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/bot${this.config.botToken}/getMe`,
                this._getNetworkOptions()
            );
            
            if (response.data.ok && response.data.result.username) {
                this.botUsername = response.data.result.username;
                return this.botUsername;
            }
        } catch (error) {
            this.logger.error('Failed to get bot username:', error.message);
        }
        
        // Fallback to configured username or default
        return this.config.botUsername || 'claude_remote_bot';
    }

    async _sendImpl(notification) {
        if (!this._validateConfig()) {
            throw new Error('Telegram channel not properly configured');
        }

        // Generate session ID and Token
        const sessionId = uuidv4();
        const token = this._generateToken();
        
        // Get current tmux target (session:window.pane) and conversation content.
        // Fall back to notification.tmuxSession when getCurrentTmuxTarget() fails
        // (e.g. hook subprocesses without tmux client attachment).
        const tmuxSession = this._getCurrentTmuxTarget() || notification.tmuxSession;
        if (tmuxSession && !notification.metadata) {
            const conversation = this.tmuxMonitor.getRecentConversation(tmuxSession);
            notification.metadata = {
                userQuestion: conversation.userQuestion || notification.message,
                claudeResponse: conversation.claudeResponse || notification.message,
                tmuxSession: tmuxSession
            };
        }

        // Ensure tmuxSession is in metadata for session record
        if (notification.tmuxSession && !notification.metadata?.tmuxSession) {
            if (!notification.metadata) notification.metadata = {};
            notification.metadata.tmuxSession = notification.tmuxSession;
        }

        // Create session record
        await this._createSession(sessionId, notification, token);

        // Generate Telegram message
        const messageText = this._generateTelegramMessage(notification, sessionId, token);
        
        // Determine recipient (chat or group)
        const chatId = this.config.groupId || this.config.chatId;
        const isGroupChat = !!this.config.groupId;
        
        // Create buttons using callback_data instead of inline query
        // This avoids the automatic @bot_name addition
        const buttons = [
            [
                {
                    text: '📝 Personal Chat',
                    callback_data: `personal:${token}`
                },
                {
                    text: '👥 Group Chat', 
                    callback_data: `group:${token}`
                }
            ]
        ];
        
        const requestData = {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: buttons
            }
        };

        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/sendMessage`,
                requestData,
                this._getNetworkOptions()
            );

            // Save Telegram message_id to session for reply-based commands
            if (response.data.ok && response.data.result.message_id) {
                await this._updateSessionMessageId(sessionId, response.data.result.message_id);
            }

            this.logger.info(`Telegram message sent successfully, Session: ${sessionId}`);
            return true;
        } catch (error) {
            this.logger.error('Failed to send Telegram message:', error.response?.data || error.message);
            // Clean up failed session
            await this._removeSession(sessionId);
            return false;
        }
    }

    _escapeMd(text) {
        // Escape Telegram Markdown special characters: _ * ` [
        return text.replace(/([_*`\[])/g, '\\$1');
    }

    _generateTelegramMessage(notification, sessionId, token) {
        const type = notification.type;
        const emojiMap = { completed: '✅', waiting: '⏳', permission: '🔐' };
        const statusMap = { completed: 'Completed', waiting: 'Waiting for Input', permission: 'Permission Required' };
        let emoji = emojiMap[type] || '📢';
        let status = statusMap[type] || type;

        if (type === 'permission' && notification.metadata?.isUserQuestion) {
            emoji = '❓';
            status = 'Question';
        }

        let messageText = `${emoji} *Claude ${status}*\n`;
        messageText += `*Project:* ${this._escapeMd(notification.project)}\n`;
        const tmuxTarget = notification.tmuxSession || notification.metadata?.tmuxSession || 'unknown';
        // Format "session:window.pane" → "session:window/pane"
        const displaySession = tmuxTarget.replace(/\.(\d+)$/, '/$1');
        messageText += `*Session:* ${this._escapeMd(displaySession)}\n`;
        messageText += `*Token:* \`${token}\`\n\n`;

        if (type === 'permission' && notification.metadata?.isUserQuestion) {
            const allQuestions = notification.metadata.allQuestions || [];

            if (allQuestions.length > 1) {
                // Multi-question: show all questions
                for (let qi = 0; qi < allQuestions.length; qi++) {
                    const q = allQuestions[qi];
                    messageText += `📝 *Q${qi + 1}: ${this._escapeMd(q.question)}*\n`;
                    if (q.options && q.options.length > 0) {
                        for (let oi = 0; oi < q.options.length; oi++) {
                            const opt = q.options[oi];
                            let text = opt.label;
                            if (opt.description) text += ` - ${opt.description}`;
                            messageText += `  ${oi + 1}\\. ${this._escapeMd(text)}\n`;
                        }
                    }
                    messageText += `\n`;
                }
                messageText += `💬 *Reply to the first question (번호 or 텍스트)*`;
            } else {
                // Single question: original format
                const escaped = this._escapeMd(notification.metadata.permissionMessage);
                messageText += `📝 *Question:*\n${escaped}\n\n`;

                const options = notification.metadata.approvalOptions;
                if (options && options.length > 0) {
                    for (let i = 0; i < options.length; i++) {
                        const prefix = i === 0 ? '▸' : ' ';
                        messageText += `${prefix} ${i + 1}\\. ${this._escapeMd(options[i])}\n`;
                    }
                    messageText += `\n`;
                }

                const optionNums = options.map((_, i) => i + 1).join(', ');
                const typeOptNum = (notification.metadata.questionOptionCount || 0) + 1;
                messageText += `💬 *Reply with ${optionNums} to respond*\n`;
                messageText += `Custom: \`${typeOptNum}. your text here\``;
            }
        } else if (type === 'permission' && notification.metadata?.permissionMessage) {
            const escaped = this._escapeMd(notification.metadata.permissionMessage);
            messageText += `⚠️ *Permission Request:*\n${escaped}\n\n`;

            // Show approval options if available
            const options = notification.metadata.approvalOptions;
            if (options && options.length > 0) {
                messageText += `*Do you want to proceed?*\n`;
                for (let i = 0; i < options.length; i++) {
                    const prefix = i === 0 ? '▸' : ' ';
                    messageText += `${prefix} ${i + 1}. ${this._escapeMd(options[i])}\n`;
                }
                messageText += `\n`;
            }

            const optionNums = options.map((_, i) => i + 1).join(', ');
            messageText += `💬 *Reply with ${optionNums} to respond*\n`;
            messageText += `Or type: \`/cmd ${token} y\``;
        } else if (notification.metadata) {
            const maxTotal = 3800;

            if (notification.metadata.userQuestion) {
                const escaped = this._escapeMd(notification.metadata.userQuestion);
                messageText += `📝 *Your Question:*\n${escaped}\n\n`;
            }

            if (notification.metadata.claudeResponse) {
                const remaining = maxTotal - messageText.length - 200;
                const response = notification.metadata.claudeResponse;
                const trimmed = remaining > 0 && response.length > remaining
                    ? response.substring(0, remaining) + '...'
                    : response;
                const escaped = this._escapeMd(trimmed);
                messageText += `🤖 *Claude Response:*\n${escaped}\n\n`;
            }

            messageText += `💬 *Reply to this message or type:*\n`;
            messageText += `\`/cmd ${token} <your command>\``;
        } else {
            messageText += `💬 *Reply to this message or type:*\n`;
            messageText += `\`/cmd ${token} <your command>\``;
        }

        return messageText;
    }

    async _createSession(sessionId, notification, token) {
        const session = {
            id: sessionId,
            token: token,
            type: 'telegram',
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Expires after 24 hours
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
            tmuxSession: notification.metadata?.tmuxSession || 'default',
            project: notification.project,
            notification: notification,
            isUserQuestion: notification.metadata?.isUserQuestion || false,
            questionOptionCount: notification.metadata?.questionOptionCount || 0,
            questionOptions: notification.metadata?.questionOptions || [],
            allQuestions: notification.metadata?.allQuestions || []
        };

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        
        this.logger.debug(`Session created: ${sessionId}`);
    }

    async _updateSessionMessageId(sessionId, messageId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        try {
            if (fs.existsSync(sessionFile)) {
                const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                session.telegramMessageId = messageId;
                fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
                this.logger.debug(`Session ${sessionId} updated with message_id: ${messageId}`);
            }
        } catch (error) {
            this.logger.error(`Failed to update session message_id:`, error.message);
        }
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    supportsRelay() {
        return true;
    }

    validateConfig() {
        return this._validateConfig();
    }
}

module.exports = TelegramChannel;
