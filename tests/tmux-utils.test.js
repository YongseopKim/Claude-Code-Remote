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

describe('extractWindowTarget()', () => {
    test('full target에서 window target을 추출한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractWindowTarget('mac-dev:3.1')).toBe('mac-dev:3');
    });

    test('pane이 없는 target은 그대로 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractWindowTarget('mac-dev:3')).toBe('mac-dev:3');
    });

    test('세션명만 있으면 그대로 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractWindowTarget('mac-dev')).toBe('mac-dev');
    });

    test('null/undefined는 빈 문자열을 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractWindowTarget(null)).toBe('');
        expect(mod.extractWindowTarget(undefined)).toBe('');
    });

    test('두 자리 pane 번호도 처리한다', () => {
        const { mod } = requireFresh();
        expect(mod.extractWindowTarget('dev:0.12')).toBe('dev:0');
    });
});

describe('tmuxRun()', () => {
    test('성공하면 true를 반환한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 0 });

        expect(mod.tmuxRun(['set-window-option', '-t', 'dev:3', 'window-status-style', 'bg=red'])).toBe(true);
        expect(spawnSync).toHaveBeenCalledWith('tmux',
            ['set-window-option', '-t', 'dev:3', 'window-status-style', 'bg=red'],
            expect.objectContaining({ timeout: 3000 })
        );
    });

    test('직접 실행 실패 시 bash fallback을 시도한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync
            .mockReturnValueOnce({ status: 1 })   // direct attempt fails
            .mockReturnValueOnce({ status: 0 });   // bash fallback succeeds

        expect(mod.tmuxRun(['set-hook', '-g', 'after-select-window[99]', 'cmd'])).toBe(true);
    });

    test('모두 실패하면 false를 반환한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 1 });

        expect(mod.tmuxRun(['bad-command'])).toBe(false);
    });
});

describe('setWindowAlert()', () => {
    test('window-status-style과 window-status-current-style을 모두 설정한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 0 });

        const result = mod.setWindowAlert('mac-dev:3.1');

        expect(result).toBe(true);
        const setCalls = spawnSync.mock.calls.filter(
            ([cmd, args]) => cmd === 'tmux' && args[0] === 'set-window-option'
        );
        expect(setCalls.length).toBeGreaterThanOrEqual(2);
        expect(setCalls[0][1]).toEqual(
            expect.arrayContaining(['-t', 'mac-dev:3', 'window-status-style', 'bg=red,blink'])
        );
        expect(setCalls[1][1]).toEqual(
            expect.arrayContaining(['-t', 'mac-dev:3', 'window-status-current-style', 'bg=red,blink'])
        );
    });

    test('session-window-changed auto-clear hook을 두 개 등록한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 0 });

        mod.setWindowAlert('mac-dev:3.1');

        const hookCalls = spawnSync.mock.calls.filter(
            ([cmd, args]) => cmd === 'tmux' && args[0] === 'set-hook'
        );
        expect(hookCalls.length).toBeGreaterThanOrEqual(2);
        expect(hookCalls[0][1]).toEqual(
            expect.arrayContaining(['-g', 'session-window-changed[98]'])
        );
        expect(hookCalls[1][1]).toEqual(
            expect.arrayContaining(['-g', 'session-window-changed[99]'])
        );
        // if-shell로 window index 3을 체크하는지 확인
        expect(hookCalls[0][1][3]).toContain('#{==:#{window_index},3}');
        expect(hookCalls[1][1][3]).toContain('#{==:#{window_index},3}');
    });

    test('빈 target이면 false를 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.setWindowAlert('')).toBe(false);
        expect(mod.setWindowAlert(null)).toBe(false);
    });
});

describe('clearWindowAlert()', () => {
    test('window-status-style과 window-status-current-style을 모두 해제한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 0 });

        const result = mod.clearWindowAlert('mac-dev:3.1');

        expect(result).toBe(true);
        const setCalls = spawnSync.mock.calls.filter(
            ([cmd, args]) => cmd === 'tmux' && args[0] === 'set-window-option'
        );
        expect(setCalls.length).toBeGreaterThanOrEqual(2);
        expect(setCalls[0][1]).toEqual(
            expect.arrayContaining(['-t', 'mac-dev:3', '-u', 'window-status-style'])
        );
        expect(setCalls[1][1]).toEqual(
            expect.arrayContaining(['-t', 'mac-dev:3', '-u', 'window-status-current-style'])
        );
    });

    test('session-window-changed auto-clear hook도 정리한다', () => {
        const { spawnSync, mod } = requireFresh();
        spawnSync.mockReturnValue({ status: 0 });

        mod.clearWindowAlert('mac-dev:3.1');

        const hookCalls = spawnSync.mock.calls.filter(
            ([cmd, args]) => cmd === 'tmux' && args[0] === 'set-hook'
        );
        expect(hookCalls.length).toBeGreaterThanOrEqual(2);
        expect(hookCalls[0][1]).toEqual(
            expect.arrayContaining(['-ug', 'session-window-changed[98]'])
        );
        expect(hookCalls[1][1]).toEqual(
            expect.arrayContaining(['-ug', 'session-window-changed[99]'])
        );
    });

    test('빈 target이면 false를 반환한다', () => {
        const { mod } = requireFresh();
        expect(mod.clearWindowAlert('')).toBe(false);
        expect(mod.clearWindowAlert(null)).toBe(false);
    });
});
