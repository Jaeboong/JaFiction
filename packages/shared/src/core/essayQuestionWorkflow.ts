import { ProjectEssayAnswerState } from "./types";

export interface ReconcileEssayAnswerStatesResult {
  states: ProjectEssayAnswerState[];
  removedDocumentIds: string[];
}

export function essayAnswerDocumentTitle(questionIndex: number): string {
  return `essay-answer-q${questionIndex + 1}.md`;
}

export function essayAnswerDocumentNote(questionIndex: number, question: string): string {
  const normalizedQuestion = question.trim();
  const suffix = normalizedQuestion ? ` Source question: ${normalizedQuestion}` : "";
  return `Completed answer for essay question ${questionIndex + 1}.${suffix}`.trim();
}

export function upsertEssayAnswerState(
  states: ProjectEssayAnswerState[] | undefined,
  nextState: ProjectEssayAnswerState
): ProjectEssayAnswerState[] {
  const remaining = (states ?? []).filter((state) => state.questionIndex !== nextState.questionIndex);
  return [...remaining, nextState].sort((left, right) => left.questionIndex - right.questionIndex);
}

export function reconcileEssayAnswerStates(
  previousQuestions: string[] | undefined,
  nextQuestions: string[] | undefined,
  currentStates: ProjectEssayAnswerState[] | undefined
): ReconcileEssayAnswerStatesResult {
  const priorQuestions = previousQuestions ?? [];
  const upcomingQuestions = nextQuestions ?? [];
  const byQuestionText = new Map<string, ProjectEssayAnswerState[]>();

  for (const state of currentStates ?? []) {
    const questionText = priorQuestions[state.questionIndex]?.trim();
    if (!questionText) {
      continue;
    }
    const bucket = byQuestionText.get(questionText) ?? [];
    bucket.push(state);
    byQuestionText.set(questionText, bucket);
  }

  const states: ProjectEssayAnswerState[] = [];
  const matchedQuestionIndexes = new Set<number>();

  upcomingQuestions.forEach((questionText, questionIndex) => {
    const normalizedQuestion = questionText.trim();
    const matches = byQuestionText.get(normalizedQuestion);
    const nextMatch = matches?.shift();
    if (!nextMatch) {
      return;
    }
    matchedQuestionIndexes.add(nextMatch.questionIndex);
    states.push({
      ...nextMatch,
      questionIndex
    });
  });

  const removedDocumentIds = (currentStates ?? [])
    .filter((state) => !matchedQuestionIndexes.has(state.questionIndex))
    .map((state) => state.documentId)
    .filter((documentId): documentId is string => Boolean(documentId));

  return {
    states: states.sort((left, right) => left.questionIndex - right.questionIndex),
    removedDocumentIds
  };
}
