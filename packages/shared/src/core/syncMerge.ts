import type { ProjectRecord } from "./types";
import type { SyncDocument, SyncProject, SyncSet } from "./syncTypes";

function documentKey(document: SyncDocument): string {
  return `${document.scope}\u0000${document.projectSlug ?? ""}\u0000${document.contentSha256}`;
}

function projectKey(project: SyncProject): string {
  return project.slug;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function documentMetadataRank(document: SyncDocument): string {
  return JSON.stringify({
    title: document.title,
    sourceType: document.sourceType,
    note: document.note ?? "",
    contentBase64: document.contentBase64
  });
}

function preferDocumentMetadata(a: SyncDocument, b: SyncDocument): SyncDocument {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt ? a : b;
  }
  return documentMetadataRank(a) >= documentMetadataRank(b) ? a : b;
}

function mergeDocuments(a: SyncDocument, b: SyncDocument): SyncDocument {
  const metadata = preferDocumentMetadata(a, b);
  const contentBase64 = a.contentBase64 <= b.contentBase64 ? a.contentBase64 : b.contentBase64;
  const merged: SyncDocument = {
    scope: metadata.scope,
    contentSha256: metadata.contentSha256,
    title: metadata.title,
    sourceType: metadata.sourceType,
    pinnedByDefault: a.pinnedByDefault || b.pinnedByDefault,
    createdAt: metadata.createdAt,
    contentBase64
  };
  if (metadata.projectSlug !== undefined) {
    merged.projectSlug = metadata.projectSlug;
  }
  if (metadata.note !== undefined) {
    merged.note = metadata.note;
  }
  return merged;
}

function isEmptyString(value: string | undefined): boolean {
  return value === undefined || value === "";
}

function isEmptyArray<T>(value: readonly T[] | undefined): boolean {
  return value === undefined || value.length === 0;
}

function isEmptyObject<T extends object>(value: T | undefined): boolean {
  return value === undefined || Object.keys(value).length === 0;
}

function hasExperienceRefsValue(value: ProjectRecord["experienceRefs"] | undefined): boolean {
  return value !== undefined && (
    value.profileDocumentIds.length > 0 ||
    value.githubRepos.length > 0 ||
    value.notionDirective !== null
  );
}

function preferProject(a: SyncProject, b: SyncProject): SyncProject {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }
  return JSON.stringify(a.record) >= JSON.stringify(b.record) ? a : b;
}

function chooseString(
  older: string | undefined,
  newer: string | undefined
): string | undefined {
  if (isEmptyString(older)) return newer;
  if (isEmptyString(newer)) return older;
  return newer;
}

function chooseNumber(
  older: number | undefined,
  newer: number | undefined
): number | undefined {
  if (older === undefined) return newer;
  if (newer === undefined) return older;
  return newer;
}

function chooseBoolean(
  older: boolean | undefined,
  newer: boolean | undefined
): boolean | undefined {
  if (older === undefined) return newer;
  if (newer === undefined) return older;
  return newer;
}

function chooseDefined<T>(
  older: T | undefined,
  newer: T | undefined
): T | undefined {
  if (older === undefined) return newer;
  if (newer === undefined) return older;
  return newer;
}

function chooseArray<T>(
  older: readonly T[] | undefined,
  newer: readonly T[] | undefined
): T[] | undefined {
  if (older === undefined || older.length === 0) return newer === undefined ? undefined : [...newer];
  if (newer === undefined || newer.length === 0) return [...older];
  return [...newer];
}

function chooseObject<T extends object>(
  older: T | undefined,
  newer: T | undefined
): T | undefined {
  if (isEmptyObject(older)) return newer;
  if (isEmptyObject(newer)) return older;
  return newer;
}

function chooseExperienceRefs(
  older: ProjectRecord["experienceRefs"] | undefined,
  newer: ProjectRecord["experienceRefs"] | undefined
): ProjectRecord["experienceRefs"] {
  if (!hasExperienceRefsValue(older)) {
    return newer ?? { profileDocumentIds: [], githubRepos: [], notionDirective: null };
  }
  if (!hasExperienceRefsValue(newer)) {
    return older ?? { profileDocumentIds: [], githubRepos: [], notionDirective: null };
  }
  if (newer !== undefined) {
    return newer;
  }
  return older ?? { profileDocumentIds: [], githubRepos: [], notionDirective: null };
}

