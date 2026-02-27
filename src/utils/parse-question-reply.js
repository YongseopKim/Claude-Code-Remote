/**
 * Parse a Telegram reply to an AskUserQuestion notification
 * Determines injection strategy: dismiss-inject (with Escape), twoStep, or single
 */

function parseQuestionReply(command, session) {
    if (!session.isUserQuestion) {
        return { type: 'single', command };
    }

    const options = session.questionOptions;

    // New path: session has questionOptions -> use dismiss-inject
    if (options && options.length > 0) {
        return _parseDismissInject(command, session);
    }

    // Backward compat: no questionOptions -> old twoStep/single logic
    return _parseLegacy(command, session);
}

function _parseDismissInject(command, session) {
    const options = session.questionOptions;
    const typeOptionNumber = (session.questionOptionCount || 0) + 1;

    // Check for "N. text" pattern
    const match = command.match(/^(\d+)\.\s+(.+)$/s);
    if (match) {
        const optionNum = parseInt(match[1], 10);
        const text = match[2].trim();

        // typeOption (e.g., "4. custom text") -> extract custom text
        if (optionNum === typeOptionNumber && text) {
            return { type: 'dismiss-inject', answer: text };
        }

        // Other "N. text" -> treat N as option selection (ignore text)
        if (optionNum >= 1 && optionNum <= options.length) {
            return { type: 'dismiss-inject', answer: options[optionNum - 1].label };
        }

        return { type: 'dismiss-inject', answer: String(optionNum) };
    }

    // Plain number -> map to option label
    const num = parseInt(command, 10);
    if (!isNaN(num) && String(num) === command.trim()) {
        if (num >= 1 && num <= options.length) {
            return { type: 'dismiss-inject', answer: options[num - 1].label };
        }
        return { type: 'dismiss-inject', answer: command };
    }

    // Free text -> pass through
    return { type: 'dismiss-inject', answer: command };
}

function _parseLegacy(command, session) {
    const typeOptionNumber = (session.questionOptionCount || 0) + 1;

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
