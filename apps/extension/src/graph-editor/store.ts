import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';

import {
  createDefaultData,
  type GraphNode,
  type GraphEdge,
  type GraphNodeType,
  type GraphNodeData,
  type NodeExecutionState,
} from './types';

// ---- Undo/redo snapshot ----

interface Snapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---- Store shape ----

interface GraphEditorStore {
  // Graph state
  nodes: GraphNode[];
  edges: GraphEdge[];

  // Selection
  selectedNodeId: string | null;

  // Execution visualization
  executionMode: boolean;
  executionState: Record<string, NodeExecutionState>;

  // Undo / redo
  past: Snapshot[];
  future: Snapshot[];

  // Actions
  onNodesChange: (changes: NodeChange<GraphNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<GraphEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  setSelectedNodeId: (id: string | null) => void;

  addNode: (type: GraphNodeType, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<GraphNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;

  // Undo / redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Execution
  setExecutionMode: (on: boolean) => void;
  setNodeExecutionState: (nodeId: string, state: NodeExecutionState) => void;
  clearExecutionState: () => void;

  // Import / export
  loadGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  resetGraph: () => void;
}

let nodeIdCounter = 0;
function nextNodeId(): string {
  nodeIdCounter++;
  return `node_${Date.now().toString(36)}_${nodeIdCounter}`;
}

const MAX_HISTORY = 50;

// Default trigger node
const defaultTrigger: GraphNode = {
  id: 'trigger_1',
  type: 'trigger',
  position: { x: 250, y: 50 },
  data: { nodeType: 'trigger', label: 'Trigger', triggerType: 'manual' },
};

export const useGraphEditorStore = create<GraphEditorStore>((set, get) => ({
  nodes: [defaultTrigger],
  edges: [],
  selectedNodeId: null,
  executionMode: false,
  executionState: {},
  past: [],
  future: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    const hasRemoval = changes.some((c) => c.type === 'remove');
    if (hasRemoval) get().pushSnapshot();
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    get().pushSnapshot();
    const edge: GraphEdge = {
      ...connection,
      id: `edge_${connection.source}_${connection.target}`,
      animated: false,
    };
    set({ edges: addEdge(edge, get().edges) });
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    get().pushSnapshot();
    const id = nextNodeId();
    const newNode: GraphNode = {
      id,
      type,
      position,
      data: createDefaultData(type),
    };
    set((s) => ({
      nodes: [...s.nodes, newNode],
      selectedNodeId: id,
    }));
  },

  updateNodeData: (nodeId, data) => {
    get().pushSnapshot();
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } as GraphNodeData } : n
      ),
    }));
  },

  deleteNode: (nodeId) => {
    if (nodeId === 'trigger_1') return; // Can't delete trigger
    get().pushSnapshot();
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
  },

  deleteEdge: (edgeId) => {
    get().pushSnapshot();
    set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) }));
  },

  pushSnapshot: () => {
    const { nodes, edges, past } = get();
    const snapshot: Snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)) as GraphNode[],
      edges: JSON.parse(JSON.stringify(edges)) as GraphEdge[],
    };
    set({
      past: [...past.slice(-(MAX_HISTORY - 1)), snapshot],
      future: [],
    });
  },

  undo: () => {
    const { past, nodes, edges } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1]!;
    const current: Snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)) as GraphNode[],
      edges: JSON.parse(JSON.stringify(edges)) as GraphEdge[],
    };
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      past: past.slice(0, -1),
      future: [...get().future, current],
    });
  },

  redo: () => {
    const { future, nodes, edges } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1]!;
    const current: Snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)) as GraphNode[],
      edges: JSON.parse(JSON.stringify(edges)) as GraphEdge[],
    };
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(0, -1),
      past: [...get().past, current],
    });
  },

  setExecutionMode: (on) => {
    if (!on) {
      set({ executionMode: false, executionState: {} });
    } else {
      set({ executionMode: true });
    }
  },

  setNodeExecutionState: (nodeId, state) => {
    set((s) => ({
      executionState: { ...s.executionState, [nodeId]: state },
    }));
  },

  clearExecutionState: () => set({ executionState: {} }),

  loadGraph: (nodes, edges) => {
    set({ nodes, edges, past: [], future: [], selectedNodeId: null, executionState: {} });
  },

  resetGraph: () => {
    set({
      nodes: [defaultTrigger],
      edges: [],
      past: [],
      future: [],
      selectedNodeId: null,
      executionState: {},
    });
  },
}));
