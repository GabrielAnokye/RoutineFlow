/**
 * Converts between graph editor nodes/edges and workflow steps for
 * replay execution and workflow import.
 *
 * Key design: when importing from a saved workflow, each node stores the
 * original WorkflowStep as `_originalStep`. During replay, if this field
 * exists the original step is used directly — preserving the full locator
 * chain (role, testId, fallbacks, etc.) that the recorder captured.
 * The simplified fields (selector, value, url) are only used for display
 * and for nodes created manually in the editor.
 */

import type { WorkflowStep } from '@routineflow/shared-types';
import {
  createDefaultData,
  type GraphEdge,
  type GraphNode,
  type GraphNodeData,
  type GraphNodeType,
} from './types';

// ---- Graph → Replay steps ----

/**
 * Walks graph edges in topological order starting from the trigger node
 * and converts each graph node into a replay-compatible step object.
 */
export function graphToSteps(
  nodes: GraphNode[],
  edges: GraphEdge[]
): { steps: Record<string, unknown>[]; nodeOrder: string[] } {
  // BFS from trigger
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.source) ?? [];
    list.push(e.target);
    adjacency.set(e.source, list);
  }

  const visited = new Set<string>();
  const nodeOrder: string[] = [];
  const queue = ['trigger_1'];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    nodeOrder.push(id);

    const children = adjacency.get(id) ?? [];
    for (const child of children) {
      if (!visited.has(child)) queue.push(child);
    }
  }

  const steps: Record<string, unknown>[] = [];
  for (const id of nodeOrder) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const data = node.data as GraphNodeData;
    const step = nodeDataToStep(data);
    if (step) steps.push(step);
  }

  return { steps, nodeOrder };
}

function nodeDataToStep(data: GraphNodeData): Record<string, unknown> | null {
  // If this node was imported from a workflow, use the original step directly.
  // This preserves the full locator chain (role, testId, fallbacks).
  const originalStep = (data as Record<string, unknown>)._originalStep as Record<string, unknown> | undefined;
  if (originalStep) {
    return originalStep;
  }

  // Otherwise, build a step from the editor fields (manually created nodes).
  switch (data.nodeType) {
    case 'trigger':
      return null;

    case 'goto':
      return {
        type: 'goto',
        url: data.url,
        waitUntil: data.waitUntil,
      };

    case 'newTab':
      return {
        type: 'newTab',
        initialUrl: data.initialUrl || undefined,
      };

    case 'closeTab':
      return { type: 'closeTab' };

    case 'click':
      return {
        type: 'click',
        primaryLocator: data.selector ? { kind: 'css', selector: data.selector } : undefined,
        fallbackLocators: [],
        button: data.button,
        clickCount: data.clickCount,
      };

    case 'type':
      return {
        type: 'type',
        primaryLocator: data.selector ? { kind: 'css', selector: data.selector } : undefined,
        fallbackLocators: [],
        value: data.value,
        clearBefore: data.clearBefore,
      };

    case 'getText':
      return {
        type: 'waitFor',
        primaryLocator: data.selector ? { kind: 'css', selector: data.selector } : undefined,
        fallbackLocators: [],
        condition: 'visible',
      };

    case 'condition':
      return {
        type: 'waitFor',
        primaryLocator: data.value ? { kind: 'css', selector: data.value } : undefined,
        fallbackLocators: [],
        condition: data.conditionType === 'elementExists' ? 'attached' : 'visible',
      };

    case 'loop':
      return null;

    case 'delay':
      return {
        type: 'waitFor',
        primaryLocator: { kind: 'css', selector: 'body' },
        fallbackLocators: [],
        condition: 'visible',
        timeoutMs: data.delayMs,
      };
  }
}

// ---- Workflow steps → Graph nodes ----

/**
 * Converts an array of WorkflowSteps (from a saved workflow) into
 * graph nodes and edges for the editor.
 *
 * Each node stores the full original step as `_originalStep` so that
 * replay can use the exact same locators the recorder captured.
 */
export function stepsToGraph(
  steps: WorkflowStep[],
  workflowName?: string | undefined
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const triggerNode: GraphNode = {
    id: 'trigger_1',
    type: 'trigger',
    position: { x: 300, y: 50 },
    data: {
      nodeType: 'trigger',
      label: workflowName ?? 'Trigger',
      triggerType: 'manual',
    },
  };
  nodes.push(triggerNode);

  let prevId = 'trigger_1';
  const ySpacing = 120;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const nodeId = `imported_${i}`;
    const nodeType = stepTypeToNodeType(step.type);
    const data = stepToNodeData(step, nodeType);

    const node: GraphNode = {
      id: nodeId,
      type: nodeType,
      position: { x: 300, y: 50 + (i + 1) * ySpacing },
      data,
    };
    nodes.push(node);

    edges.push({
      id: `edge_${prevId}_${nodeId}`,
      source: prevId,
      target: nodeId,
    });
    prevId = nodeId;
  }

  return { nodes, edges };
}

