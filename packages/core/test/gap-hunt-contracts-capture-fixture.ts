/** Actual generated-declaration capture lint routes must flag untracked imported helper boundaries. */
import type { ITrackingObserver } from '@microdelta/tracking';
import { importedHelper } from './gap-hunt-contracts-capture-dependency.js';

declare const observer: ITrackingObserver;

// eslint-disable-next-line microdelta/tracked-captures -- Negative fixture: ordinary import hides its own untracked configuration but is directly rejected at the tracked boundary.
observer.tracked(function outer(value: number): number { return importedHelper(value); }, { path: ['outer'] });

// eslint-disable-next-line microdelta/tracked-captures -- Negative fixture: imported callbacks are outside the documented same-file direct-function syntax.
observer.tracked(importedHelper, { path: ['imported'] });

/** A documented same-file function callback still contains an external untracked import. */
function sameFile(value: number): number {
  // eslint-disable-next-line microdelta/tracked-captures -- Negative fixture: traversing a same-file callback must report the imported helper reference.
  return importedHelper(value);
}
observer.tracked(sameFile, { path: ['same-file'] });

observer.tracked(function nestedLocal(value: number): number {
  function bridge(input: number): number {
    // eslint-disable-next-line microdelta/tracked-captures -- Negative fixture: nesting a local bridge must not hide the external import within the callback body.
    return importedHelper(input);
  }
  return bridge(value);
}, { path: ['nested'] });
