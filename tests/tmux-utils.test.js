/**
 * Jest tests for tmux-utils.js
 * Tests getCurrentTmuxTarget() priority: TMUX_PANE first, display-message fallback
 */

// Mock child_process before requiring the module
jest.mock('child_process', () => ({
    spawnSync: jest.fn(),
}));

const { spawnSync } = require('child_process');

// Fresh require for each test to reset module state
let tmuxUtils;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Re-mock child_process after resetModules
    jest.mock('child_process', () => ({
        spawnSync: jest.fn(),
    }));
});

function requireFresh() {
    // Must re-require after resetModules
    const cp = require('child_process');
    const mod = require('../src/utils/tmux-utils');
    return { spawnSync: cp.spawnSync, mod };
}

describe('getCurrentTmuxTarget()', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('TMUX_PANE이 설정되면 list-panes 결과를 우선 반환한다', () => {
        process.env.TMUX_PANE = '%5';

        const { spawnSync, mod } = requireFresh();

        // list-panes가 성공적으로 반환
        spawnSync.mockImplementation((cmd, args) => {
            if (cmd === 'tmux' && args[0] === 'list-panes') {
                return { status: 0, stdout: 'mac-dev:3.1\n' };
            }
            return { status: 1, stdout: '' };
        });

        const result = mod.getCurrentTmuxTarget();

        expect(result).toBe('mac-dev:3.1');
        // display-message는 호출되지 않아야 함
        const displayCalls = spawnSync.mock.calls.filter(
            ([cmd, args]) => cmd === 'tmux' && args && args[0] === 'display-message'
        );
        expect(displayCalls).toHaveLength(0);
    });

    test('TMUX_PANE이 없으면 display-message fallback을 사용한다', () => {
        delete process.env.TMUX_PANE;

        const { spawnSync, mod } = requireFresh();

        spawnSync.mockImplementation((cmd, args) => {
            if (cmd === 'tmux' && args[0] === 'display-message') {
                return { status: 0, stdout: 'mac-dev:1.0\n' };
            }
            return { status: 1, stdout: '' };
        });

        const result = mod.getCurrentTmuxTarget();

        expect(result).toBe('mac-dev:1.0');
    });

    test('TMUX_PANE의 list-panes가 실패하면 display-message fallback을 사용한다', () => {
        process.env.TMUX_PANE = '%5';

        const { spawnSync, mod } = requireFresh();

        spawnSync.mockImplementation((cmd, args) => {
            if (cmd === 'tmux' && args[0] === 'list-panes') {
                return { status: 1, stdout: '' };
            }
            if (cmd === 'bash') {
                // bash -c fallback for list-panes also fails
                if (args && args[1] && args[1].includes('list-panes')) {
                    return { status: 1, stdout: '' };
                }
                // bash -c fallback for display-message
                if (args && args[1] && args[1].includes('display-message')) {
                    return { status: 0, stdout: 'mac-dev:2.0\n' };
                }
            }
            if (cmd === 'tmux' && args[0] === 'display-message') {
                return { status: 0, stdout: 'mac-dev:2.0\n' };
            }
            return { status: 1, stdout: '' };
        });

        const result = mod.getCurrentTmuxTarget();

        expect(result).toBe('mac-dev:2.0');
    });

    test('둘 다 실패하면 null을 반환한다', () => {
        delete process.env.TMUX_PANE;

        const { spawnSync, mod } = requireFresh();

        spawnSync.mockImplementation(() => {
            return { status: 1, stdout: '' };
        });

        const result = mod.getCurrentTmuxTarget();

        expect(result).toBeNull();
    });

    test('TMUX_PANE과 display-message 모두 실패하면 null을 반환한다', () => {
        process.env.TMUX_PANE = '%5';

        const { spawnSync, mod } = requireFresh();

        spawnSync.mockImplementation(() => {
            return { status: 1, stdout: '' };
        });

        const result = mod.getCurrentTmuxTarget();

        expect(result).toBeNull();
    });
});

describe('extractSessionName()', () => {
    test('full target에서 세션명을 추출한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractSessionName('mac-dev:0.1')).toBe('mac-dev');
    });

    test('window만 있는 target에서 세션명을 추출한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractSessionName('mac-dev:2')).toBe('mac-dev');
    });

    test('세션명만 있으면 그대로 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractSessionName('mac-dev')).toBe('mac-dev');
    });

    test('null/undefined는 빈 문자열을 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractSessionName(null)).toBe('');
        expect(mod.extractSessionName(undefined)).toBe('');
    });

    test('빈 문자열은 빈 문자열을 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractSessionName('')).toBe('');
    });
});
