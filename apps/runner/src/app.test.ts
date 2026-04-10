import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openRoutineFlowDatabase } from '@routineflow/db';
import { HealthResponseSchema } from '@routineflow/shared-types';

import { buildRunnerServer } from './app.js';
import type { BrowserLauncher } from './core/executor.js';

const baseEnv = {
  RUNNER_HOST: '127.0.0.1',
  RUNNER_PORT: 3100,
  LOG_LEVEL: 'silent' as const
};

const runner = buildRunnerServer(baseEnv);

beforeAll(async () => {
  await runner.app.ready();
});

afterAll(async () => {
  await runner.app.close();
});

describe('buildRunnerServer', () => {
  it('serves a validated health response', async () => {
    const response = await runner.app.inject({ method: 'GET', url: '/health' });
    const payload = HealthResponseSchema.parse(response.json());
    expect(response.statusCode).toBe(200);
    expect(payload.service).toBe('runner');
  });

  it('exposes /status with service metadata', async () => {
    const response = await runner.app.inject({ method: 'GET', url: '/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.service).toBe('runner');
    expect(Array.isArray(body.active)).toBe(true);
  });
});

const sampleRecording = {
  recordingId: 'rec_e2e',
  name: 'E2E recording',
  startedAt: '2026-04-09T10:00:00.000Z',
  events: [
    {
      eventId: 'e1',
      type: 'navigate',
      atMs: 0,
      tabId: 't1',
      url: 'https://example.com'
    },
    {
      eventId: 'e2',
      type: 'click',
      atMs: 100,
      tabId: 't1',
      target: {
        primaryLocator: { kind: 'role', role: 'button', name: 'Save' },
        fallbackLocators: []
      },
      button: 'left'
    }
  ]
};

async function waitForRunStatus(
  app: ReturnType<typeof buildRunnerServer>['app'],
  runId: string
): Promise<unknown> {
  for (let i = 0; i < 50; i++) {
    const r = await app.inject({ method: 'GET', url: `/runs/${runId}` });
    if (r.statusCode === 200) {
      const body = r.json() as { run: { status: string } };
      if (body.run.status !== 'queued' && body.run.status !== 'running') {
        return body;
      }
    }
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('run did not complete in time');
}

describe('runner workflows + runs', () => {
  it('compiles a recording, runs it with a stub launcher, and persists the run graph', async () => {
    const repo = openRoutineFlowDatabase(':memory:').repository;
    const launcher: BrowserLauncher = { async executeStep() {} };
    const r = buildRunnerServer(baseEnv, {
      repository: repo,
      browserLauncher: launcher
    });
    await r.app.ready();
    try {
      const save = await r.app.inject({
        method: 'POST',
        url: '/recordings',
        payload: sampleRecording
      });
      expect(save.statusCode).toBe(200);
      const { workflowId } = save.json() as { workflowId: string };

      const start = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/run`,
        payload: {}
      });
      expect(start.statusCode).toBe(200);
      const { runId } = start.json() as { runId: string };

      const graph = (await waitForRunStatus(r.app, runId)) as {
        run: { status: string };
        steps: unknown[];
      };
      expect(graph.run.status).toBe('succeeded');
      expect(graph.steps.length).toBeGreaterThanOrEqual(2);

      const list = await r.app.inject({
        method: 'GET',
        url: `/runs?workflowId=${workflowId}`
      });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { runs: unknown[] }).runs.length).toBe(1);
    } finally {
      await r.app.close();
    }
  });

  it('marks a run as failed when the launcher throws on a step', async () => {
    const repo = openRoutineFlowDatabase(':memory:').repository;
    let calls = 0;
    const launcher: BrowserLauncher = {
      async executeStep() {
        calls++;
        if (calls === 2) throw new Error('boom');
      }
    };
    const r = buildRunnerServer(baseEnv, {
      repository: repo,
      browserLauncher: launcher
    });
    await r.app.ready();
    try {
      const save = await r.app.inject({
        method: 'POST',
        url: '/recordings',
        payload: sampleRecording
      });
      const { workflowId } = save.json() as { workflowId: string };
      const start = await r.app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/run`,
        payload: {}
      });
      const { runId } = start.json() as { runId: string };
      const graph = (await waitForRunStatus(r.app, runId)) as {
        run: { status: string; errorMessage?: string };
      };
      expect(graph.run.status).toBe('failed');
      expect(graph.run.errorMessage).toContain('boom');
    } finally {
      await r.app.close();
    }
  });

  it('cancel endpoint returns 404 for unknown runs', async () => {
    const response = await runner.app.inject({
      method: 'POST',
      url: '/runs/run_does_not_exist/cancel'
    });
    expect(response.statusCode).toBe(404);
  });
});
