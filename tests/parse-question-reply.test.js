const { parseQuestionReply } = require('../src/utils/parse-question-reply');

describe('parseQuestionReply', () => {
    const session = { isUserQuestion: true, questionOptionCount: 3 };

    test('plain number for question session -> single step', () => {
        const result = parseQuestionReply('1', session);
        expect(result).toEqual({ type: 'single', command: '1' });
    });

    test('plain number for non-question session -> single step', () => {
        const result = parseQuestionReply('2', { isUserQuestion: false });
        expect(result).toEqual({ type: 'single', command: '2' });
    });

    test('"N. text" where N = typeOption -> two step', () => {
        // typeOptionNumber = 3 + 1 = 4
        const result = parseQuestionReply('4. custom request here', session);
        expect(result).toEqual({
            type: 'twoStep',
            step1: '4',
            step2: 'custom request here'
        });
    });

    test('"N. text" where N != typeOption -> single step number only', () => {
        const result = parseQuestionReply('2. some text', session);
        expect(result).toEqual({ type: 'single', command: '2' });
    });

    test('chat about this option (last) -> single step', () => {
        // chatOption = 3 + 2 = 5
        const result = parseQuestionReply('5', session);
        expect(result).toEqual({ type: 'single', command: '5' });
    });

    test('free text for question session -> single step', () => {
        const result = parseQuestionReply('just some text', session);
        expect(result).toEqual({ type: 'single', command: 'just some text' });
    });

    test('free text for non-question session -> single step', () => {
        const result = parseQuestionReply('analyze this code', {
            isUserQuestion: false
        });
        expect(result).toEqual({ type: 'single', command: 'analyze this code' });
    });

    test('"y" shortcut for non-question session -> single step', () => {
        const result = parseQuestionReply('y', { isUserQuestion: false });
        expect(result).toEqual({ type: 'single', command: 'y' });
    });

    test('handles questionOptionCount of 0', () => {
        const emptySession = { isUserQuestion: true, questionOptionCount: 0 };
        // typeOption = 0 + 1 = 1
        const result = parseQuestionReply('1. hello', emptySession);
        expect(result).toEqual({ type: 'twoStep', step1: '1', step2: 'hello' });
    });
});