function mergeProjectRecords(a: SyncProject, b: SyncProject): ProjectRecord {
  const newer = preferProject(a, b);
  const older = newer === a ? b : a;
  const oldRecord = older.record;
  const newRecord = newer.record;
  const record: ProjectRecord = {
    slug: chooseString(oldRecord.slug, newRecord.slug) ?? newRecord.slug,
    companyName: chooseString(oldRecord.companyName, newRecord.companyName) ?? "",
    rubric: chooseString(oldRecord.rubric, newRecord.rubric) ?? "",
    pinnedDocumentIds: chooseArray(oldRecord.pinnedDocumentIds, newRecord.pinnedDocumentIds) ?? [],
    experienceRefs: chooseExperienceRefs(oldRecord.experienceRefs, newRecord.experienceRefs),
    createdAt: chooseString(oldRecord.createdAt, newRecord.createdAt) ?? newRecord.createdAt,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    postingReviewReasons: chooseArray(oldRecord.postingReviewReasons, newRecord.postingReviewReasons) ?? [],
    jobPostingFieldConfidence: chooseObject(oldRecord.jobPostingFieldConfidence, newRecord.jobPostingFieldConfidence) ?? {}
  };
  const roleName = chooseString(oldRecord.roleName, newRecord.roleName);
  if (roleName !== undefined) record.roleName = roleName;
  const deadline = chooseString(oldRecord.deadline, newRecord.deadline);
  if (deadline !== undefined) record.deadline = deadline;
  const overview = chooseString(oldRecord.overview, newRecord.overview);
  if (overview !== undefined) record.overview = overview;
  const mainResponsibilities = chooseString(oldRecord.mainResponsibilities, newRecord.mainResponsibilities);
  if (mainResponsibilities !== undefined) record.mainResponsibilities = mainResponsibilities;
  const qualifications = chooseString(oldRecord.qualifications, newRecord.qualifications);
  if (qualifications !== undefined) record.qualifications = qualifications;
  const preferredQualifications = chooseString(oldRecord.preferredQualifications, newRecord.preferredQualifications);
  if (preferredQualifications !== undefined) record.preferredQualifications = preferredQualifications;
  const benefits = chooseString(oldRecord.benefits, newRecord.benefits);
  if (benefits !== undefined) record.benefits = benefits;
  const hiringProcess = chooseString(oldRecord.hiringProcess, newRecord.hiringProcess);
  if (hiringProcess !== undefined) record.hiringProcess = hiringProcess;
  const insiderView = chooseString(oldRecord.insiderView, newRecord.insiderView);
  if (insiderView !== undefined) record.insiderView = insiderView;
  const otherInfo = chooseString(oldRecord.otherInfo, newRecord.otherInfo);
  if (otherInfo !== undefined) record.otherInfo = otherInfo;
  const keywords = chooseArray(oldRecord.keywords, newRecord.keywords);
  if (keywords !== undefined) record.keywords = keywords;
  const jobPostingUrl = chooseString(oldRecord.jobPostingUrl, newRecord.jobPostingUrl);
  if (jobPostingUrl !== undefined) record.jobPostingUrl = jobPostingUrl;
  const jobPostingText = chooseString(oldRecord.jobPostingText, newRecord.jobPostingText);
  if (jobPostingText !== undefined) record.jobPostingText = jobPostingText;
  const essayQuestions = chooseArray(oldRecord.essayQuestions, newRecord.essayQuestions);
  if (essayQuestions !== undefined) record.essayQuestions = essayQuestions;
  const openDartCorpCode = chooseString(oldRecord.openDartCorpCode, newRecord.openDartCorpCode);
  if (openDartCorpCode !== undefined) record.openDartCorpCode = openDartCorpCode;
  const openDartCorpName = chooseString(oldRecord.openDartCorpName, newRecord.openDartCorpName);
  if (openDartCorpName !== undefined) record.openDartCorpName = openDartCorpName;
  const openDartStockCode = chooseString(oldRecord.openDartStockCode, newRecord.openDartStockCode);
  if (openDartStockCode !== undefined) record.openDartStockCode = openDartStockCode;
  const openDartCandidates = chooseArray(oldRecord.openDartCandidates, newRecord.openDartCandidates);
  if (openDartCandidates !== undefined) record.openDartCandidates = openDartCandidates;
  const openDartSkipRequested = chooseBoolean(oldRecord.openDartSkipRequested, newRecord.openDartSkipRequested);
  if (openDartSkipRequested !== undefined) record.openDartSkipRequested = openDartSkipRequested;
  const postingAnalyzedAt = chooseString(oldRecord.postingAnalyzedAt, newRecord.postingAnalyzedAt);
  if (postingAnalyzedAt !== undefined) record.postingAnalyzedAt = postingAnalyzedAt;
  const jobPostingManualFallback = chooseBoolean(oldRecord.jobPostingManualFallback, newRecord.jobPostingManualFallback);
  if (jobPostingManualFallback !== undefined) record.jobPostingManualFallback = jobPostingManualFallback;
  const insightStatus = chooseDefined(oldRecord.insightStatus, newRecord.insightStatus);
  if (insightStatus !== undefined) record.insightStatus = insightStatus;
  const insightLastGeneratedAt = chooseString(oldRecord.insightLastGeneratedAt, newRecord.insightLastGeneratedAt);
  if (insightLastGeneratedAt !== undefined) record.insightLastGeneratedAt = insightLastGeneratedAt;
  const insightLastError = chooseString(oldRecord.insightLastError, newRecord.insightLastError);
  if (insightLastError !== undefined) record.insightLastError = insightLastError;
  const essayAnswerStates = chooseArray(oldRecord.essayAnswerStates, newRecord.essayAnswerStates);
  if (essayAnswerStates !== undefined) record.essayAnswerStates = essayAnswerStates;
  const charLimit = chooseNumber(oldRecord.charLimit, newRecord.charLimit);
  if (charLimit !== undefined) record.charLimit = charLimit;
  const notionPageIds = chooseArray(oldRecord.notionPageIds, newRecord.notionPageIds);
  if (notionPageIds !== undefined) record.notionPageIds = notionPageIds;
  return record;
}

