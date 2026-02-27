/**
 * Tests for ControllerInjector.dismissAndInject
 * Verifies Escape dismiss + answer text injection flow
 */

jest.mock('child_process', () => ({
    execSync: jest.fn(),
    spawn: jest.fn(),
}));

const { execSync } = require('child_process');
const ControllerInjector = require('../src/utils/controller-injector');

describe('dismissAndInject', () => {
    let injector;

    beforeEach(() => {
        jest.clearAllMocks();
        injector = new ControllerInjector({ mode: 'tmux' });
        injector._findTmuxBinary = () => '/opt/homebrew/bin/tmux';
        injector._findTmuxSocket = () => '/tmp/tmux-501/default';
        execSync.mockReturnValue('');
    });

    test('sends Escape then injects answer text', async () => {
        await injector.dismissAndInject('JavaScript', 'mysession:0.0');

        const calls = execSync.mock.calls.map(c => c[0]);
        // 1. has-session check
        expect(calls[0]).toContain('has-session -t mysession');
        // 2. Escape to dismiss TUI
        expect(calls[1]).toContain('send-keys -t mysession:0.0 Escape');
        // 3. Inject answer text
        expect(calls[2]).toContain('send-keys -t mysession:0.0');
        expect(calls[2]).toContain('JavaScript');
        // 4. Enter to submit
        expect(calls[3]).toContain('send-keys -t mysession:0.0 Enter');
    });

    test('escapes single quotes in answer text', async () => {
        await injector.dismissAndInject("it's great", 'mysession:0.0');

        const calls = execSync.mock.calls.map(c => c[0]);
        // Answer injection should have escaped quote
        expect(calls[2]).toContain("it'\\''s great");
    });

    test('uses default session when none specified', async () => {
        injector.defaultSession = 'default-session';

        await injector.dismissAndInject('Python');

        const calls = execSync.mock.calls.map(c => c[0]);
        expect(calls[1]).toContain('send-keys -t default-session Escape');
    });

    test('throws if tmux session not found', async () => {
        execSync.mockImplementation(() => { throw new Error('no session'); });

        await expect(injector.dismissAndInject('test', 'bad:0.0'))
            .rejects.toThrow('not found');
    });

    test('respects custom delay', async () => {
        const start = Date.now();
        await injector.dismissAndInject('test', 'mysession:0.0', 100);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(90);
        expect(elapsed).toBeLessThan(500);
    });
});
