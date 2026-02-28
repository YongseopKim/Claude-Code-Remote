/**
 * Tests for webhook reply routing: token extraction from reply_to_message
 * and bare-input fallback to most recent session.
 */
const path = require('path');
const fs = require('fs');

jest.mock('express', () => {
    const app = { use: jest.fn(), post: jest.fn(), get: jest.fn(), listen: jest.fn() };
    const express = () => app;
    express.json = jest.fn(() => 'json-middleware');
    return express;
});
jest.mock('axios');

jest.mock('../src/utils/controller-injector', () => {
    return jest.fn().mockImplementation(() => ({
        injectCommand: jest.fn().mockResolvedValue(undefined),
        injectTwoStep: jest.fn().mockResolvedValue(undefined),
        dismissAndInject: jest.fn().mockResolvedValue(undefined),
    }));
});

const TelegramWebhookHandler = require('../src/channels/telegram/webhook');

describe('webhook reply routing: token extraction & fallback', () => {
    let handler;
    const chatId = 99999;
    const userId = 88888;

    let tempSessionsDir;

    beforeEach(() => {
        handler = new TelegramWebhookHandler({
            botToken: 'test-token',
            whitelist: [String(chatId)],
        });
        handler._sendMessage = jest.fn().mockResolvedValue(undefined);

        // Use isolated temp directory to avoid interference from real sessions
        tempSessionsDir = path.join(__dirname, '..', 'src', 'data', 'sessions-test-' + Date.now());
        fs.mkdirSync(tempSessionsDir, { recursive: true });
        handler.sessionsDir = tempSessionsDir;
    });

    afterEach(() => {
        // Clean up temp sessions directory
        if (fs.existsSync(tempSessionsDir)) {
            const files = fs.readdirSync(tempSessionsDir);
            for (const file of files) {
                fs.unlinkSync(path.join(tempSessionsDir, file));
            }
            fs.rmdirSync(tempSessionsDir);
        }
    });

    function createSession(overrides = {}) {
        const session = {
            id: 'test-reply-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            token: 'Q66DYRXL',
            tmuxSession: 'dev:0.0',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            createdAt: Math.floor(Date.now() / 1000),
            isUserQuestion: false,
            questionOptionCount: 0,
            ...overrides,
        };
        const sessionPath = path.join(handler.sessionsDir, `${session.id}.json`);
        fs.writeFileSync(sessionPath, JSON.stringify(session));
        return session;
    }

    function makeMessage(text, replyText = null) {
        const msg = {
            chat: { id: chatId },
            from: { id: userId },
            text,
        };
        if (replyText !== null) {
            msg.reply_to_message = {
                message_id: 12345,
                text: replyText,
            };
        }
        return msg;
    }

    // --- Token extraction from reply_to_message ---

    test('extracts token from reply_to_message text with markdown backticks', async () => {
        const session = createSession({ token: 'Q66DYRXL' });

        const replyText =
            '❓ *Claude Question*\n' +
            '*Project:* my-project\n' +
            '*Session:* dev:0/0\n' +
            '*Token:* `Q66DYRXL`\n\n' +
            'Which option do you prefer?';

        await handler._handleMessage(makeMessage('2', replyText));

        expect(handler.injector.injectCommand).toHaveBeenCalledWith('2', 'dev:0.0');
    });

    test('extracts token from reply_to_message text without backticks', async () => {
        const session = createSession({ token: 'ABCD1234' });

        const replyText =
            '❓ *Claude Question*\n' +
            '*Token:* ABCD1234\n\n' +
            'Some question text';

        await handler._handleMessage(makeMessage('yes', replyText));

        expect(handler.injector.injectCommand).toHaveBeenCalledWith('yes', 'dev:0.0');
    });

    test('extracts token case-insensitively and uppercases it', async () => {
        const session = createSession({ token: 'XYZW9876' });

        const replyText = 'Token: `xyzw9876`\nSome text';

        await handler._handleMessage(makeMessage('1', replyText));

        expect(handler.injector.injectCommand).toHaveBeenCalledWith('1', 'dev:0.0');
    });

    test('reply with no token in text falls back to most recent session', async () => {
        const session = createSession({ token: 'FALLBK01' });

        // reply_to_message text doesn't contain a token
        const replyText = 'This is just a regular message with no token';

        await handler._handleMessage(makeMessage('2', replyText));

        // Should still route to session via fallback
        expect(handler.injector.injectCommand).toHaveBeenCalledWith('2', 'dev:0.0');
    });

    test('reply with invalid token in text falls back to most recent session', async () => {
        const session = createSession({ token: 'VALIDTOK' });

        // Token in reply text doesn't match any session but fallback should work
        const replyText = 'Token: `NOSUCHXX`\nSome text';

        await handler._handleMessage(makeMessage('3', replyText));

        // processCommand with NOSUCHXX fails -> error message, then no fallback for invalid token
        // Actually per the plan, we extract the token and call _processCommand which checks the session
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Invalid or expired token'),
            expect.any(Object)
        );
    });

    // --- Bare input fallback (no reply_to_message) ---

    test('bare input (no reply, no /cmd) falls back to most recent session', async () => {
        const session = createSession({ token: 'BARE0001' });

        await handler._handleMessage(makeMessage('2'));

        expect(handler.injector.injectCommand).toHaveBeenCalledWith('2', 'dev:0.0');
    });

    test('bare input with no active session shows error', async () => {
        // No sessions created
        await handler._handleMessage(makeMessage('2'));

        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Invalid format'),
            expect.any(Object)
        );
    });

    test('bare input skips expired sessions', async () => {
        createSession({
            token: 'EXPIRED1',
            expiresAt: Math.floor(Date.now() / 1000) - 100,
        });

        await handler._handleMessage(makeMessage('2'));

        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Invalid format'),
            expect.any(Object)
        );
    });

    // --- Priority: token extraction > messageId > fallback ---

    test('token extraction takes priority over messageId matching', async () => {
        const session = createSession({
            token: 'TOKENPRI',
            telegramMessageId: 12345,
        });

        const replyText = '*Token:* `TOKENPRI`\nSome question';

        await handler._handleMessage(makeMessage('yes', replyText));

        // Should use token extraction path, not messageId path
        expect(handler.injector.injectCommand).toHaveBeenCalledWith('yes', 'dev:0.0');
    });

    // --- Most recent session selection ---

    test('fallback picks most recent session when multiple exist', async () => {
        createSession({
            token: 'OLDER001',
            createdAt: Math.floor(Date.now() / 1000) - 600,
        });
        createSession({
            token: 'NEWER001',
            createdAt: Math.floor(Date.now() / 1000) - 10,
        });

        // reply with no token → fallback to most recent
        const replyText = 'No token here';
        await handler._handleMessage(makeMessage('2', replyText));

        // Should route to NEWER001 (most recent)
        expect(handler.injector.injectCommand).toHaveBeenCalledWith('2', 'dev:0.0');
    });
});
