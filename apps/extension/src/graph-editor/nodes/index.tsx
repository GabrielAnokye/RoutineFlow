import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

import { BaseNode } from './BaseNode';
import type {
  TriggerData, NewTabData, GotoData, ClickData, TypeData,
  GetTextData, ConditionData, LoopData, DelayData, CloseTabData,
} from '../types';

// ---- Node color palette ----
const COLORS = {
  trigger: '#6366f1',
  newTab: '#0ea5e9',
  goto: '#0d5b86',
  click: '#f97316',
  type: '#8b5cf6',
  getText: '#14b8a6',
  condition: '#eab308',
  loop: '#ec4899',
  delay: '#64748b',
  closeTab: '#ef4444',
};

const ICONS = {
  trigger: '\u25B6',
  newTab: '\u2B1A',
  goto: '\u2192',
  click: '\u25CB',
  type: '\u2328',
  getText: '\u2261',
  condition: '\u25C7',
  loop: '\u21BB',
  delay: '\u23F1',
  closeTab: '\u2715',
};

// ---- Trigger ----
export const TriggerNode = memo(function TriggerNode({ id, data }: NodeProps) {
  const d = data as unknown as TriggerData;
  return (
    <BaseNode id={id} icon={ICONS.trigger} color={COLORS.trigger} label={d.label} subtitle={d.triggerType} showInput={false}>
      <span className="ge-node__tag">{d.triggerType}</span>
    </BaseNode>
  );
});

// ---- New Tab ----
export const NewTabNode = memo(function NewTabNode({ id, data }: NodeProps) {
  const d = data as unknown as NewTabData;
  return (
    <BaseNode id={id} icon={ICONS.newTab} color={COLORS.newTab} label={d.label} subtitle={d.initialUrl || 'about:blank'}>
      {d.initialUrl && <span className="ge-node__value">{d.initialUrl}</span>}
    </BaseNode>
  );
});

// ---- Goto ----
export const GotoNode = memo(function GotoNode({ id, data }: NodeProps) {
  const d = data as unknown as GotoData;
  return (
    <BaseNode id={id} icon={ICONS.goto} color={COLORS.goto} label={d.label} subtitle={d.url || 'no URL'}>
      {d.url && <span className="ge-node__value">{d.url}</span>}
    </BaseNode>
  );
});

// ---- Click ----
export const ClickNode = memo(function ClickNode({ id, data }: NodeProps) {
  const d = data as unknown as ClickData;
  return (
    <BaseNode id={id} icon={ICONS.click} color={COLORS.click} label={d.label} subtitle={d.selector || 'no selector'}>
      {d.selector && <span className="ge-node__value">{d.selector}</span>}
    </BaseNode>
  );
});

// ---- Type ----
export const TypeNode = memo(function TypeNode({ id, data }: NodeProps) {
  const d = data as unknown as TypeData;
  return (
    <BaseNode id={id} icon={ICONS.type} color={COLORS.type} label={d.label} subtitle={d.value ? `"${d.value.slice(0, 20)}"` : 'no value'}>
      {d.selector && <span className="ge-node__value">{d.selector}</span>}
    </BaseNode>
  );
});

// ---- GetText ----
export const GetTextNode = memo(function GetTextNode({ id, data }: NodeProps) {
  const d = data as unknown as GetTextData;
  return (
    <BaseNode id={id} icon={ICONS.getText} color={COLORS.getText} label={d.label} subtitle={d.variableName ? `\${${d.variableName}}` : undefined}>
      {d.selector && <span className="ge-node__value">{d.selector}</span>}
    </BaseNode>
  );
});

// ---- Condition ----
export const ConditionNode = memo(function ConditionNode({ id, data }: NodeProps) {
  const d = data as unknown as ConditionData;
  return (
    <BaseNode id={id} icon={ICONS.condition} color={COLORS.condition} label={d.label} subtitle={d.conditionType} showTrueOutput>
      <div className="ge-node__branches">
        <span className="ge-node__branch ge-node__branch--true">True</span>
        <span className="ge-node__branch ge-node__branch--false">False</span>
      </div>
    </BaseNode>
  );
});

// ---- Loop ----
export const LoopNode = memo(function LoopNode({ id, data }: NodeProps) {
  const d = data as unknown as LoopData;
  const subtitle = d.loopType === 'count' ? `${d.count}x` : d.loopType;
  return (
    <BaseNode id={id} icon={ICONS.loop} color={COLORS.loop} label={d.label} subtitle={subtitle}>
      <span className="ge-node__tag">{d.loopType}</span>
    </BaseNode>
  );
});

// ---- Delay ----
export const DelayNode = memo(function DelayNode({ id, data }: NodeProps) {
  const d = data as unknown as DelayData;
  return (
    <BaseNode id={id} icon={ICONS.delay} color={COLORS.delay} label={d.label} subtitle={`${d.delayMs}ms`} />
  );
});

// ---- CloseTab ----
export const CloseTabNode = memo(function CloseTabNode({ id, data }: NodeProps) {
  const d = data as unknown as CloseTabData;
  return (
    <BaseNode id={id} icon={ICONS.closeTab} color={COLORS.closeTab} label={d.label} />
  );
});

// ---- Node type registry for React Flow ----
export const nodeTypes = {
  trigger: TriggerNode,
  newTab: NewTabNode,
  goto: GotoNode,
  click: ClickNode,
  type: TypeNode,
  getText: GetTextNode,
  condition: ConditionNode,
  loop: LoopNode,
  delay: DelayNode,
  closeTab: CloseTabNode,
};
