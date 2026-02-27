const { parseQuestionReply } = require('../src/utils/parse-question-reply');

describe('parseQuestionReply', () => {
    describe('non-question sessions (unchanged behavior)', () => {
        test('plain number -> single step', () => {
            const result = parseQuestionReply('2', { isUserQuestion: false });
            expect(result).toEqual({ type: 'single', command: '2' });
        });

        test('free text -> single step', () => {
            const result = parseQuestionReply('analyze this code', {
                isUserQuestion: false
            });
            expect(result).toEqual({ type: 'single', command: 'analyze this code' });
        });

        test('"y" shortcut -> single step', () => {
            const result = parseQuestionReply('y', { isUserQuestion: false });
            expect(result).toEqual({ type: 'single', command: 'y' });
        });
    });

    describe('question sessions with questionOptions (dismiss-inject)', () => {
        const session = {
            isUserQuestion: true,
            questionOptionCount: 3,
            questionOptions: [
                { label: 'Python', description: 'General purpose' },
                { label: 'JavaScript', description: 'Web dev' },
                { label: 'TypeScript', description: 'Type safe JS' },
            ],
        };

        test('option number maps to label', () => {
            const result = parseQuestionReply('1', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'Python' });
        });

        test('option number 2 maps to second label', () => {
            const result = parseQuestionReply('2', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'JavaScript' });
        });

        test('option number 3 maps to third label', () => {
            const result = parseQuestionReply('3', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'TypeScript' });
        });

        test('"N. text" where N = typeOption extracts custom text', () => {
            // typeOption = 3 + 1 = 4
            const result = parseQuestionReply('4. I prefer Rust', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'I prefer Rust' });
        });

        test('"N. text" where N != typeOption uses number as label lookup', () => {
            const result = parseQuestionReply('2. some text', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'JavaScript' });
        });

        test('out-of-range number passes through as-is', () => {
            const result = parseQuestionReply('99', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: '99' });
        });

        test('chat option number passes through', () => {
            // chatOption = 3 + 2 = 5
            const result = parseQuestionReply('5', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: '5' });
        });

        test('free text returns as dismiss-inject answer', () => {
            const result = parseQuestionReply('just do whatever', session);
            expect(result).toEqual({ type: 'dismiss-inject', answer: 'just do whatever' });
        });
    });

    describe('question sessions without questionOptions (backward compat)', () => {
        const session = { isUserQuestion: true, questionOptionCount: 3 };

        test('plain number -> single step', () => {
            const result = parseQuestionReply('1', session);
            expect(result).toEqual({ type: 'single', command: '1' });
        });

        test('"N. text" where N = typeOption -> two step', () => {
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

        test('free text -> single step', () => {
            const result = parseQuestionReply('just some text', session);
            expect(result).toEqual({ type: 'single', command: 'just some text' });
        });

        test('handles questionOptionCount of 0', () => {
            const emptySession = { isUserQuestion: true, questionOptionCount: 0 };
            const result = parseQuestionReply('1. hello', emptySession);
            expect(result).toEqual({ type: 'twoStep', step1: '1', step2: 'hello' });
        });
    });
});
