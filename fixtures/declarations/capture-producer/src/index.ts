/** Project-private producer shapes exercise canonical brands through a real declaration rollup. */
import type { ITracked } from '@microdelta/tracking';

/** A producer-owned contract that preserves Tracking's canonical value and callable brands. @alpha */
export interface ITrackedCaptureConfig {
  readonly input: ITracked<{
    readonly enabled: boolean;
    readonly details?: { readonly count: number };
    readonly rows: readonly { readonly name: string }[];
  }>;
  readonly isEnabled: ITracked<(value: boolean) => boolean>;
}

/** A user-facing shape verifies that project-private dependencies do not poison the public rollup. @public */
export interface IPublicCaptureProbe {
  readonly label: string;
}
