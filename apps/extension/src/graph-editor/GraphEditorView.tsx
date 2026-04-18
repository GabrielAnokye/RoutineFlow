import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api } from '../api';
import { useGraphEditorStore } from './store';
import { nodeTypes } from './nodes';
import { Sidebar } from './Sidebar';
import { ConfigPanel } from './ConfigPanel';
import { graphToSteps, stepsToGraph } from './convert';
import type { GraphEdge, GraphNode, GraphNodeType } from './types';
import { useExtensionStore } from '../store';

// ---- Export / Import helpers ----

interface WorkflowGraph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function exportGraph(nodes: GraphNode[], edges: GraphEdge[]): string {
  const graph: WorkflowGraph = { version: 1, nodes, edges };
  return JSON.stringify(graph, null, 2);
}

function validateImport(json: string): { valid: true; data: WorkflowGraph } | { valid: false; error: string } {
  try {
    const parsed = JSON.parse(json) as WorkflowGraph;
    if (parsed.version !== 1) return { valid: false, error: 'Unsupported graph version.' };
    if (!Array.isArray(parsed.nodes)) return { valid: false, error: 'Missing nodes array.' };
    if (!Array.isArray(parsed.edges)) return { valid: false, error: 'Missing edges array.' };
    const hasTrigger = parsed.nodes.some((n) => n.type === 'trigger');
    if (!hasTrigger) return { valid: false, error: 'Graph must contain a Trigger node.' };
    return { valid: true, data: parsed };
  } catch {
    return { valid: false, error: 'Invalid JSON.' };
  }
}

// ---- Main component ----

