import { describe, expect, it } from 'vitest';

import { resolveExtensionEnv } from './env';

describe('resolveExtensionEnv', () => {
  it('applies defaults for optional side-panel configuration', () => {
    const env = resolveExtensionEnv({});

    expect(env.VITE_ROUTINEFLOW_NAME).toBe('RoutineFlow');
    expect(env.VITE_RUNNER_BASE_URL).toBe('http://127.0.0.1:3100');
  });
});
