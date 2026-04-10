import { randomUUID } from 'node:crypto';

import type {
  RunEvent,
  Workflow,
  WorkflowStep
} from '@routineflow/shared-types';

export interface ExecuteStepContext {
  runId: string;
  stepIndex: number;
  attempt: number;
  signal: AbortSignal;
}

/**
 * Pluggable browser engine. Tests inject a stub; production wires this to a
 * real Playwright launcher in a follow-up. Returning normally = success.
 * Throwing = step failure (retried per the step's retry policy).
 */
export interface BrowserLauncher {
  executeStep(step: WorkflowStep, ctx: ExecuteStepContext): Promise<void>;
  dispose?(): Promise<void>;
}

/** Default launcher: a no-op simulator that succeeds for every step. */
export const noopBrowserLauncher: BrowserLauncher = {
  async executeStep() {
    /* no-op */
  }
};

export interface ExecuteWorkflowOptions {
  runId?: string;
  authProfileId?: string;
  debugMode?: boolean;
  signal?: AbortSignal;
  launcher?: BrowserLauncher;
  now?: () => Date;
}

/**
 * Streams structured RunEvents for a workflow execution. Honors per-step
 * retryPolicy and AbortSignal-based cancellation.
 */
export async function* executeWorkflow(
  workflow: Workflow,
  options: ExecuteWorkflowOptions = {}
): AsyncIterable<RunEvent> {
  const launcher = options.launcher ?? noopBrowserLauncher;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? `run_${randomUUID()}`;
  const signal = options.signal ?? new AbortController().signal;

  const startedAt = now().toISOString();
  yield {
    kind: 'run.started',
    runId,
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    startedAt
  };

  let finalStatus: 'succeeded' | 'failed' | 'canceled' = 'succeeded';
  let finalError: { code: string; message: string; stepId?: string } | undefined;

  for (let i = 0; i < workflow.steps.length; i++) {
    if (signal.aborted) {
      finalStatus = 'canceled';
      break;
    }
    const step = workflow.steps[i]!;
    const policy = step.retryPolicy;
    const maxAttempts = policy.maxAttempts;

    let attempt = 1;
    let succeeded = false;
    let lastError: unknown;

    while (attempt <= maxAttempts) {
      if (signal.aborted) {
        finalStatus = 'canceled';
        break;
      }
      const stepStartedAt = now().toISOString();
      const stepStartMs = Date.now();
      yield {
        kind: 'step.started',
        runId,
        stepId: step.id,
        stepIndex: i,
        stepType: step.type,
        startedAt: stepStartedAt,
        attempt
      };

      try {
        await launcher.executeStep(step, {
          runId,
          stepIndex: i,
          attempt,
          signal
        });
        const finishedAt = now().toISOString();
        yield {
          kind: 'step.succeeded',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs
        };
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          const delayMs =
            policy.strategy === 'exponential'
              ? policy.backoffMs * 2 ** (attempt - 1)
              : policy.backoffMs;
          yield {
            kind: 'step.retrying',
            runId,
            stepId: step.id,
            stepIndex: i,
            attempt: attempt + 1,
            delayMs
          };
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          attempt++;
          continue;
        }
        // Out of attempts.
        const finishedAt = now().toISOString();
        const message =
          err instanceof Error ? err.message : 'Step execution failed.';
        finalError = {
          code: 'step_failed',
          message,
          stepId: step.id
        };
        yield {
          kind: 'step.failed',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt,
          durationMs: Date.now() - stepStartMs,
          error: finalError
        };
        finalStatus = 'failed';
        break;
      }
    }

    if (!succeeded) break;
  }

  if (launcher.dispose) {
    try {
      await launcher.dispose();
    } catch {
      /* swallow */
    }
  }

  yield {
    kind: 'run.finished',
    runId,
    status: finalStatus,
    finishedAt: now().toISOString(),
    error: finalError
  };
}