function stepTypeToNodeType(stepType: string): GraphNodeType {
  switch (stepType) {
    case 'goto': return 'goto';
    case 'newTab': return 'newTab';
    case 'closeTab': return 'closeTab';
    case 'click': return 'click';
    case 'type': return 'type';
    case 'select': return 'click';
    case 'press': return 'click';
    case 'waitFor': return 'delay';
    case 'assert': return 'condition';
    case 'if': return 'condition';
    case 'loop': return 'loop';
    default: return 'goto';
  }
}

function stepToNodeData(step: WorkflowStep, nodeType: GraphNodeType): GraphNodeData {
  const base = createDefaultData(nodeType);

  // Store the full original step so replay can use exact locators.
  const withOriginal = (d: GraphNodeData): GraphNodeData => {
    (d as Record<string, unknown>)._originalStep = step;
    return d;
  };

  switch (step.type) {
    case 'goto':
      return withOriginal({ ...base, nodeType: 'goto', label: step.label ?? `Go to ${truncate(step.url, 30)}`, url: step.url, waitUntil: step.waitUntil });

    case 'newTab':
      return withOriginal({ ...base, nodeType: 'newTab', label: step.label ?? 'New Tab', initialUrl: step.initialUrl ?? '' });

    case 'closeTab':
      return withOriginal({ ...base, nodeType: 'closeTab', label: step.label ?? 'Close Tab' });

    case 'click':
      return withOriginal({
        ...base, nodeType: 'click',
        label: step.label ?? `Click ${locatorLabel(step.primaryLocator)}`,
        selector: locatorDisplay(step.primaryLocator),
        button: step.button, clickCount: step.clickCount,
      });

    case 'type':
      return withOriginal({
        ...base, nodeType: 'type',
        label: step.label ?? `Type "${truncate(step.value, 20)}"`,
        selector: locatorDisplay(step.primaryLocator),
        value: step.value, clearBefore: step.clearBefore,
      });

    case 'select':
      return withOriginal({
        ...base, nodeType: 'click',
        label: step.label ?? `Select ${String(step.option.value)}`,
        selector: locatorDisplay(step.primaryLocator),
        button: 'left', clickCount: 1,
      });

    case 'press':
      return withOriginal({
        ...base, nodeType: 'click',
        label: step.label ?? `Press ${step.key}`,
        selector: locatorDisplay(step.primaryLocator),
        button: 'left', clickCount: 1,
      });

    case 'waitFor':
      return withOriginal({
        ...base, nodeType: 'delay',
        label: step.label ?? `Wait: ${step.condition}`,
        delayMs: step.timeoutMs,
      });

    case 'assert':
      return withOriginal({
        ...base, nodeType: 'condition',
        label: step.label ?? `Assert ${step.assertion.kind}`,
        conditionType: 'elementExists', value: locatorDisplay(step.primaryLocator),
      });

    case 'if':
      return withOriginal({
        ...base, nodeType: 'condition',
        label: step.label ?? 'Condition',
        conditionType: 'custom', value: step.condition.kind,
      });

    case 'loop':
      return withOriginal({
        ...base, nodeType: 'loop',
        label: step.label ?? 'Loop',
        loopType: step.iteration.kind === 'count' ? 'count' : 'whileVisible',
        count: step.iteration.kind === 'count' ? step.iteration.count : 3,
        selector: '',
      });

    default:
      return base;
  }
}

// ---- Helpers ----

/** Human-readable display string for a locator (shown in the node UI). */
function locatorDisplay(loc: { kind: string; [key: string]: unknown }): string {
  switch (loc.kind) {
    case 'role': return loc.name ? `role:${loc.role as string}("${loc.name as string}")` : `role:${loc.role as string}`;
    case 'testId': return `testId:${loc.testId as string}`;
    case 'css': return loc.selector as string;
    case 'xpath': return `xpath:${truncate(loc.selector as string, 30)}`;
    case 'label': return `label:"${loc.label as string}"`;
    case 'placeholder': return `placeholder:"${loc.placeholder as string}"`;
    case 'text': return `text:"${truncate(loc.text as string, 20)}"`;
    case 'coordinates': return `(${loc.x as number},${loc.y as number})`;
    default: return loc.kind;
  }
}

function locatorLabel(loc: { kind: string; [key: string]: unknown }): string {
  switch (loc.kind) {
    case 'role': return `${loc.role as string}("${(loc.name as string) ?? ''}")`;
    case 'testId': return `testId:${loc.testId as string}`;
    case 'css': return truncate(loc.selector as string, 30);
    case 'text': return `"${truncate(loc.text as string, 20)}"`;
    case 'label': return `label:"${loc.label as string}"`;
    default: return loc.kind;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
