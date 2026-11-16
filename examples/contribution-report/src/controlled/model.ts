/** Report-owned input, schema and settling policies; none grants provider closure or runtime reuse authority. */
import { isRecord } from './github.js';

/** Current HR identity is independent of repository account and presentation name. @internal */
export interface IPerson { readonly key: string; readonly login: string; readonly name: string; readonly active: boolean }
/** Local observation names an evaluation policy, never a provider revision or snapshot. @internal */
export interface IReportScope { readonly repositories: readonly string[]; readonly start: number; readonly end: number; readonly cutoff: number; readonly observation: string }
/** The assessment provider must answer this finite validated domain schema. @internal */
export interface IAssessment { readonly score: number; readonly explanation: string }
/** A quiet policy's evidence is separate from provider exhaustion and daily coverage. @internal */
export interface IQuietEvidence { readonly terminalAt: number | null; readonly latestActivity: number; readonly complete: boolean }
/** Current HR parser rejects malformed rows instead of silently changing the required population. @internal */
export function parseRoster(csv: string): readonly IPerson[] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else { field += character ?? ''; }
    } else if (character === '"') {
      if (field.length !== 0 || afterQuote) { throw new Error('invalid roster'); }
      quoted = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      fields.push(field); field = ''; afterQuote = false;
      if (character !== ',') {
        if (character === '\r' && csv[index + 1] === '\n') { index += 1; }
        rows.push(fields); fields = [];
      }
    } else {
      if (afterQuote) { throw new Error('invalid roster'); }
      field += character ?? '';
    }
  }
  if (quoted) { throw new Error('invalid roster'); }
  if (field.length > 0 || fields.length > 0 || afterQuote) { fields.push(field); rows.push(fields); }
  if (JSON.stringify(rows.shift()) !== JSON.stringify(['employee_id', 'github_login', 'name', 'active'])) { throw new Error('invalid roster'); }
  const seen = new Set<string>();
  return rows.map(row => {
    const [key, login, name, active] = row;
    if (row.length !== 4 || key === undefined || !/^[a-z][a-z0-9_-]*$/u.test(key) || seen.has(key) || login === undefined || !/^[a-zA-Z0-9-]+$/u.test(login)
      || name === undefined || name.trim().length === 0 || (active !== 'true' && active !== 'false')) { throw new Error('invalid roster'); }
    seen.add(key);
    return { key, login, name, active: active === 'true' };
  });
}
/** Only explicit active HR identities enter a selected report. @internal */
export function selectPeople(roster: readonly IPerson[], selected: readonly string[]): readonly IPerson[] {
  if (new Set(selected).size !== selected.length) { throw new Error('invalid selection'); }
  const people = selected.map(key => { const person = roster.find(candidate => candidate.key === key); if (person?.active !== true) { throw new Error('invalid selection'); } return person; });
  return people.sort((left, right) => left.key.localeCompare(right.key));
}
/** Reject imprecise or ambiguous report bounds before author work starts. @internal */
export function validateScope(scope: IReportScope): IReportScope {
  if (scope.repositories.length === 0 || new Set(scope.repositories).size !== scope.repositories.length || scope.repositories.some(repository => !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository))
    || !Number.isSafeInteger(scope.start) || !Number.isSafeInteger(scope.end) || !Number.isSafeInteger(scope.cutoff) || scope.start < 0 || scope.end <= scope.start || scope.cutoff <= scope.start
    || !/^[a-zA-Z0-9_.:-]+$/u.test(scope.observation)) { throw new Error('invalid report scope'); }
  return { ...scope, repositories: [...scope.repositories].sort() };
}
/** Unknown model responses cannot become retained successful assessments. @internal */
export function validateAssessment(value: unknown): IAssessment {
  if (isRecord(value) && Object.keys(value).sort().join(',') === 'explanation,score' && typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0 && value.score <= 10
    && typeof value.explanation === 'string' && value.explanation.trim().length > 0) { return { score: value.score, explanation: value.explanation }; }
  throw new Error('invalid assessment');
}
/** Quiet time is useful only for exhausted terminal evidence at or before the cutoff. @internal */
export function quietFinal(evidence: IQuietEvidence, cutoff: number, quietSeconds: number): boolean {
  return Number.isSafeInteger(cutoff) && Number.isSafeInteger(quietSeconds) && quietSeconds >= 0 && evidence.complete && evidence.terminalAt !== null
    && evidence.terminalAt <= cutoff && evidence.latestActivity <= cutoff - quietSeconds;
}
/** An inclusive closed UTC day becomes a half-open clipped interval. @internal */
export function dailyCoverage(start: number, end: number, closedDay: string): { readonly closed: readonly [number, number]; readonly provisional: readonly [number, number] } {
  const parsed = Date.parse(`${closedDay}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(closedDay) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== closedDay || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) { throw new Error('invalid daily coverage'); }
  const boundary = Math.max(start, Math.min(end, parsed / 1_000 + 86_400));
  return { closed: [start, boundary], provisional: [boundary, end] };
}
