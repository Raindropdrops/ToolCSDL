export function quizDomEvaluator() {
  const pickText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const pickFromNode = (node, selectors) => {
    for (const selector of selectors) {
      const found = node.querySelector(selector);
      if (!found) {
        continue;
      }

      const text = pickText(found.textContent);
      if (text) {
        return text;
      }
    }

    return '';
  };

  const dedupeStrings = (items) => {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      if (seen.has(item)) {
        continue;
      }

      seen.add(item);
      result.push(item);
    }

    return result;
  };

  const extractOptions = (questionNode) => {
    const lines = [];
    const candidateNodes = questionNode.querySelectorAll('li, .answer, .option, .r0, .r1');

    for (const node of candidateNodes) {
      const text = pickText(node.textContent);
      if (text && text.length > 1) {
        lines.push(text);
      }
    }

    if (lines.length > 0) {
      return dedupeStrings(lines);
    }

    const fallbackText = pickText(questionNode.textContent);
    if (!fallbackText) {
      return [];
    }

    return fallbackText
      .split('\n')
      .map((line) => pickText(line))
      .filter((line) => line.length > 2);
  };

  const questionCandidates = Array.from(
    document.querySelectorAll('.que, [id*="question"], .question, .qtext-container')
  );

  const questions = questionCandidates.map((questionNode, index) => {
    const title =
      pickFromNode(questionNode, ['.qno', '.no', '.questionname', '.info']) || `Question ${index + 1}`;

    const prompt = pickFromNode(questionNode, ['.qtext', '.content .text', '.questiontext', '.formulation']);

    const selected =
      pickFromNode(questionNode, ['.correct', '.rightanswer', '.selected']) ||
      pickFromNode(questionNode, ['.state', '.feedback']);

    const correctness = pickFromNode(questionNode, ['.state', '.grade', '.outcome']);

    const options = extractOptions(questionNode);

    return {
      index: index + 1,
      title,
      prompt,
      options,
      selected,
      correctness
    };
  });

  const cleaned = questions.filter((question) => question.prompt || question.options.length > 0);

  const scoreText = pickFromNode(document, ['.grade', '.score', '.result', '.quizgrade']);

  return {
    questionCount: cleaned.length,
    scoreText,
    extractedAt: new Date().toISOString(),
    questions: cleaned
  };
}
