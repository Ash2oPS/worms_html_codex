import type { WeaponMenuView } from './WeaponMenuController';

export interface WeaponMenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WeaponMenuCellBounds extends WeaponMenuRect {
  index: number;
}

export interface WeaponMenuLayout {
  panelBounds: WeaponMenuRect;
  cellBounds: WeaponMenuCellBounds[];
  cellWidth: number;
  cellHeight: number;
  gap: number;
}

export type WeaponMenuClickResult = {
  kind: 'entry';
  index: number;
} | {
  kind: 'outside';
};

export const createWeaponMenuLayout = (
  worldWidth: number,
  worldHeight: number,
  menu: WeaponMenuView,
): WeaponMenuLayout | null => {
  if (!menu.isOpen) {
    return null;
  }

  const columns = Math.max(1, menu.columns);
  const rows = Math.max(1, Math.ceil(menu.entries.length / columns));
  const cellWidth = 160;
  const cellHeight = 70;
  const gap = 12;
  const panelWidth = (columns * cellWidth) + ((columns - 1) * gap) + 56;
  const panelHeight = (rows * cellHeight) + ((rows - 1) * gap) + 112;
  const panelX = (worldWidth - panelWidth) * 0.5;
  const panelY = (worldHeight - panelHeight) * 0.5;
  const gridX = panelX + 24;
  const gridY = panelY + 74;
  const cellBounds: WeaponMenuCellBounds[] = [];

  for (let index = 0; index < menu.entries.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cellBounds.push({
      index,
      x: gridX + (column * (cellWidth + gap)),
      y: gridY + (row * (cellHeight + gap)),
      width: cellWidth,
      height: cellHeight,
    });
  }

  return {
    panelBounds: {
      x: panelX,
      y: panelY,
      width: panelWidth,
      height: panelHeight,
    },
    cellBounds,
    cellWidth,
    cellHeight,
    gap,
  };
};

export const resolveWeaponMenuClick = (
  layout: WeaponMenuLayout | null,
  x: number,
  y: number,
): WeaponMenuClickResult | null => {
  if (!layout) {
    return null;
  }

  for (const bounds of layout.cellBounds) {
    const withinX = x >= bounds.x && x <= bounds.x + bounds.width;
    const withinY = y >= bounds.y && y <= bounds.y + bounds.height;
    if (withinX && withinY) {
      return { kind: 'entry', index: bounds.index };
    }
  }

  const inPanelX = x >= layout.panelBounds.x && x <= layout.panelBounds.x + layout.panelBounds.width;
  const inPanelY = y >= layout.panelBounds.y && y <= layout.panelBounds.y + layout.panelBounds.height;
  if (inPanelX && inPanelY) {
    return null;
  }

  return { kind: 'outside' };
};