export function GraphEditorView() {
  const setView = useExtensionStore((s) => s.setView);
  const setAppStatus = useExtensionStore((s) => s.setStatus);
  const workflows = useExtensionStore((s) => s.workflows);
  const workflowOrder = useExtensionStore((s) => s.workflowOrder);

  const {
    nodes, edges, selectedNodeId,
    onNodesChange, onEdgesChange, onConnect,
    setSelectedNodeId, addNode,
    executionMode, setExecutionMode, clearExecutionState,
    setNodeExecutionState,
    undo, redo, past, future,
    loadGraph, resetGraph,
  } = useGraphEditorStore();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [importMode, setImportMode] = useState<'json' | 'workflow' | null>(null);
  const [importJson, setImportJson] = useState('');
  const [running, setRunning] = useState(false);
  const reactFlowRef = useRef<ReactFlowInstance<GraphNode, GraphEdge> | null>(null);

  // Fetch workflows for the import picker
  useEffect(() => {
    void api.listWorkflows().then(({ workflows: list }) => {
      useExtensionStore.getState().setWorkflows(list);
    }).catch(() => { /* silent */ });
  }, []);

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't intercept when typing in an input
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        e.preventDefault();
        const store = useGraphEditorStore.getState();
        if (selectedEdgeId) {
          store.deleteEdge(selectedEdgeId);
          setSelectedEdgeId(null);
        } else if (selectedNodeId) {
          store.deleteNode(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, selectedNodeId, selectedEdgeId]);

  // Drop handler for sidebar drag
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/routineflow-node') as GraphNodeType;
      if (!type) return;

      const rfInstance = reactFlowRef.current;
      if (!rfInstance) return;

      const position = rfInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      addNode(type, position);
    },
    [addNode]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
    },
    [setSelectedNodeId]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: GraphEdge) => {
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
    },
    [setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setSelectedNodeId]);

  // ---- Export ----
  const handleExport = () => {
    const json = exportGraph(nodes, edges);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow-graph.json';
    a.click();
    URL.revokeObjectURL(url);
    setAppStatus('ready', 'Workflow exported.');
  };

  // ---- Import JSON ----
  const handleImportJson = () => {
    const result = validateImport(importJson);
    if (!result.valid) {
      setAppStatus('error', result.error);
      return;
    }
    loadGraph(result.data.nodes, result.data.edges);
    setImportMode(null);
    setImportJson('');
    setAppStatus('ready', 'Workflow imported from JSON.');
  };

  // ---- Import from saved workflow ----
  const handleImportWorkflow = async (workflowId: string) => {
    try {
      const { workflow } = await api.getWorkflowDefinition(workflowId);
      const { nodes: graphNodes, edges: graphEdges } = stepsToGraph(workflow.steps, workflow.name);
      loadGraph(graphNodes, graphEdges);
      setImportMode(null);
      setAppStatus('ready', `Imported "${workflow.name}" (${workflow.steps.length} steps).`);
    } catch (err) {
      setAppStatus('error', err instanceof Error ? err.message : 'Failed to import workflow.');
    }
  };

  // ---- Run: real in-tab replay ----
  const handleRun = async () => {
    const { steps, nodeOrder } = graphToSteps(nodes, edges);
    if (steps.length === 0) {
      setAppStatus('error', 'No executable steps in graph. Add nodes after the Trigger.');
      return;
    }

    setRunning(true);
    setExecutionMode(true);
    clearExecutionState();

    // Mark trigger as success immediately
    setNodeExecutionState('trigger_1', { status: 'success', log: 'Started' });

    // Map step index → node id (skip trigger and nodes that produced no step)
    const stepToNodeId: string[] = [];
    for (const id of nodeOrder) {
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      const data = node.data as Record<string, unknown>;
      const nt = data.nodeType as string;
      // trigger and loop don't produce steps
      if (nt === 'trigger' || nt === 'loop') continue;
      stepToNodeId.push(id);
    }

    // Mark all non-trigger nodes as pending
    for (const id of nodeOrder) {
      if (id !== 'trigger_1') {
        setNodeExecutionState(id, { status: 'idle' });
      }
    }

    try {
      setAppStatus('ready', 'Replaying workflow in current tab...');
      const response = await api.replayWorkflow('graph-editor', steps);

      if (response.ok && response.payload) {
        const { status, stepResults } = response.payload;

        // Update node states from step results
        for (const result of stepResults) {
          const nodeId = stepToNodeId[result.stepIndex];
          if (nodeId) {
            setNodeExecutionState(nodeId, {
              status: result.ok ? 'success' : 'error',
              log: result.ok ? `Done (${result.durationMs}ms)` : (result.error ?? 'Failed'),
              durationMs: result.durationMs,
            });
          }
        }

        // Mark unexecuted nodes as skipped
        for (const id of stepToNodeId) {
          const state = useGraphEditorStore.getState().executionState[id];
          if (!state || state.status === 'idle') {
            setNodeExecutionState(id, { status: 'skipped', log: 'Skipped' });
          }
        }

        if (status === 'succeeded') {
          const passed = stepResults.filter((s) => s.ok).length;
          setAppStatus('ready', `Replay succeeded: ${passed}/${stepResults.length} steps passed.`);
        } else {
          const failed = stepResults.find((s) => !s.ok);
          setAppStatus('error', `Replay failed at step ${(failed?.stepIndex ?? 0) + 1} (${failed?.stepType}): ${failed?.error ?? 'unknown'}`);
        }
      } else {
        setAppStatus('error', response.message ?? 'Replay failed.');
      }
    } catch (err) {
      setAppStatus('error', err instanceof Error ? err.message : 'Run failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ge-root">
      {/* Toolbar */}
      <div className="ge-toolbar">
        <button className="rf-button" onClick={() => setView('workflows')} style={{ fontSize: 12, padding: '4px 10px' }}>
          Back
        </button>
        <div className="ge-toolbar__spacer" />

        <button className="ge-toolbar__btn" onClick={undo} disabled={past.length === 0} title="Undo">
          Undo
        </button>
        <button className="ge-toolbar__btn" onClick={redo} disabled={future.length === 0} title="Redo">
          Redo
        </button>

        <div className="ge-toolbar__divider" />

        <button className="ge-toolbar__btn" onClick={handleExport}>Export</button>
        <button className="ge-toolbar__btn" onClick={() => setImportMode(importMode ? null : 'json')}>
          Import
        </button>
        <button className="ge-toolbar__btn" onClick={resetGraph}>New</button>

        <div className="ge-toolbar__divider" />

        {executionMode ? (
          <button className="ge-toolbar__btn ge-toolbar__btn--active" onClick={() => setExecutionMode(false)}>
            Exit execution
          </button>
        ) : (
          <button className="ge-toolbar__btn ge-toolbar__btn--run" onClick={() => void handleRun()} disabled={running}>
            {running ? 'Running...' : 'Run'}
          </button>
        )}
      </div>

      {/* Import panel */}
      {importMode && (
        <div className="ge-import">
          <div className="ge-import__tabs">
            <button
              className={`ge-import__tab ${importMode === 'json' ? 'ge-import__tab--active' : ''}`}
              onClick={() => setImportMode('json')}
            >
              Paste JSON
            </button>
            <button
              className={`ge-import__tab ${importMode === 'workflow' ? 'ge-import__tab--active' : ''}`}
              onClick={() => setImportMode('workflow')}
            >
              From workflow
            </button>
          </div>

          {importMode === 'json' && (
            <>
              <textarea
                className="rf-input"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder="Paste workflow JSON here..."
                rows={6}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="rf-button" onClick={handleImportJson}>Load</button>
                <button className="rf-button rf-button--danger" onClick={() => { setImportMode(null); setImportJson(''); }}>Cancel</button>
              </div>
            </>
          )}

          {importMode === 'workflow' && (
            <div className="ge-import__workflow-list">
              {workflowOrder.length === 0 ? (
                <p className="rf-message" style={{ fontSize: 12 }}>No saved workflows. Record one first.</p>
              ) : (
                workflowOrder.map((id) => {
                  const wf = workflows[id];
                  if (!wf) return null;
                  return (
                    <button
                      key={id}
                      className="ge-import__workflow-item"
                      onClick={() => void handleImportWorkflow(id)}
                    >
                      <span className="ge-import__workflow-name">{wf.name}</span>
                      <span className="ge-import__workflow-meta">
                        v{wf.latestVersion} &middot; {new Date(wf.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  );
                })
              )}
              <div style={{ marginTop: 6 }}>
                <button className="rf-button rf-button--danger" onClick={() => setImportMode(null)} style={{ fontSize: 11, padding: '4px 8px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main layout */}
      <div className="ge-layout">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <div className="ge-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges.map((e) => {
              if (executionMode) {
                return { ...e, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } };
              }
              if (e.id === selectedEdgeId) {
                return { ...e, selected: true, style: { stroke: '#ef4444', strokeWidth: 3 } };
              }
              return e;
            })}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onInit={(instance) => { reactFlowRef.current = instance; }}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { strokeWidth: 2, stroke: '#94a3b8' },
            }}
          >
            <Background gap={16} size={1} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => {
                const colors: Record<string, string> = {
                  trigger: '#6366f1', newTab: '#0ea5e9', goto: '#0d5b86',
                  click: '#f97316', type: '#8b5cf6', getText: '#14b8a6',
                  condition: '#eab308', loop: '#ec4899', delay: '#64748b', closeTab: '#ef4444',
                };
                return colors[n.type ?? ''] ?? '#94a3b8';
              }}
              style={{ height: 80, width: 120 }}
            />
          </ReactFlow>
        </div>

        {selectedNodeId && !executionMode && <ConfigPanel />}
      </div>
    </div>
  );
}
