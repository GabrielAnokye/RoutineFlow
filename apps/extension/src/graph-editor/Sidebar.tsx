import { memo, useCallback, type DragEvent } from 'react';

import { NODE_CATEGORIES, type GraphNodeType } from './types';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar = memo(function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const onDragStart = useCallback((e: DragEvent, nodeType: GraphNodeType) => {
    e.dataTransfer.setData('application/routineflow-node', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className={`ge-sidebar ${collapsed ? 'ge-sidebar--collapsed' : ''}`}>
      <button className="ge-sidebar__toggle" onClick={onToggle}>
        {collapsed ? '\u276F' : '\u276E'}
      </button>

      {!collapsed && (
        <div className="ge-sidebar__content">
          <p className="ge-sidebar__title">Nodes</p>
          {NODE_CATEGORIES.map((cat) => (
            <div key={cat.name} className="ge-sidebar__category">
              <p className="ge-sidebar__cat-label">{cat.name}</p>
              {cat.items.map((item) => (
                <div
                  key={item.type}
                  className="ge-sidebar__item"
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type)}
                >
                  <span className="ge-sidebar__item-label">{item.label}</span>
                  <span className="ge-sidebar__item-desc">{item.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
