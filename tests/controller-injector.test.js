const ControllerInjector = require('../src/utils/controller-injector');

jest.mock('child_process', () => ({
    execSync: jest.fn(),
    spawn: jest.fn()
}));

const { execSync } = require('child_process');

describe('ControllerInjector', () => {
    let injector;

    beforeEach(() => {
        jest.clearAllMocks();
        injector = new ControllerInjector({
            mode: 'tmux',
            defaultSession: 'test-session'
        });
        injector._tmuxBinaryCache = '/usr/bin/tmux';
        injector._tmuxSocketCache = '/tmp/tmux-501/default';
    });

    describe('injectTwoStep', () => {
        test('sends step1 then step2 with delay', async () => {
            const calls = [];
            execSync.mockImplementation((cmd) => {
                calls.push(cmd);
            });

            await injector.injectTwoStep('4', 'custom text', 'test-session', 100);

            // has-session, step1 text, step1 Enter, step2 text, step2 Enter
            expect(calls.length).toBe(5);
            expect(calls[0]).toContain('has-session');
            expect(calls[1]).toContain("'4'");
            expect(calls[2]).toContain('Enter');
            expect(calls[3]).toContain("'custom text'");
            expect(calls[4]).toContain('Enter');
        });

        test('throws if tmux session not found', async () => {
            execSync.mockImplementation(() => {
                throw new Error('session not found');
            });

            await expect(
                injector.injectTwoStep('4', 'text', 'bad-session')
            ).rejects.toThrow('not found');
        });
    });
});
