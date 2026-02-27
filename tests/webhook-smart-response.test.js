/**
 * Tests for webhook _processCommand smart response integration
 * Verifies dismiss-inject for AskUserQuestion, and twoStep/single for legacy/non-question
 */
const path = require('path');
const fs = require('fs');

// Mock dependencies before requiring the module
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
const axios = require('axios');

describe('webhook _processCommand smart response integration', () => {
    let handler;
    const chatId = 12345;
    const token = 'ABCD1234';

    beforeEach(() => {
        handler = new TelegramWebhookHandler({ botToken: 'test-token' });
        handler._sendMessage = jest.fn().mockResolvedValue(undefined);

        if (!fs.existsSync(handler.sessionsDir)) {
            fs.mkdirSync(handler.sessionsDir, { recursive: true });
        }
    });

    afterEach(() => {
        const sessionFiles = fs.readdirSync(handler.sessionsDir)
            .filter(f => f.startsWith('test-'));
        for (const file of sessionFiles) {
            fs.unlinkSync(path.join(handler.sessionsDir, file));
        }
    });

    function createSession(overrides = {}) {
        const session = {
            id: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            token,
            tmuxSession: 'mysession:0.0',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            isUserQuestion: false,
            questionOptionCount: 0,
            ...overrides,
        };
        const sessionPath = path.join(handler.sessionsDir, `${session.id}.json`);
        fs.writeFileSync(sessionPath, JSON.stringify(session));
        return session;
    }

    // --- Non-question sessions (unchanged) ---

    test('non-question session uses injectCommand with original command', async () => {
        createSession({ isUserQuestion: false });

        await handler._processCommand(chatId, token, 'analyze this code');

        expect(handler.injector.injectCommand).toHaveBeenCalledWith(
            'analyze this code',
            'mysession:0.0'
        );
        expect(handler.injector.dismissAndInject).not.toHaveBeenCalled();
    });

    // --- Question sessions with questionOptions (dismiss-inject) ---

    test('question session with questionOptions uses dismissAndInject', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
            questionOptions: [
                { label: 'Python' },
                { label: 'JavaScript' },
                { label: 'TypeScript' },
            ],
        });

        await handler._processCommand(chatId, token, '2');

        expect(handler.injector.dismissAndInject).toHaveBeenCalledWith(
            'JavaScript', 'mysession:0.0'
        );
        expect(handler.injector.injectCommand).not.toHaveBeenCalled();
        expect(handler.injector.injectTwoStep).not.toHaveBeenCalled();
    });

    test('question session custom text uses dismissAndInject', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
            questionOptions: [
                { label: 'Python' },
                { label: 'JavaScript' },
                { label: 'TypeScript' },
            ],
        });

        await handler._processCommand(chatId, token, '4. I prefer Rust');

        expect(handler.injector.dismissAndInject).toHaveBeenCalledWith(
            'I prefer Rust', 'mysession:0.0'
        );
    });

    test('question session free text uses dismissAndInject', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
            questionOptions: [
                { label: 'Python' },
                { label: 'JavaScript' },
                { label: 'TypeScript' },
            ],
        });

        await handler._processCommand(chatId, token, 'just use whatever');

        expect(handler.injector.dismissAndInject).toHaveBeenCalledWith(
            'just use whatever', 'mysession:0.0'
        );
    });

    // --- Legacy question sessions (no questionOptions, backward compat) ---

    test('legacy question session with "N. text" matching typeOption uses injectTwoStep', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
        });

        await handler._processCommand(chatId, token, '4. custom request here');

        expect(handler.injector.injectTwoStep).toHaveBeenCalledWith(
            '4',
            'custom request here',
            'mysession:0.0'
        );
    });

    test('legacy question session with plain number uses injectCommand', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
        });

        await handler._processCommand(chatId, token, '2');

        expect(handler.injector.injectCommand).toHaveBeenCalledWith(
            '2',
            'mysession:0.0'
        );
    });

    // --- Error cases ---

    test('expired session returns error message', async () => {
        createSession({ expiresAt: Math.floor(Date.now() / 1000) - 100 });

        await handler._processCommand(chatId, token, 'hello');

        expect(handler.injector.injectCommand).not.toHaveBeenCalled();
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('expired'),
            expect.any(Object)
        );
    });

    test('invalid token returns error message', async () => {
        await handler._processCommand(chatId, 'INVALID1', 'hello');

        expect(handler.injector.injectCommand).not.toHaveBeenCalled();
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Invalid or expired token'),
            expect.any(Object)
        );
    });

    test('injection failure sends error message', async () => {
        createSession({ isUserQuestion: false });
        handler.injector.injectCommand.mockRejectedValueOnce(
            new Error('tmux session not found')
        );

        await handler._processCommand(chatId, token, 'hello');

        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Command execution failed'),
            expect.any(Object)
        );
    });

    test('dismissAndInject failure sends error message', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 2,
            questionOptions: [{ label: 'A' }, { label: 'B' }],
        });
        handler.injector.dismissAndInject.mockRejectedValueOnce(
            new Error('tmux session not found')
        );

        await handler._processCommand(chatId, token, '1');

        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Command execution failed'),
            expect.any(Object)
        );
    });

    test('log message includes parsed type for dismiss-inject', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
            questionOptions: [
                { label: 'Python' },
                { label: 'JavaScript' },
                { label: 'TypeScript' },
            ],
        });

        const logSpy = jest.spyOn(handler.logger, 'info');

        await handler._processCommand(chatId, token, '2');

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('Type: dismiss-inject')
        );
    });

    // --- Full tmux target display ---

    test('success message shows full tmux target (not just session name)', async () => {
        createSession({
            isUserQuestion: false,
            tmuxSession: 'mac-dev:3.1',
        });

        await handler._processCommand(chatId, token, 'hello');

        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('mac-dev:3/1'),
            expect.any(Object)
        );
    });

    test('success message does not truncate pane info from target', async () => {
        createSession({
            isUserQuestion: false,
            tmuxSession: 'work:2.3',
        });

        await handler._processCommand(chatId, token, 'test');

        const sentMessage = handler._sendMessage.mock.calls.find(
            call => call[1].includes('Command sent successfully')
        );
        expect(sentMessage).toBeTruthy();
        expect(sentMessage[1]).toContain('work:2/3');
        // Should NOT contain just "work" without the pane info
        expect(sentMessage[1]).not.toMatch(/Session:\*\s+work\n/);
    });
});
