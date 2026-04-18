import { memo, useCallback } from 'react';

import { useGraphEditorStore } from './store';
import type { GraphNodeData } from './types';

export const ConfigPanel = memo(function ConfigPanel() {
  const selectedNodeId = useGraphEditorStore((s) => s.selectedNodeId);
  const nodes = useGraphEditorStore((s) => s.nodes);
  const updateNodeData = useGraphEditorStore((s) => s.updateNodeData);
  const deleteNode = useGraphEditorStore((s) => s.deleteNode);
  const setSelectedNodeId = useGraphEditorStore((s) => s.setSelectedNodeId);

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const data = node.data as GraphNodeData;

  return (
    <div className="ge-config">
      <div className="ge-config__header">
        <span className="ge-config__title">Configure: {data.label}</span>
        <button className="ge-config__close" onClick={() => setSelectedNodeId(null)}>&times;</button>
      </div>

      <div className="ge-config__body">
        {/* Common: label */}
        <Field label="Label">
          <input
            type="text"
            className="rf-input"
            value={data.label}
            onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
          />
        </Field>

        {/* Type-specific fields */}
        <TypeSpecificFields nodeId={node.id} data={data} onChange={updateNodeData} />
      </div>

      {/* Delete */}
      {node.id !== 'trigger_1' && (
        <div className="ge-config__footer">
          <button className="rf-button rf-button--danger" onClick={() => deleteNode(node.id)}>
            Delete node
          </button>
        </div>
      )}
    </div>
  );
});

// ---- Type-specific field renderers ----

interface TypeSpecificProps {
  nodeId: string;
  data: GraphNodeData;
  onChange: (nodeId: string, data: Partial<GraphNodeData>) => void;
}

const TypeSpecificFields = memo(function TypeSpecificFields({ nodeId, data, onChange }: TypeSpecificProps) {
  const update = useCallback(
    (partial: Partial<GraphNodeData>) => onChange(nodeId, partial),
    [nodeId, onChange]
  );

  switch (data.nodeType) {
    case 'trigger':
      return (
        <Field label="Trigger type">
          <select className="rf-input" value={data.triggerType} onChange={(e) => update({ triggerType: e.target.value as 'manual' | 'schedule' | 'webhook' })}>
            <option value="manual">Manual</option>
            <option value="schedule">Schedule</option>
            <option value="webhook">Webhook</option>
          </select>
        </Field>
      );

    case 'newTab':
      return (
        <Field label="Initial URL">
          <input className="rf-input" value={data.initialUrl} onChange={(e) => update({ initialUrl: e.target.value })} placeholder="https://example.com" />
        </Field>
      );

    case 'goto':
      return (
        <>
          <Field label="URL">
            <input className="rf-input" value={data.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com" />
          </Field>
          <Field label="Wait until">
            <select className="rf-input" value={data.waitUntil} onChange={(e) => update({ waitUntil: e.target.value as 'load' | 'domcontentloaded' | 'networkidle' })}>
              <option value="load">Load</option>
              <option value="domcontentloaded">DOM Content Loaded</option>
              <option value="networkidle">Network Idle</option>
            </select>
          </Field>
        </>
      );

    case 'click':
      return (
        <>
          <Field label="Selector">
            <input className="rf-input" value={data.selector} onChange={(e) => update({ selector: e.target.value })} placeholder="button.submit" />
          </Field>
          <Field label="Button">
            <select className="rf-input" value={data.button} onChange={(e) => update({ button: e.target.value as 'left' | 'middle' | 'right' })}>
              <option value="left">Left</option>
              <option value="middle">Middle</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Click count">
            <input className="rf-input" type="number" min={1} max={3} value={data.clickCount} onChange={(e) => update({ clickCount: Number(e.target.value) })} />
          </Field>
        </>
      );

    case 'type':
      return (
        <>
          <Field label="Selector">
            <input className="rf-input" value={data.selector} onChange={(e) => update({ selector: e.target.value })} placeholder="input#email" />
          </Field>
          <Field label="Value">
            <input className="rf-input" value={data.value} onChange={(e) => update({ value: e.target.value })} placeholder="Text to type" />
          </Field>
          <label className="ge-config__checkbox">
            <input type="checkbox" checked={data.clearBefore} onChange={(e) => update({ clearBefore: e.target.checked })} />
            Clear field before typing
          </label>
        </>
      );

    case 'getText':
      return (
        <>
          <Field label="Selector">
            <input className="rf-input" value={data.selector} onChange={(e) => update({ selector: e.target.value })} placeholder=".result-text" />
          </Field>
          <Field label="Store as variable">
            <input className="rf-input" value={data.variableName} onChange={(e) => update({ variableName: e.target.value })} placeholder="myVariable" />
          </Field>
        </>
      );

    case 'condition':
      return (
        <>
          <Field label="Condition type">
            <select className="rf-input" value={data.conditionType} onChange={(e) => update({ conditionType: e.target.value as 'elementExists' | 'textContains' | 'urlMatches' | 'custom' })}>
              <option value="elementExists">Element exists</option>
              <option value="textContains">Text contains</option>
              <option value="urlMatches">URL matches</option>
              <option value="custom">Custom expression</option>
            </select>
          </Field>
          <Field label="Value">
            <input className="rf-input" value={data.value} onChange={(e) => update({ value: e.target.value })} placeholder={data.conditionType === 'elementExists' ? 'CSS selector' : 'Value to check'} />
          </Field>
        </>
      );

    case 'loop':
      return (
        <>
          <Field label="Loop type">
            <select className="rf-input" value={data.loopType} onChange={(e) => update({ loopType: e.target.value as 'count' | 'whileVisible' | 'forEach' })}>
              <option value="count">Fixed count</option>
              <option value="whileVisible">While element visible</option>
              <option value="forEach">For each element</option>
            </select>
          </Field>
          {data.loopType === 'count' && (
            <Field label="Iterations">
              <input className="rf-input" type="number" min={1} max={1000} value={data.count} onChange={(e) => update({ count: Number(e.target.value) })} />
            </Field>
          )}
          {data.loopType !== 'count' && (
            <Field label="Selector">
              <input className="rf-input" value={data.selector} onChange={(e) => update({ selector: e.target.value })} placeholder="CSS selector" />
            </Field>
          )}
        </>
      );

    case 'delay':
      return (
        <Field label="Delay (ms)">
          <input className="rf-input" type="number" min={100} max={60000} step={100} value={data.delayMs} onChange={(e) => update({ delayMs: Number(e.target.value) })} />
        </Field>
      );

    case 'closeTab':
      return <p className="ge-config__hint">Closes the active tab. No configuration needed.</p>;
  }
});

// ---- Field helper ----

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ge-config__field">
      <label className="ge-config__field-label">{label}</label>
      {children}
    </div>
  );
}
