/**
 * Tool display name mapping
 * Converts internal tool names to user-friendly display names
 */

const toolDisplayNames = {
    'Glob': 'Search',
    'Grep': 'Search Content',
    'Read': 'Read File',
    'Write': 'Write File',
    'Edit': 'Edit File',
    'Bash': 'Run Command',
    'WebFetch': 'Fetch URL',
    'WebSearch': 'Web Search',
    'NotebookEdit': 'Edit Notebook',
    'Task': 'Launch Agent',
    'Skill': 'Run Skill',
    'EnterPlanMode': 'Enter Plan Mode',
    'EnterWorktree': 'Create Worktree',
};

function getToolDisplayName(toolName) {
    if (!toolName) return toolName;
    if (toolDisplayNames[toolName]) return toolDisplayNames[toolName];

    // MCP tool pattern: mcp__plugin_{plugin}_{server}__{action}
    const mcpMatch = toolName.match(
        /^mcp__plugin_([^_]+(?:-[^_]+)*)_[^_]+(?:-[^_]+)*__(.+)$/
    );
    if (mcpMatch) {
        const plugin = mcpMatch[1].charAt(0).toUpperCase() + mcpMatch[1].slice(1);
        const action = mcpMatch[2].replace(/_/g, ' ');
        return `${plugin}: ${action}`;
    }

    return toolName;
}

module.exports = { getToolDisplayName, toolDisplayNames };
