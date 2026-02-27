const { getToolDisplayName } = require('../src/utils/tool-display-name');

describe('getToolDisplayName', () => {
    // 정적 매핑
    test('Glob -> Search', () => {
        expect(getToolDisplayName('Glob')).toBe('Search');
    });

    test('Grep -> Search Content', () => {
        expect(getToolDisplayName('Grep')).toBe('Search Content');
    });

    test('Bash -> Run Command', () => {
        expect(getToolDisplayName('Bash')).toBe('Run Command');
    });

    test('Edit -> Edit File', () => {
        expect(getToolDisplayName('Edit')).toBe('Edit File');
    });

    test('Write -> Write File', () => {
        expect(getToolDisplayName('Write')).toBe('Write File');
    });

    test('Read -> Read File', () => {
        expect(getToolDisplayName('Read')).toBe('Read File');
    });

    test('WebFetch -> Fetch URL', () => {
        expect(getToolDisplayName('WebFetch')).toBe('Fetch URL');
    });

    test('WebSearch -> Web Search', () => {
        expect(getToolDisplayName('WebSearch')).toBe('Web Search');
    });

    test('NotebookEdit -> Edit Notebook', () => {
        expect(getToolDisplayName('NotebookEdit')).toBe('Edit Notebook');
    });

    test('Task -> Launch Agent', () => {
        expect(getToolDisplayName('Task')).toBe('Launch Agent');
    });

    test('Skill -> Run Skill', () => {
        expect(getToolDisplayName('Skill')).toBe('Run Skill');
    });

    test('EnterPlanMode -> Enter Plan Mode', () => {
        expect(getToolDisplayName('EnterPlanMode')).toBe('Enter Plan Mode');
    });

    test('EnterWorktree -> Create Worktree', () => {
        expect(getToolDisplayName('EnterWorktree')).toBe('Create Worktree');
    });

    // MCP tool 파싱
    test('MCP playwright tool', () => {
        expect(getToolDisplayName('mcp__plugin_playwright_playwright__browser_click'))
            .toBe('Playwright: browser click');
    });

    test('MCP context7 tool', () => {
        expect(getToolDisplayName('mcp__plugin_context7_context7__query-docs'))
            .toBe('Context7: query-docs');
    });

    test('MCP episodic-memory tool', () => {
        expect(getToolDisplayName('mcp__plugin_episodic-memory_episodic-memory__search'))
            .toBe('Episodic-memory: search');
    });

    // Fallback
    test('unknown tool returns raw name', () => {
        expect(getToolDisplayName('SomeNewTool')).toBe('SomeNewTool');
    });

    test('empty string returns empty string', () => {
        expect(getToolDisplayName('')).toBe('');
    });

    test('AskUserQuestion is not mapped (handled separately)', () => {
        expect(getToolDisplayName('AskUserQuestion')).toBe('AskUserQuestion');
    });
});