function mergeProjects(a: SyncProject, b: SyncProject): SyncProject {
  const updatedAt = a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt;
  return {
    slug: a.slug <= b.slug ? a.slug : b.slug,
    record: mergeProjectRecords(a, b),
    updatedAt
  };
}

function sortedDocuments(documents: readonly SyncDocument[]): SyncDocument[] {
  return [...documents].sort((a, b) => (
    compareStrings(a.scope, b.scope) ||
    compareStrings(a.projectSlug ?? "", b.projectSlug ?? "") ||
    compareStrings(a.contentSha256, b.contentSha256)
  ));
}

function sortedProjects(projects: readonly SyncProject[]): SyncProject[] {
  return [...projects].sort((a, b) => compareStrings(a.slug, b.slug));
}

export function mergeSyncSets(a: SyncSet, b: SyncSet): SyncSet {
  const documentsByKey = new Map<string, SyncDocument>();
  for (const document of [...a.documents, ...b.documents]) {
    const key = documentKey(document);
    const existing = documentsByKey.get(key);
    documentsByKey.set(key, existing === undefined ? document : mergeDocuments(existing, document));
  }

  const projectsByKey = new Map<string, SyncProject>();
  for (const project of [...a.projects, ...b.projects]) {
    const key = projectKey(project);
    const existing = projectsByKey.get(key);
    projectsByKey.set(key, existing === undefined ? project : mergeProjects(existing, project));
  }

  return {
    documents: sortedDocuments([...documentsByKey.values()]),
    projects: sortedProjects([...projectsByKey.values()])
  };
}
