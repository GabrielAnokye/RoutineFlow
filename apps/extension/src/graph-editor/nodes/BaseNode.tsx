import { memo, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';

import { useGraphEditorStore } from '../store';
import type { NodeExecutionStatus } from '../types';

const STATUS_COLORS: Record<NodeExecutionStatus, string> = {
  idle: '#d0d5da',
  running: '#f59e0b',
  success: '#10b981',
  error: '#ef4444',
  skipped: '#94a3b8',
};

const STATUS_BG: Record<NodeExecutionStatus, string> = {
  idle: 'transparent',
  running: 'rgba(245,158,11,0.08)',
  success: 'rgba(16,185,129,0.08)',
  error: 'rgba(239,68,68,0.08)',
  skipped: 'rgba(148,163,184,0.08)',
};

interface BaseNodeProps {
  id: string;
  icon: string;
  color: string;
  label: string;
  subtitle?: string | undefined;
  showInput?: boolean;
  showOutput?: boolean;
  showTrueOutput?: boolean;
  showFalseOutput?: boolean;
  children?: ReactNode;
}

export const BaseNode = memo(function BaseNode({
  id,
  icon,
  color,
  label,
  subtitle,
  showInput = true,
  showOutput = true,
  showTrueOutput = false,
  showFalseOutput = false,
  children,
}: BaseNodeProps) {
  const selectedNodeId = useGraphEditorStore((s) => s.selectedNodeId);
  const executionMode = useGraphEditorStore((s) => s.executionMode);
  const execState = useGraphEditorStore((s) => s.executionState[id]);
  const isSelected = selectedNodeId === id;
  const status: NodeExecutionStatus = execState?.status ?? 'idle';

  return (
    <div
      className="ge-node"
      style={{
        borderColor: isSelected ? color : 'rgba(68,96,116,0.2)',
        boxShadow: isSelected ? `0 0 0 2px ${color}33` : undefined,
        background: executionMode ? STATUS_BG[status] : undefined,
      }}
    >
      {/* Status indicator */}
      {executionMode && (
        <div
          className="ge-node__status"
          style={{ background: STATUS_COLORS[status] }}
        />
      )}

      {/* Header */}
      <div className="ge-node__header" style={{ borderLeftColor: color }}>
        <span className="ge-node__icon">{icon}</span>
        <div className="ge-node__titles">
          <span className="ge-node__label">{label}</span>
          {subtitle && <span className="ge-node__subtitle">{subtitle}</span>}
        </div>
      </div>

      {/* Body */}
      {children && <div className="ge-node__body">{children}</div>}

      {/* Execution log */}
      {executionMode && execState?.log && (
        <div className="ge-node__log">{execState.log}</div>
      )}

      {/* Handles */}
      {showInput && (
        <Handle type="target" position={Position.Top} className="ge-handle" />
      )}
      {showOutput && !showTrueOutput && (
        <Handle type="source" position={Position.Bottom} className="ge-handle" />
      )}
      {showTrueOutput && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="ge-handle ge-handle--true"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="ge-handle ge-handle--false"
            style={{ left: '70%' }}
          />
        </>
      )}
      {showFalseOutput && !showTrueOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="loop"
          className="ge-handle"
        />
      )}
    </div>
  );
});
