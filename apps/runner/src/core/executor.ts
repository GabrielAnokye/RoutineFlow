import { randomUUID } from 'node:crypto';

import type {
  FailureCode,
  Locator,
  RepairRecord,
  RunEvent,
  StepCondition,
  Workflow,
  WorkflowStep
} from '@routineflow/shared-types';

import { classifyError, computeRetryDelay } from './locate.js';

export interface ExecuteStepContext {
  runId: string;
  stepIndex: number;
  attempt: number;
  signal: AbortSignal;
}

/** Result optionally returned by the launcher to surface locator info. */
export interface StepExecutionResult {
  resolvedLocator?: Locator;
  usedFallback?: boolean;
}

/**
 * Pluggable browser engine. Tests inject a stub; production wires this to a
 * real Playwright launcher in a follow-up. Returning normally = success.
 * Throwing = step failure (retried per the step's retry policy).
 */
export interface BrowserLauncher {
  executeStep(
    step: WorkflowStep,
    ctx: ExecuteStepContext
  ): Promise<StepExecutionResult | void>;
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
  fromStepIndex?: number;
  /** Resolve a subworkflow id to its definition. Required for `subworkflow` steps. */
  resolveSubworkflow?: (workflowId: string) => Workflow | null;
  /** Runtime variable bag for `if` condition evaluation and `httpRequest` storeAs. */
  variables?: Map<string, string>;
}

/**
 * Evaluate a step condition against the current runtime state.
 * Returns true if the condition is met.
 */
async function evaluateCondition(
  condition: StepCondition,
  ctx: {
    launcher: BrowserLauncher;
    runId: string;
    signal: AbortSignal;
    variables: Map<string, string>;
  }
): Promise<boolean> {
  switch (condition.kind) {
    case 'locatorExists': {
      // Ask the launcher to check if the element exists by running a waitFor
      // with a very short timeout. If it throws, the element does not exist.
      const step: WorkflowStep = {
        id: `cond_${randomUUID()}`,
        type: 'waitFor',
        enabled: true,
        timeoutMs: 3000,
        retryPolicy: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed' },
        debug: { sourceEventIds: [], notes: [], tags: [], extra: {} },
        primaryLocator: condition.target.primaryLocator,
        fallbackLocators: condition.target.fallbackLocators ?? [],
        framePath: condition.target.framePath,
        condition: 'attached'
      };
      try {
        await ctx.launcher.executeStep(step, {
          runId: ctx.runId,
          stepIndex: -1,
          attempt: 1,
          signal: ctx.signal
        });
        return !condition.negate;
      } catch {
        return !!condition.negate;
      }
    }
    case 'urlMatches': {
      // This requires browser context. Simplified: delegate to launcher
      // via an assert step — real Playwright would check page.url().
      // For now, use a regex check against a stored variable.
      const currentUrl = ctx.variables.get('__currentUrl') ?? '';
      try {
        const matches = new RegExp(condition.pattern).test(currentUrl);
        return condition.negate ? !matches : matches;
      } catch {
        return false;
      }
    }
    case 'variableEquals': {
      const val = ctx.variables.get(condition.name);
      return val === condition.equals;
    }
  }
}

/**
 * Streams structured RunEvents for a workflow execution. Honors per-step
 * retryPolicy with capped backoff and AbortSignal-based cancellation.
 * Skips disabled steps. Supports starting from a specific step index.
 *
 * Handles control-flow step types: `if`, `loop`, `subworkflow`, and
 * `httpRequest` alongside the standard action step types.
 */
