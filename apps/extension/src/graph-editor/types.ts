import type { Edge, Node } from '@xyflow/react';

// ---- Node type identifiers ----

export const NODE_TYPES = [
  'trigger', 'newTab', 'goto', 'click', 'type',
  'getText', 'condition', 'loop', 'delay', 'closeTab'
] as const;

export type GraphNodeType = (typeof NODE_TYPES)[number];

// ---- Node data payloads ----
// All data interfaces extend Record<string, unknown> to satisfy React Flow's
// generic constraint under exactOptionalPropertyTypes.

export interface TriggerData extends Record<string, unknown> {
  nodeType: 'trigger'; label: string; triggerType: 'manual' | 'schedule' | 'webhook';
}
export interface NewTabData extends Record<string, unknown> {
  nodeType: 'newTab'; label: string; initialUrl: string;
}
export interface GotoData extends Record<string, unknown> {
  nodeType: 'goto'; label: string; url: string; waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
}
export interface ClickData extends Record<string, unknown> {
  nodeType: 'click'; label: string; selector: string; button: 'left' | 'middle' | 'right'; clickCount: number;
}
export interface TypeData extends Record<string, unknown> {
  nodeType: 'type'; label: string; selector: string; value: string; clearBefore: boolean;
}
export interface GetTextData extends Record<string, unknown> {
  nodeType: 'getText'; label: string; selector: string; variableName: string;
}
export interface ConditionData extends Record<string, unknown> {
  nodeType: 'condition'; label: string; conditionType: 'elementExists' | 'textContains' | 'urlMatches' | 'custom'; value: string;
}
export interface LoopData extends Record<string, unknown> {
  nodeType: 'loop'; label: string; loopType: 'count' | 'whileVisible' | 'forEach'; count: number; selector: string;
}
export interface DelayData extends Record<string, unknown> {
  nodeType: 'delay'; label: string; delayMs: number;
}
export interface CloseTabData extends Record<string, unknown> {
  nodeType: 'closeTab'; label: string;
}

export type GraphNodeData =
  | TriggerData | NewTabData | GotoData | ClickData | TypeData
  | GetTextData | ConditionData | LoopData | DelayData | CloseTabData;

// ---- Execution state ----

export type NodeExecutionStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export interface NodeExecutionState {
  status: NodeExecutionStatus;
  log?: string | undefined;
  durationMs?: number | undefined;
}

// ---- Typed node / edge ----

export type GraphNode = Node<GraphNodeData>;
export type GraphEdge = Edge;

// ---- Node category for the palette ----

export interface NodeCategory {
  name: string;
  items: { type: GraphNodeType; label: string; description: string }[];
}

export const NODE_CATEGORIES: NodeCategory[] = [
  {
    name: 'Flow Control',
    items: [
      { type: 'trigger', label: 'Trigger', description: 'Start point of the workflow' },
      { type: 'condition', label: 'Condition', description: 'Branch based on a condition' },
      { type: 'loop', label: 'Loop', description: 'Repeat steps multiple times' },
      { type: 'delay', label: 'Delay', description: 'Wait for a duration' },
    ]
  },
  {
    name: 'Browser',
    items: [
      { type: 'newTab', label: 'New Tab', description: 'Open a new browser tab' },
      { type: 'goto', label: 'Go To URL', description: 'Navigate to a URL' },
      { type: 'closeTab', label: 'Close Tab', description: 'Close the current tab' },
    ]
  },
  {
    name: 'Interaction',
    items: [
      { type: 'click', label: 'Click', description: 'Click an element' },
      { type: 'type', label: 'Type', description: 'Type text into a field' },
      { type: 'getText', label: 'Get Text', description: 'Extract text from element' },
    ]
  }
];

// ---- Default data factories ----

export function createDefaultData(nodeType: GraphNodeType): GraphNodeData {
  switch (nodeType) {
    case 'trigger': return { nodeType, label: 'Trigger', triggerType: 'manual' };
    case 'newTab': return { nodeType, label: 'New Tab', initialUrl: '' };
    case 'goto': return { nodeType, label: 'Go To URL', url: '', waitUntil: 'load' };
    case 'click': return { nodeType, label: 'Click', selector: '', button: 'left', clickCount: 1 };
    case 'type': return { nodeType, label: 'Type', selector: '', value: '', clearBefore: true };
    case 'getText': return { nodeType, label: 'Get Text', selector: '', variableName: '' };
    case 'condition': return { nodeType, label: 'Condition', conditionType: 'elementExists', value: '' };
    case 'loop': return { nodeType, label: 'Loop', loopType: 'count', count: 3, selector: '' };
    case 'delay': return { nodeType, label: 'Delay', delayMs: 1000 };
    case 'closeTab': return { nodeType, label: 'Close Tab' };
  }
}
