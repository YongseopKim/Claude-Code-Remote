/**
 * Telegram Webhook Handler
 * Handles incoming Telegram messages and commands
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const Logger = require('../../core/logger');
const ControllerInjector = require('../../utils/controller-injector');
const { parseQuestionReply } = require('../../utils/parse-question-reply');

class TelegramWebhookHandler {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramWebhook');
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.injector = new ControllerInjector();
        this.app = express();
        this.apiBaseUrl = 'https://api.telegram.org';
        this.botUsername = null; // Cache for bot username
        
        this._setupMiddleware();
        this._setupRoutes();
    }

    _escapeMd(text) {
        return text.replace(/([_*`\[])/g, '\\$1');
    }

    _setupMiddleware() {
        // Parse JSON for all requests
        this.app.use(express.json());
    }

    _setupRoutes() {
        // Telegram webhook endpoint
        this.app.post('/webhook/telegram', this._handleWebhook.bind(this));

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', service: 'telegram-webhook' });
        });
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

    async _handleWebhook(req, res) {
        try {
            const update = req.body;
            
            // Handle different update types
            if (update.message) {
                await this._handleMessage(update.message);
            } else if (update.callback_query) {
                await this._handleCallbackQuery(update.callback_query);
            }
            
            res.status(200).send('OK');
        } catch (error) {
            this.logger.error('Webhook handling error:', error.message);
            res.status(500).send('Internal Server Error');
        }
    }

    async _handleMessage(message) {
        const chatId = message.chat.id;
        const userId = message.from.id;
        const messageText = message.text?.trim();

        if (!messageText) return;

        // Check if user is authorized
        if (!this._isAuthorized(userId, chatId)) {
            this.logger.warn(`Unauthorized user/chat: ${userId}/${chatId}`);
            await this._sendMessage(chatId, '⚠️ You are not authorized to use this bot.');
            return;
        }

        // Handle /start command
        if (messageText === '/start') {
            await this._sendWelcomeMessage(chatId);
            return;
        }

        // Handle /help command
        if (messageText === '/help') {
            await this._sendHelpMessage(chatId);
            return;
        }

        // Handle reply to notification message (reply-based command)
        if (message.reply_to_message) {
            const originalMessageId = message.reply_to_message.message_id;
            const session = await this._findSessionByMessageId(originalMessageId);
            if (session) {
                this.logger.info(`Reply-based command from message_id: ${originalMessageId}, token: ${session.token}`);
                await this._processCommand(chatId, session.token, messageText);
                return;
            }
            // If no session found for the reply, fall through to normal parsing
        }

        // Parse command
        const commandMatch = messageText.match(/^\/cmd\s+([A-Z0-9]{8})\s+(.+)$/i);
        if (!commandMatch) {
            // Check if it's a direct command without /cmd prefix
            const directMatch = messageText.match(/^([A-Z0-9]{8})\s+(.+)$/);
            if (directMatch) {
                await this._processCommand(chatId, directMatch[1], directMatch[2]);
            } else {
                await this._sendMessage(chatId,
                    '❌ Invalid format. Use:\n• Reply to a notification message\n• `/cmd <TOKEN> <command>`\n\nExample:\n`/cmd ABC12345 analyze this code`',
                    { parse_mode: 'Markdown' });
            }
            return;
        }

        const token = commandMatch[1].toUpperCase();
        const command = commandMatch[2];

        await this._processCommand(chatId, token, command);
    }

    async _processCommand(chatId, token, command) {
        // Find session by token
        const session = await this._findSessionByToken(token);
        if (!session) {
            await this._sendMessage(chatId, 
                '❌ Invalid or expired token. Please wait for a new task notification.',
                { parse_mode: 'Markdown' });
            return;
        }

        // Check if session is expired
        if (session.expiresAt < Math.floor(Date.now() / 1000)) {
            await this._sendMessage(chatId, 
                '❌ Token has expired. Please wait for a new task notification.',
                { parse_mode: 'Markdown' });
            await this._removeSession(session.id);
            return;
        }

        try {
            const tmuxTarget = session.tmuxSession || 'default';
            const parsed = parseQuestionReply(command, session);

            if (parsed.type === 'dismiss-inject') {
                await this.injector.dismissAndInject(parsed.answer, tmuxTarget);
            } else if (parsed.type === 'twoStep') {
                await this.injector.injectTwoStep(
                    parsed.step1, parsed.step2, tmuxTarget
                );
            } else {
                await this.injector.injectCommand(parsed.command, tmuxTarget);
            }

            // Format "session:window.pane" → "session:window/pane"
            const displaySession = tmuxTarget.replace(/\.(\d+)$/, '/$1');
            let displayCmd;
            if (parsed.type === 'dismiss-inject') {
                displayCmd = parsed.answer;
            } else if (parsed.type === 'twoStep') {
                displayCmd = `Option ${parsed.step1} -> "${parsed.step2}"`;
            } else {
                displayCmd = parsed.command;
            }
            await this._sendMessage(chatId,
                `✅ *Command sent successfully*\n\n` +
                `📝 *Command:* ${this._escapeMd(displayCmd)}\n` +
                `🖥️ *Session:* ${this._escapeMd(displaySession)}\n\n` +
                `Claude is now processing your request...`,
                { parse_mode: 'Markdown' });

            this.logger.info(
                `Command injected - User: ${chatId}, Token: ${token}, ` +
                `Command: ${command}, Type: ${parsed.type}`
            );

        } catch (error) {
            this.logger.error('Command injection failed:', error.message);
            await this._sendMessage(chatId,
                `❌ *Command execution failed:* ${this._escapeMd(error.message)}`,
                { parse_mode: 'Markdown' });
        }
    }

    async _handleCallbackQuery(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        
        // Answer callback query to remove loading state
        await this._answerCallbackQuery(callbackQuery.id);
        
        if (data.startsWith('personal:')) {
            const token = data.split(':')[1];
            // Send personal chat command format
            await this._sendMessage(chatId,
                `📝 *Personal Chat Command Format:*\n\n\`/cmd ${token} <your command>\`\n\n*Example:*\n\`/cmd ${token} please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('group:')) {
            const token = data.split(':')[1];
            // Send group chat command format with @bot_name
            const botUsername = await this._getBotUsername();
            await this._sendMessage(chatId,
                `👥 *Group Chat Command Format:*\n\n\`@${botUsername} /cmd ${token} <your command>\`\n\n*Example:*\n\`@${botUsername} /cmd ${token} please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('session:')) {
            const token = data.split(':')[1];
            // For backward compatibility - send help message for old callback buttons
            await this._sendMessage(chatId,
                `📝 *How to send a command:*\n\nType:\n\`/cmd ${token} <your command>\`\n\nExample:\n\`/cmd ${token} please analyze this code\`\n\n💡 *Tip:* New notifications have a button that auto-fills the command for you!`,
                { parse_mode: 'Markdown' });
        }
    }

    async _sendWelcomeMessage(chatId) {
        const message = `🤖 *Welcome to Claude Code Remote Bot!*\n\n` +
            `I'll notify you when Claude completes tasks or needs input.\n\n` +
            `When you receive a notification with a token, you can send commands back using:\n` +
            `\`/cmd <TOKEN> <your command>\`\n\n` +
            `Type /help for more information.`;
        
        await this._sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    async _sendHelpMessage(chatId) {
        const message = `📚 *Claude Code Remote Bot Help*\n\n` +
            `*Commands:*\n` +
            `• \`/start\` - Welcome message\n` +
            `• \`/help\` - Show this help\n` +
            `• \`/cmd <TOKEN> <command>\` - Send command to Claude\n` +
            `• *Reply* to a notification message to send command\n\n` +
            `*Example:*\n` +
            `\`/cmd ABC12345 analyze the performance of this function\`\n\n` +
            `*Tips:*\n` +
            `• Reply to any notification to send a command directly\n` +
            `• Tokens are case-insensitive\n` +
            `• Tokens expire after 24 hours\n` +
            `• You can also just type \`TOKEN command\` without /cmd`;
        
        await this._sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    _isAuthorized(userId, chatId) {
        // Check whitelist
        const whitelist = this.config.whitelist || [];
        
        if (whitelist.includes(String(chatId)) || whitelist.includes(String(userId))) {
            return true;
        }
        
        // If no whitelist configured, allow configured chat/user
        if (whitelist.length === 0) {
            const configuredChatId = this.config.chatId || this.config.groupId;
            if (configuredChatId && String(chatId) === String(configuredChatId)) {
                return true;
            }
        }
        
        return false;
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

    async _findSessionByMessageId(messageId) {
        try {
            const files = fs.readdirSync(this.sessionsDir);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const sessionPath = path.join(this.sessionsDir, file);
                try {
                    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                    if (session.telegramMessageId === messageId) {
                        return session;
                    }
                } catch (error) {
                    this.logger.error(`Failed to read session file ${file}:`, error.message);
                }
            }
        } catch (error) {
            this.logger.error('Failed to search sessions by message_id:', error.message);
        }
        return null;
    }

    async _findSessionByToken(token) {
        const files = fs.readdirSync(this.sessionsDir);
        
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const sessionPath = path.join(this.sessionsDir, file);
            try {
                const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                if (session.token === token) {
                    return session;
                }
            } catch (error) {
                this.logger.error(`Failed to read session file ${file}:`, error.message);
            }
        }
        
        return null;
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    async _sendMessage(chatId, text, options = {}) {
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/sendMessage`,
                {
                    chat_id: chatId,
                    text: text,
                    ...options
                },
                this._getNetworkOptions()
            );
        } catch (error) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message || String(error);
            this.logger.error('Failed to send message:', detail);
        }
    }

    async _answerCallbackQuery(callbackQueryId, text = '') {
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/answerCallbackQuery`,
                {
                    callback_query_id: callbackQueryId,
                    text: text
                },
                this._getNetworkOptions()
            );
        } catch (error) {
            this.logger.error('Failed to answer callback query:', error.response?.data || error.message);
        }
    }

    async setWebhook(webhookUrl) {
        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/setWebhook`,
                {
                    url: webhookUrl,
                    allowed_updates: ['message', 'callback_query']
                },
                this._getNetworkOptions()
            );

            this.logger.info('Webhook set successfully:', response.data);
            return response.data;
        } catch (error) {
            this.logger.error('Failed to set webhook:', error.response?.data || error.message);
            throw error;
        }
    }

    start(port = 3000) {
        this.app.listen(port, () => {
            this.logger.info(`Telegram webhook server started on port ${port}`);
        });
    }
}

module.exports = TelegramWebhookHandler;
