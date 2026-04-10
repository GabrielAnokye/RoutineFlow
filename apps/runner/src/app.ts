import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { compileRecording } from '@routineflow/compiler';
import {
  openRoutineFlowDatabase,
  type RoutineFlowRepository
} from '@routineflow/db';
import { createRuntimePaths } from '@routineflow/db/runtime-paths';
import { createLogger } from '@routineflow/logger';
import {
  HealthResponseSchema,
  RecordingSessionSchema,
  StartRunRequestSchema,
  ValidateAuthProfileRequestSchema,
  type HealthResponse,
  type RunSummary,
  type Workflow
} from '@routineflow/shared-types';

import {
  executeWorkflow,
  noopBrowserLauncher,
  type BrowserLauncher
} from './core/executor.js';
import { buildRunGraph } from './core/persist.js';
import { RunRegistry } from './core/run-registry.js';
import type { RunnerEnv } from './env.js';

export interface RunnerServer {
  app: FastifyInstance;
  runtimePaths: ReturnType<typeof createRuntimePaths>;
  repository: RoutineFlowRepository;
  registry: RunRegistry;
}

export interface RunnerOverrides {
  repository?: RoutineFlowRepository;
  browserLauncher?: BrowserLauncher;
}

const RUNNER_VERSION = '0.1.0';

/**
 * Builds the Fastify runner instance used by dev, test, and production entrypoints.
 */
export function buildRunnerServer(
  env: RunnerEnv,
  overrides: RunnerOverrides = {}
): RunnerServer {
  const logger = createLogger({
    level: env.LOG_LEVEL,
    name: 'routineflow-runner'
  });
  const runtimePaths = createRuntimePaths();
  const app = Fastify({ logger: false });

  const repository =
    overrides.repository ?? openRoutineFlowDatabase(':memory:').repository;
  const launcher = overrides.browserLauncher ?? noopBrowserLauncher;
  const registry = new RunRegistry();

  // Track the most recently completed run for /status.
  let lastRun: RunSummary | undefined;

  app.get('/health', async (): Promise<HealthResponse> =>
    HealthResponseSchema.parse({
      status: 'ok',
      service: 'runner',
      version: RUNNER_VERSION,
      uptimeSeconds: process.uptime()
    })
  );

  app.get('/status', async () => ({
    service: 'runner' as const,
    version: RUNNER_VERSION,
    active: registry.activeRunIds(),
    lastRun
  }));

  app.get('/config', async () => ({
    host: env.RUNNER_HOST,
    port: env.RUNNER_PORT,
    runtimePaths
  }));

  app.get('/compiler-sample', async () => {
    const workflow = compileRecording({
      recordingId: 'sample_morning_setup',
      name: 'Morning setup',
      startedAt: '2026-03-09T10:00:00.000Z',
      events: [
        {
          eventId: 'evt_1',
          type: 'navigate',
          atMs: 0,
          tabId: 'tab_main',
          url: 'https://example.com'
        }
      ]
    });

    return { workflow };
  });

  app.post('/recordings', async (request, reply) => {
    const parsed = RecordingSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow = compileRecording(parsed.data);
    const version = repository.saveWorkflowDefinition(workflow, {
      sourceRecordingId: parsed.data.recordingId
    });
    return {
      recordingId: parsed.data.recordingId,
      workflowId: version.workflowId,
      workflowVersion: version.version
    };
  });

  app.get('/workflows', async () => ({
    workflows: repository.listWorkflows().map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      enabled: w.enabled,
      latestVersion: w.latestVersion,
      updatedAt: w.updatedAt,
      tags: w.tags
    }))
  }));

  app.post('/workflows/:workflowId/run', async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const parsed = StartRunRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const workflow: Workflow | null =
      repository.getLatestWorkflowDefinition(workflowId);
    if (!workflow) {
      return reply.code(404).send({ error: 'workflow_not_found' });
    }
    const versionRows = repository.listWorkflowVersions(workflowId);
    const latest = versionRows[0];
    if (!latest) {
      return reply.code(404).send({ error: 'workflow_version_not_found' });
    }

    const runId = `run_${randomUUID()}`;
    const entry = registry.register({
      runId,
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString()
    });

    // Fire and forget — caller polls /runs/:id for completion.
    void (async () => {
      try {
        const events = executeWorkflow(workflow, {
          runId,
          ...(parsed.data.authProfileId !== undefined && {
            authProfileId: parsed.data.authProfileId
          }),
          ...(parsed.data.debugMode !== undefined && {
            debugMode: parsed.data.debugMode
          }),
          signal: entry.abort.signal,
          launcher
        });
        const graph = await buildRunGraph(workflow, events, {
          workflowVersionId: latest.id,
          ...(parsed.data.authProfileId !== undefined && {
            authProfileId: parsed.data.authProfileId
          })
        });
        repository.saveRunGraph(graph);
        registry.setStatus(runId, graph.run.status);
        lastRun = {
          id: graph.run.id,
          workflowId: graph.run.workflowId,
          workflowVersion: graph.run.workflowVersion,
          status: graph.run.status,
          triggerSource: graph.run.triggerSource,
          startedAt: graph.run.startedAt,
          finishedAt: graph.run.finishedAt,
          errorCode: graph.run.errorCode,
          errorMessage: graph.run.errorMessage
        };
      } catch (err) {
        logger.error({ err, runId }, 'run execution crashed');
        registry.setStatus(runId, 'failed');
      } finally {
        // Keep the entry for status visibility — purge after a short delay.
        setTimeout(() => registry.remove(runId), 60_000).unref?.();
      }
    })();

    return reply.send({ runId, status: 'running' as const });
  });

  app.post('/runs/:runId/cancel', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const ok = registry.cancel(runId);
    if (!ok) return reply.code(404).send({ error: 'run_not_found' });
    return { runId, status: 'canceled' as const };
  });

  app.get('/runs', async (request) => {
    const { workflowId } = (request.query ?? {}) as { workflowId?: string };
    if (!workflowId) {
      // No global list helper; aggregate across workflows.
      const all: RunSummary[] = [];
      for (const w of repository.listWorkflows()) {
        for (const r of repository.listRunsForWorkflow(w.id)) {
          all.push({
            id: r.id,
            workflowId: r.workflowId,
            workflowVersion: r.workflowVersion,
            status: r.status,
            triggerSource: r.triggerSource,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            errorCode: r.errorCode,
            errorMessage: r.errorMessage
          });
        }
      }
      return { runs: all };
    }
    return {
      runs: repository.listRunsForWorkflow(workflowId).map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        workflowVersion: r.workflowVersion,
        status: r.status,
        triggerSource: r.triggerSource,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage
      }))
    };
  });

  app.get('/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const graph = repository.getRunGraph(runId);
    if (!graph) return reply.code(404).send({ error: 'run_not_found' });
    return graph;
  });

  app.post('/auth-profiles/:id/validate', async (request, reply) => {
    const parsed = ValidateAuthProfileRequestSchema.safeParse(
      request.body ?? {}
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { id } = request.params as { id: string };
    const profiles = repository.listAuthProfiles();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) {
      return { valid: false, reason: 'profile_not_found' };
    }
    // Real validation lands once Playwright integration is wired in.
    return { valid: true };
  });

  app.addHook('onReady', async () => {
    logger.info(
      {
        dataDir: runtimePaths.baseDir,
        port: env.RUNNER_PORT
      },
      'Runner scaffold ready.'
    );
  });

  return { app, runtimePaths, repository, registry };
}
