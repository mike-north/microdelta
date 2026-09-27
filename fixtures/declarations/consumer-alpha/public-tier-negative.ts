import type * as Fixture from '@microdelta/fixture-producer';
import type * as CaptureFixture from '@microdelta/capture-producer';

type IHidden = Fixture.ITrackedCaptureConfig;
type ICaptureHidden = CaptureFixture.ITrackedCaptureConfig;
declare const hidden: IHidden;
declare const captureHidden: ICaptureHidden;
void hidden;
void captureHidden;
