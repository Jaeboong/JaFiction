const insightDocumentTitles = new Set([
  "company-insight.md",
  "job-insight.md",
  "application-strategy.md",
  "question-analysis.md"
]);

export function isInsightDocumentTitle(title: string): boolean {
  return insightDocumentTitles.has(title);
}

export function hasInsightDocuments(
  documents: ReadonlyArray<{ title: string }>
): boolean {
  return documents.some((document) => isInsightDocumentTitle(document.title));
}
