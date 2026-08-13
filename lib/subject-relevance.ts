const GENERIC_TERMS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "official",
  "the",
]);

const GENERIC_SUBJECT_TERMS = new Set([
  ...GENERIC_TERMS,
  "global",
  "group",
  "holdings",
  "international",
  "platform",
  "platforms",
  "services",
  "systems",
  "technologies",
  "technology",
]);

export function subjectMatchesCandidate(subject: string, candidate: string) {
  const normalizedSubject = normalize(subject);
  const normalizedCandidate = normalize(candidate);
  if (!normalizedSubject || !normalizedCandidate) return false;
  if (normalizedSubject === normalizedCandidate) return true;
  if (subjectLooksLikeHandle(subject)) return false;

  const subjectTerms = meaningfulTerms(subject, GENERIC_SUBJECT_TERMS);
  if (subjectTerms.length === 0) return false;
  const candidateTerms = meaningfulTerms(candidate, GENERIC_SUBJECT_TERMS);
  if (candidateTerms.length === 0 || subjectTerms[0] !== candidateTerms[0]) return false;
  if (subjectTerms.length === 1 || candidateTerms.length === 1) return true;
  const subjectSet = new Set(subjectTerms);
  const candidateSet = new Set(candidateTerms);
  return subjectTerms.every((term) => candidateSet.has(term))
    || candidateTerms.every((term) => subjectSet.has(term));
}

export function subjectLooksLikeHandle(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("@") || (!/\s/.test(trimmed) && /[._]/.test(trimmed));
}

export function evidenceMatchesSubject(subject: string, content: string) {
  const normalizedSubject = normalize(subject);
  const normalizedContent = normalize(content);
  if (!normalizedSubject || !normalizedContent) return false;
  const candidates = sourceIdentityCandidates(content);
  if (candidates.length > 0) {
    return candidates.some((candidate) => subjectMatchesCandidate(subject, candidate));
  }
  return ` ${normalizedContent} `.includes(` ${normalizedSubject} `);
}

function sourceIdentityCandidates(content: string) {
  const candidates: string[] = [];
  for (const pattern of [
    /^Wikipedia\s+[—-]\s+(.+?)(?=\s+\(|:)/i,
    /^Wikidata\s+[—-]\s+(.+?)(?=\s+\(|\.)/i,
    /^SEC EDGAR\s+[—-]\s+(.+?)(?=\s+\()/i,
    /^Hacker News\s+[—-].*?["“](.+?)["”]/i,
  ]) {
    const match = content.match(pattern);
    if (match?.[1]) candidates.push(match[1].trim());
  }
  return candidates;
}

function meaningfulTerms(value: string, ignoredTerms = GENERIC_TERMS) {
  const terms = normalize(value)
    .split(" ")
    .filter(Boolean)
    .filter((term) => !ignoredTerms.has(term));
  const substantial = terms.filter((term) => term.length >= 2);
  return substantial.length > 0 ? substantial : terms;
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
