/**
 * Narrow one on-demand Operations mutation control without weakening the
 * default evidence run. The anchor check always covers every control; a
 * targeted run is only a diagnostic and must never pass vacuously or execute
 * an unintended second plant.
 */

/**
 * Resolve the runner's complete or single-control mode before it snapshots
 * or mutates any emitted build. `--only` uses a unique name fragment because
 * control names document the bad behavior being tested.
 */
export function selectOperationControls(args, controls) {
  if (args.length === 0) {
    return { selected: controls, only: undefined, checkAnchors: false };
  }
  if (args.length === 1 && args[0] === '--check-anchors') {
    return { selected: controls, only: undefined, checkAnchors: true };
  }
  if (args[0] === '--only') {
    const only = args[1];
    if (args.length !== 2 || typeof only !== 'string' || only.trim().length === 0) {
      throw new Error('control selector requires one nonempty name fragment');
    }
    const selected = controls.filter((control) => control.name.includes(only));
    if (selected.length !== 1) {
      throw new Error(`control selector matched ${String(selected.length)} controls; expected exactly one`);
    }
    return { selected, only, checkAnchors: false };
  }
  throw new Error('unsupported control option');
}
