import { createNodeMachine } from '@microdelta/machine-node';
import { createTrackingObserver } from '@microdelta/tracking';
const observer = createTrackingObserver(createNodeMachine());
const member = observer.tracked({ key: 'pr:1', title: 'Synthetic' }, { path: ['member'] });
try {
  observer.capture(() => JSON.stringify(member));
  console.log('unexpected success');
} catch (error: unknown) {
  if (!(error instanceof Error)) throw error;
  console.log(JSON.stringify({ name: error.name, message: error.message }));
}
