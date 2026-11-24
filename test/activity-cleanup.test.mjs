import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, renderActivity } from '../src/screens/activities/index.js';

test('activity loader preserves the module cleanup handler', async () => {
  let destroyed = 0;
  MODULES['test-cleanup'] = async () => ({ default: () => ({ destroy() { destroyed++; } }) });
  try {
    const activity = await renderActivity({}, { type: 'test-cleanup' }, {});
    assert.equal(activity.fallback, false);
    activity.destroy();
    assert.equal(destroyed, 1);
  } finally {
    delete MODULES['test-cleanup'];
  }
});
