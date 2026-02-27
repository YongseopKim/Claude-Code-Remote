/**
 * Tests for webhook _processCommand smart response integration
 * Verifies that parseQuestionReply is used to determine single vs two-step injection
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

// We need to mock ControllerInjector to spy on injectCommand and injectTwoStep
jest.mock('../src/utils/controller-injector', () => {
    return jest.fn().mockImplementation(() => ({
        injectCommand: jest.fn().mockResolvedValue(undefined),
        injectTwoStep: jest.fn().mockResolvedValue(undefined),
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
        // Mock _sendMessage to avoid actual API calls
        handler._sendMessage = jest.fn().mockResolvedValue(undefined);

        // Ensure sessions dir exists
        if (!fs.existsSync(handler.sessionsDir)) {
            fs.mkdirSync(handler.sessionsDir, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up session files created during tests
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

    test('non-question session uses injectCommand with original command', async () => {
        createSession({ isUserQuestion: false });

        await handler._processCommand(chatId, token, 'analyze this code');

        expect(handler.injector.injectCommand).toHaveBeenCalledWith(
            'analyze this code',
            'mysession:0.0'
        );
        expect(handler.injector.injectTwoStep).not.toHaveBeenCalled();
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Command sent successfully'),
            expect.any(Object)
        );
    });

    test('question session with "N. text" matching typeOption uses injectTwoStep', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3, // typeOption = 4
        });

        await handler._processCommand(chatId, token, '4. custom request here');

        expect(handler.injector.injectTwoStep).toHaveBeenCalledWith(
            '4',
            'custom request here',
            'mysession:0.0'
        );
        expect(handler.injector.injectCommand).not.toHaveBeenCalled();
        // Confirmation message should show the two-step info
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('Option 4'),
            expect.any(Object)
        );
        expect(handler._sendMessage).toHaveBeenCalledWith(
            chatId,
            expect.stringContaining('custom request here'),
            expect.any(Object)
        );
    });

    test('question session with plain number uses injectCommand', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
        });

        await handler._processCommand(chatId, token, '2');

        expect(handler.injector.injectCommand).toHaveBeenCalledWith(
            '2',
            'mysession:0.0'
        );
        expect(handler.injector.injectTwoStep).not.toHaveBeenCalled();
    });

    test('question session with "N. text" where N != typeOption uses injectCommand with number only', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3, // typeOption = 4
        });

        await handler._processCommand(chatId, token, '2. some text');

        // parseQuestionReply returns { type: 'single', command: '2' } for non-matching N
        expect(handler.injector.injectCommand).toHaveBeenCalledWith(
            '2',
            'mysession:0.0'
        );
        expect(handler.injector.injectTwoStep).not.toHaveBeenCalled();
    });

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
        // No session created
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

    test('log message includes parsed type', async () => {
        createSession({
            isUserQuestion: true,
            questionOptionCount: 3,
        });

        const logSpy = jest.spyOn(handler.logger, 'info');

        await handler._processCommand(chatId, token, '4. hello world');

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('Type: twoStep')
        );
    });
});
