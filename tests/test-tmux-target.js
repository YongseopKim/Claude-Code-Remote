#!/usr/bin/env node

/**
 * Tests for tmux target utilities (session:window.pane format)
 */

const assert = require('assert');

// Import the module under test
const { getCurrentTmuxTarget, extractSessionName } = require('../src/utils/tmux-utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`  ❌ ${name}: ${error.message}`);
        failed++;
    }
}

console.log('\n🧪 tmux-utils unit tests\n');

// --- extractSessionName tests ---

console.log('extractSessionName():');

test('extracts session name from full target "mac-dev:0.1"', () => {
    assert.strictEqual(extractSessionName('mac-dev:0.1'), 'mac-dev');
});

test('extracts session name from target with window only "mac-dev:2"', () => {
    assert.strictEqual(extractSessionName('mac-dev:2'), 'mac-dev');
});

test('returns session name as-is when no colon (backward compat)', () => {
    assert.strictEqual(extractSessionName('mac-dev'), 'mac-dev');
});

test('handles session name with hyphens "my-long-session:0.0"', () => {
    assert.strictEqual(extractSessionName('my-long-session:0.0'), 'my-long-session');
});

test('handles empty string', () => {
    assert.strictEqual(extractSessionName(''), '');
});

test('handles null/undefined gracefully', () => {
    assert.strictEqual(extractSessionName(null), '');
    assert.strictEqual(extractSessionName(undefined), '');
});

// --- getCurrentTmuxTarget tests ---

console.log('\ngetCurrentTmuxTarget():');

test('returns a string or null', () => {
    const result = getCurrentTmuxTarget();
    assert.ok(result === null || typeof result === 'string',
        `Expected string or null, got ${typeof result}`);
});

test('if in tmux, result contains session:window.pane format', () => {
    const result = getCurrentTmuxTarget();
    if (result !== null) {
        // Should match pattern like "session-name:N.N"
        assert.ok(/^.+:\d+\.\d+$/.test(result),
            `Expected "session:window.pane" format, got "${result}"`);
    }
    // If not in tmux, null is acceptable
});

// --- Module loading tests (integration) ---

console.log('\nModule loading (all modified files):');

test('tmux-utils loads', () => {
    require('../src/utils/tmux-utils');
});

test('controller-injector loads with tmux-utils dependency', () => {
    require('../src/utils/controller-injector');
});

test('tmux-monitor loads with tmux-utils dependency', () => {
    require('../src/utils/tmux-monitor');
});

test('tmux-injector loads with tmux-utils dependency', () => {
    require('../src/relay/tmux-injector');
});

test('telegram channel loads with tmux-utils dependency', () => {
    require('../src/channels/telegram/telegram');
});

test('telegram webhook loads with tmux-utils dependency', () => {
    require('../src/channels/telegram/webhook');
});

// --- extractSessionName used in consumer context ---

console.log('\nConsumer context tests:');

test('extractSessionName works for controller-injector has-session scenario', () => {
    // Simulates what controller-injector does: extract session for has-session
    const fullTarget = 'mac-dev:1.0';
    const sessionOnly = extractSessionName(fullTarget);
    assert.strictEqual(sessionOnly, 'mac-dev');
    // has-session would use "mac-dev", send-keys would use "mac-dev:1.0"
});

test('extractSessionName preserves backward compat for old-style session names', () => {
    // Old clients might still send just session name without window.pane
    const oldStyle = 'claude-real';
    const sessionOnly = extractSessionName(oldStyle);
    assert.strictEqual(sessionOnly, 'claude-real');
});

test('display session extraction for telegram messages', () => {
    // Simulates what telegram.js _generateTelegramMessage does
    const tmuxTarget = 'mac-dev:2.0';
    const displaySession = extractSessionName(tmuxTarget) || tmuxTarget;
    assert.strictEqual(displaySession, 'mac-dev');
});

// --- Summary ---
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
