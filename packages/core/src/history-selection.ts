/**
 * The facade's finite exact History read composition. It supplies Node host
 * capabilities only; it opens no workspace, loads no author registration and
 * interprets neither currentness nor application data.
 */
import { readHistorySelection as selectHistory } from '@microdelta/history';
import type {
  IHistorySelectionLocation as IHistorySelectionLocationOf,
  IHistorySelectionRequest as IHistorySelectionRequestOf,
  IHistorySelectionResult as IHistorySelectionResultOf,
} from '@microdelta/history';
import { createNodeSqliteCoordinatedReader } from '@microdelta/machine-node';

import { machine } from './host.js';

/** Caller-selected existing file and logical-store identity; no discovery or writable open. @alpha */
export type IHistorySelectionLocation = IHistorySelectionLocationOf;

/** One explicit exact-reference fact or fingerprint request, without run authority. @alpha */
export type IHistorySelectionRequest = IHistorySelectionRequestOf;

/** Detached data returned only after the finite physical scope was released. @alpha */
export type IHistorySelectionResult = IHistorySelectionResultOf;

/**
 * Read one selected fact or fingerprint without analysis, initialization or a
 * caller-owned reader lifetime. This distinct coordinated operation can have
 * the selected native WAL/SHM effects; it does not change CLI-005's stricter
 * rollback-artifact reader or return current acceptance.
 * @alpha
 */
export function readHistorySelection(location: IHistorySelectionLocation, request: IHistorySelectionRequest): IHistorySelectionResult {
  return selectHistory({
    location: location.location,
    logicalStore: location.logicalStore,
    sqlite: createNodeSqliteCoordinatedReader(),
    sha256: machine,
  }, request);
}
