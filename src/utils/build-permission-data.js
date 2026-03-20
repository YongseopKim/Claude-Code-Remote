/**
 * Build permission notification data from hook data
 * Extracts tool-specific details and formats for display
 */

const { getToolDisplayName } = require('./tool-display-name');

function buildPermissionData(hookData) {
    if (hookData.tool_name === 'AskUserQuestion') {
        return _buildAskUserQuestionData(hookData);
    }
    return _buildToolPermissionData(hookData);
}

function _buildAskUserQuestionData(hookData) {
    const questions = hookData.tool_input?.questions || [];
    const q = questions[0];

    let permissionMessage = 'Question from Claude';
    const approvalOptions = [];
    let questionOptionCount = 0;
    const questionOptions = [];

    if (q) {
        permissionMessage = q.question || 'Question from Claude';

        if (q.options && Array.isArray(q.options)) {
            for (const opt of q.options) {
                let text = opt.label;
                if (opt.description) text += ` - ${opt.description}`;
                approvalOptions.push(text);
                questionOptions.push({ label: opt.label, description: opt.description || '' });
            }
            questionOptionCount = q.options.length;
        }
    }

    approvalOptions.push('Type something');
    approvalOptions.push('Chat about this');

    const allQuestions = questions.map(q => ({
        question: q.question || '',
        options: q.options || [],
    }));

    return {
        permissionMessage,
        approvalOptions,
        isUserQuestion: true,
        questionOptionCount,
        questionOptions,
        allQuestions,
    };
}

function _buildToolPermissionData(hookData) {
    let permissionMessage = hookData.message || 'Permission required';

    if (hookData.tool_name) {
        const toolName = hookData.tool_name;
        const toolInput = hookData.tool_input || {};
        const displayName = getToolDisplayName(toolName);
        let detail = '';

        if (toolName === 'Bash' && toolInput.command) {
            detail = toolInput.command;
        } else if (
            (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read')
            && toolInput.file_path
        ) {
            detail = `File: ${toolInput.file_path}`;
        } else if (toolName === 'Glob' && toolInput.pattern) {
            detail = toolInput.pattern;
            if (toolInput.path) detail += ` (in ${toolInput.path})`;
        } else if (toolName === 'Grep' && toolInput.pattern) {
            detail = `Pattern: ${toolInput.pattern}`;
            if (toolInput.path) detail += ` (in ${toolInput.path})`;
        } else if (toolInput.command || toolInput.file_path || toolInput.url) {
            detail = toolInput.command || toolInput.file_path || toolInput.url;
        } else {
            const vals = Object.values(toolInput)
                .filter(v => typeof v === 'string' && v.length > 0);
            if (vals.length > 0) detail = vals[0];
        }

        permissionMessage = `Permission to use ${displayName}`;
        if (detail) {
            if (detail.length > 300) detail = detail.substring(0, 297) + '...';
            permissionMessage += `\n\n${detail}`;
        }
    }

    const approvalOptions = ['Yes'];
    const suggestions = hookData.permission_suggestions;
    if (suggestions && Array.isArray(suggestions) && suggestions.length > 0) {
        for (const suggestion of suggestions) {
            if (suggestion.type === 'addRules' && Array.isArray(suggestion.rules)) {
                const parts = suggestion.rules
                    .filter(r => r.toolName && r.ruleContent)
                    .map(r => `${r.toolName}(${r.ruleContent}:*)`);
                if (parts.length > 0) {
                    approvalOptions.push(
                        `Yes, and don't ask again for: ${parts.join(', ')}`
                    );
                }
            }
        }
    } else if (hookData.tool_name) {
        // Fallback: Claude Code may not pass permission_suggestions in hookData.
        // Construct "don't ask again" option from tool_name to match terminal UI.
        const displayName = getToolDisplayName(hookData.tool_name);
        approvalOptions.push(`Yes, and don't ask again for ${displayName}`);
    }
    approvalOptions.push('No');

    return { permissionMessage, approvalOptions };
}

module.exports = { buildPermissionData };