export async function* executeWorkflow(
  workflow: Workflow,
  options: ExecuteWorkflowOptions = {}
): AsyncIterable<RunEvent> {
  const launcher = options.launcher ?? noopBrowserLauncher;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? `run_${randomUUID()}`;
  const signal = options.signal ?? new AbortController().signal;
  const fromIndex = options.fromStepIndex ?? 0;
  const variables = options.variables ?? new Map<string, string>();

  const startedAt = now().toISOString();
  yield {
    kind: 'run.started',
    runId,
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    startedAt
  };

  let finalStatus: 'succeeded' | 'failed' | 'canceled' = 'succeeded';
  let finalError:
    | {
        code: string;
        message: string;
        stepId?: string;
        repairRecord?: RepairRecord;
      }
    | undefined;

  /**
   * Execute a flat list of steps. Shared between top-level and nested
   * (if/loop) contexts.
   */
  async function* executeSteps(
    steps: WorkflowStep[],
    startIndex: number
  ): AsyncGenerator<RunEvent, boolean> {
    for (let i = startIndex; i < steps.length; i++) {
      if (signal.aborted) {
        finalStatus = 'canceled';
        return false;
      }
      const step = steps[i]!;

      if ('enabled' in step && step.enabled === false) {
        continue;
      }

      // ---- Control flow: if ----
      if (step.type === 'if') {
        const stepStartedAt = now().toISOString();
        const stepStartMs = Date.now();
        yield {
          kind: 'step.started',
          runId,
          stepId: step.id,
          stepIndex: i,
          stepType: 'if',
          startedAt: stepStartedAt,
          attempt: 1
        };
        try {
          const met = await evaluateCondition(step.condition, {
            launcher,
            runId,
            signal,
            variables
          });
          const branch = met ? step.thenSteps : step.elseSteps;
          if (branch.length > 0) {
            const ok = yield* executeSteps(branch, 0);
            if (!ok) return false;
          }
          yield {
            kind: 'step.succeeded',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Condition evaluation failed.';
          finalError = { code: 'step_failed', message, stepId: step.id };
          yield {
            kind: 'step.failed',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs,
            error: finalError
          };
          finalStatus = 'failed';
          return false;
        }
        continue;
      }

      // ---- Control flow: loop ----
      if (step.type === 'loop') {
        const stepStartedAt = now().toISOString();
        const stepStartMs = Date.now();
        yield {
          kind: 'step.started',
          runId,
          stepId: step.id,
          stepIndex: i,
          stepType: 'loop',
          startedAt: stepStartedAt,
          attempt: 1
        };
        try {
          const iter = step.iteration;
          const maxIter =
            iter.kind === 'count' ? iter.count : iter.maxIterations;
          for (let n = 0; n < maxIter; n++) {
            if (signal.aborted) {
              finalStatus = 'canceled';
              return false;
            }
            if (iter.kind === 'whileCondition') {
              const met = await evaluateCondition(iter.condition, {
                launcher,
                runId,
                signal,
                variables
              });
              if (!met) break;
            }
            const ok = yield* executeSteps(step.bodySteps, 0);
            if (!ok) return false;
          }
          yield {
            kind: 'step.succeeded',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Loop execution failed.';
          finalError = { code: 'step_failed', message, stepId: step.id };
          yield {
            kind: 'step.failed',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs,
            error: finalError
          };
          finalStatus = 'failed';
          return false;
        }
        continue;
      }

      // ---- Control flow: subworkflow ----
      if (step.type === 'subworkflow') {
        const stepStartedAt = now().toISOString();
        const stepStartMs = Date.now();
        yield {
          kind: 'step.started',
          runId,
          stepId: step.id,
          stepIndex: i,
          stepType: 'subworkflow',
          startedAt: stepStartedAt,
          attempt: 1
        };
        const resolve = options.resolveSubworkflow;
        const sub = resolve ? resolve(step.workflowId) : null;
        if (!sub) {
          finalError = {
            code: 'step_failed',
            message: `Subworkflow ${step.workflowId} not found.`,
            stepId: step.id
          };
          yield {
            kind: 'step.failed',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs,
            error: finalError
          };
          finalStatus = 'failed';
          return false;
        }
        const ok = yield* executeSteps(sub.steps, 0);
        if (!ok) return false;
        yield {
          kind: 'step.succeeded',
          runId,
          stepId: step.id,
          stepIndex: i,
          finishedAt: now().toISOString(),
          durationMs: Date.now() - stepStartMs
        };
        continue;
      }

      // ---- HTTP request ----
      if (step.type === 'httpRequest') {
        const stepStartedAt = now().toISOString();
        const stepStartMs = Date.now();
        yield {
          kind: 'step.started',
          runId,
          stepId: step.id,
          stepIndex: i,
          stepType: 'httpRequest',
          startedAt: stepStartedAt,
          attempt: 1
        };
        try {
          const fetchInit: RequestInit = {
            method: step.method,
            headers: step.headers,
            signal
          };
          if (step.method !== 'GET' && step.method !== 'HEAD' && step.body) {
            fetchInit.body = step.body;
          }
          const resp = await fetch(step.url, fetchInit);
          const text = await resp.text();
          if (step.storeAs) {
            variables.set(step.storeAs, text);
          }
          if (!resp.ok) {
            throw new Error(
              `HTTP ${resp.status.toString()} ${resp.statusText}`
            );
          }
          yield {
            kind: 'step.succeeded',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs
          };
        } catch (err) {
          const failureCode: FailureCode = classifyError(err, step);
          const message =
            err instanceof Error ? err.message : 'HTTP request failed.';
          finalError = { code: failureCode, message, stepId: step.id };
          yield {
            kind: 'step.failed',
            runId,
            stepId: step.id,
            stepIndex: i,
            finishedAt: now().toISOString(),
            durationMs: Date.now() - stepStartMs,
            error: finalError
          };
          finalStatus = 'failed';
          return false;
        }
        continue;
      }

      // ---- Standard action steps (with retry) ----
      const policy = step.retryPolicy;
      const maxAttempts = policy.maxAttempts;

      let attempt = 1;
      let succeeded = false;

      while (attempt <= maxAttempts) {
        if (signal.aborted) {
          finalStatus = 'canceled';
          return false;
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
          const result = await launcher.executeStep(step, {
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
            durationMs: Date.now() - stepStartMs,
            ...(result?.resolvedLocator
              ? { resolvedLocator: result.resolvedLocator }
              : {}),
            ...(result?.usedFallback !== undefined
              ? { usedFallback: result.usedFallback }
              : {})
          };
          succeeded = true;
          break;
        } catch (err) {
          const failureCode: FailureCode = classifyError(err, step);

          if (attempt < maxAttempts) {
            const delayMs = computeRetryDelay(
              attempt,
              policy.backoffMs,
              policy.strategy
            );
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
          const finishedAt = now().toISOString();
          const message =
            err instanceof Error ? err.message : 'Step execution failed.';
          finalError = {
            code: failureCode,
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
          return false;
        }
      }

      if (!succeeded) return false;
    }

    return true;
  }

  yield* executeSteps(workflow.steps, fromIndex);

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
