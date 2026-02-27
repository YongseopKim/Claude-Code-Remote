/**
 * Parse a Telegram reply to an AskUserQuestion notification
 * Determines if a single or two-step tmux injection is needed
 */

function parseQuestionReply(command, session) {
    if (!session.isUserQuestion) {
        return { type: 'single', command };
    }

    const typeOptionNumber = (session.questionOptionCount || 0) + 1;

    // Check for "N. text" pattern (number, dot, space, then text)
    const match = command.match(/^(\d+)\.\s+(.+)$/s);
    if (match) {
        const optionNum = parseInt(match[1], 10);
        const text = match[2].trim();

        if (optionNum === typeOptionNumber && text) {
            return { type: 'twoStep', step1: String(optionNum), step2: text };
        }

        return { type: 'single', command: String(optionNum) };
    }

    return { type: 'single', command };
}

module.exports = { parseQuestionReply };
