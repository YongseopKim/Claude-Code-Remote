const { buildPermissionData } = require('../src/utils/build-permission-data');

describe('buildPermissionData', () => {
    describe('AskUserQuestion handling', () => {
        const hookData = {
            tool_name: 'AskUserQuestion',
            tool_input: {
                questions: [{
                    question: 'Which approach do you prefer?',
                    header: 'Approach',
                    options: [
                        { label: 'Option A', description: 'First approach' },
                        { label: 'Option B', description: 'Second approach' },
                        { label: 'Option C', description: 'Third approach' },
                    ],
                    multiSelect: false
                }]
            },
            permission_suggestions: []
        };

        test('sets isUserQuestion to true', () => {
            const result = buildPermissionData(hookData);
            expect(result.isUserQuestion).toBe(true);
        });

        test('extracts question text as permissionMessage', () => {
            const result = buildPermissionData(hookData);
            expect(result.permissionMessage).toBe('Which approach do you prefer?');
        });

        test('builds approvalOptions from question options', () => {
            const result = buildPermissionData(hookData);
            expect(result.approvalOptions[0]).toBe('Option A - First approach');
            expect(result.approvalOptions[1]).toBe('Option B - Second approach');
            expect(result.approvalOptions[2]).toBe('Option C - Third approach');
        });

        test('appends Type something and Chat about this', () => {
            const result = buildPermissionData(hookData);
            expect(result.approvalOptions[3]).toBe('Type something');
            expect(result.approvalOptions[4]).toBe('Chat about this');
        });

        test('sets questionOptionCount to number of defined options', () => {
            const result = buildPermissionData(hookData);
            expect(result.questionOptionCount).toBe(3);
        });

        test('handles options without description', () => {
            const data = {
                ...hookData,
                tool_input: {
                    questions: [{
                        question: 'Pick one',
                        options: [
                            { label: 'Yes' },
                            { label: 'No' },
                        ],
                        multiSelect: false
                    }]
                }
            };
            const result = buildPermissionData(data);
            expect(result.approvalOptions[0]).toBe('Yes');
            expect(result.approvalOptions[1]).toBe('No');
        });

        test('handles empty questions array', () => {
            const data = {
                tool_name: 'AskUserQuestion',
                tool_input: { questions: [] },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.isUserQuestion).toBe(true);
            expect(result.permissionMessage).toBe('Question from Claude');
            expect(result.approvalOptions).toEqual([
                'Type something', 'Chat about this'
            ]);
        });

        test('handles missing questions field', () => {
            const data = {
                tool_name: 'AskUserQuestion',
                tool_input: {},
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.isUserQuestion).toBe(true);
            expect(result.permissionMessage).toBe('Question from Claude');
        });

        test('includes questionOptions with label and description', () => {
            const result = buildPermissionData(hookData);
            expect(result.questionOptions).toEqual([
                { label: 'Option A', description: 'First approach' },
                { label: 'Option B', description: 'Second approach' },
                { label: 'Option C', description: 'Third approach' },
            ]);
        });

        test('questionOptions handles options without description', () => {
            const data = {
                tool_name: 'AskUserQuestion',
                tool_input: {
                    questions: [{
                        question: 'Pick one',
                        options: [{ label: 'Yes' }, { label: 'No' }],
                    }]
                },
            };
            const result = buildPermissionData(data);
            expect(result.questionOptions).toEqual([
                { label: 'Yes', description: '' },
                { label: 'No', description: '' },
            ]);
        });

        test('includes allQuestions for multi-question support', () => {
            const data = {
                tool_name: 'AskUserQuestion',
                tool_input: {
                    questions: [
                        { question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
                        { question: 'Q2?', options: [{ label: 'X' }, { label: 'Y' }] },
                    ],
                },
            };
            const result = buildPermissionData(data);
            expect(result.allQuestions).toHaveLength(2);
            expect(result.allQuestions[0].question).toBe('Q1?');
            expect(result.allQuestions[0].options).toEqual([{ label: 'A' }, { label: 'B' }]);
            expect(result.allQuestions[1].question).toBe('Q2?');
        });

        test('empty questions array gives empty questionOptions and allQuestions', () => {
            const data = {
                tool_name: 'AskUserQuestion',
                tool_input: { questions: [] },
            };
            const result = buildPermissionData(data);
            expect(result.questionOptions).toEqual([]);
            expect(result.allQuestions).toEqual([]);
        });
    });

    describe('regular tool handling', () => {
        test('Bash tool shows display name and command detail', () => {
            const data = {
                tool_name: 'Bash',
                tool_input: { command: 'npm install express' },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.isUserQuestion).toBeFalsy();
            expect(result.permissionMessage).toBe(
                'Permission to use Run Command\n\nnpm install express'
            );
        });

        test('Glob tool shows Search display name and pattern', () => {
            const data = {
                tool_name: 'Glob',
                tool_input: { pattern: '**/*.js', path: '/Users/test' },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.permissionMessage).toContain('Permission to use Search');
            expect(result.permissionMessage).toContain('**/*.js');
        });

        test('Edit tool shows file path', () => {
            const data = {
                tool_name: 'Edit',
                tool_input: { file_path: '/src/index.js' },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.permissionMessage).toContain('Permission to use Edit File');
            expect(result.permissionMessage).toContain('File: /src/index.js');
        });

        test('MCP tool shows parsed display name', () => {
            const data = {
                tool_name: 'mcp__plugin_playwright_playwright__browser_click',
                tool_input: { ref: 'button1' },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.permissionMessage).toContain(
                'Permission to use Playwright: browser click'
            );
        });

        test('truncates long command detail at 300 chars', () => {
            const longCmd = 'x'.repeat(400);
            const data = {
                tool_name: 'Bash',
                tool_input: { command: longCmd },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.permissionMessage.length).toBeLessThan(350);
            expect(result.permissionMessage).toContain('...');
        });

        test('builds approvalOptions from permission_suggestions', () => {
            const data = {
                tool_name: 'Bash',
                tool_input: { command: 'ls' },
                permission_suggestions: [{
                    type: 'addRules',
                    rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }]
                }]
            };
            const result = buildPermissionData(data);
            expect(result.approvalOptions[0]).toBe('Yes');
            expect(result.approvalOptions[1]).toContain("don't ask again");
            expect(result.approvalOptions[result.approvalOptions.length - 1]).toBe('No');
        });

        test('no tool_name falls back to message', () => {
            const data = {
                message: 'Custom permission message',
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.permissionMessage).toBe('Custom permission message');
        });

        test('generates fallback "don\'t ask again" when permission_suggestions missing', () => {
            const data = {
                tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
                tool_input: { url: 'http://localhost:8080' }
            };
            const result = buildPermissionData(data);
            expect(result.approvalOptions).toHaveLength(3);
            expect(result.approvalOptions[0]).toBe('Yes');
            expect(result.approvalOptions[1]).toContain("don't ask again");
            expect(result.approvalOptions[1]).toContain('Playwright: browser navigate');
            expect(result.approvalOptions[2]).toBe('No');
        });

        test('generates fallback "don\'t ask again" when permission_suggestions is empty array', () => {
            const data = {
                tool_name: 'Bash',
                tool_input: { command: 'npm test' },
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.approvalOptions).toHaveLength(3);
            expect(result.approvalOptions[0]).toBe('Yes');
            expect(result.approvalOptions[1]).toContain("don't ask again");
            expect(result.approvalOptions[1]).toContain('Run Command');
            expect(result.approvalOptions[2]).toBe('No');
        });

        test('no fallback when no tool_name and no suggestions', () => {
            const data = {
                message: 'Some permission',
                permission_suggestions: []
            };
            const result = buildPermissionData(data);
            expect(result.approvalOptions).toEqual(['Yes', 'No']);
        });
    });
});
