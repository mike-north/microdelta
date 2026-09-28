import type * as Fixture from '@microdelta/fixture-producer';
import type * as CaptureFixture from '@microdelta/capture-producer';
import type * as DefinitionFixture from '@microdelta/definition';

type IHidden = Fixture.ITrackedCaptureConfig;
type ICaptureHidden = CaptureFixture.ITrackedCaptureConfig;
// Definition's declared-call handle is project-private alpha; the public rollup must hide it.
type IDefinitionHidden = DefinitionFixture.IDeclaredCallHandle<unknown>;
declare const hidden: IHidden;
declare const captureHidden: ICaptureHidden;
declare const definitionHidden: IDefinitionHidden;
void hidden;
void captureHidden;
void definitionHidden;
