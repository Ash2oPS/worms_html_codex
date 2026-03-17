import { Container, Graphics, Text } from 'pixi.js';
import type { WeaponMenuView } from '../engine/combat/WeaponMenuController';

export interface WeaponMenuClickResult {
  kind: 'entry' | 'outside';
  index?: number;
}

export class WeaponMenuRenderer {
  readonly container = new Container();
  private readonly backdrop = new Graphics();
  private readonly panel = new Graphics();
  private readonly title = new Text({
    text: 'Weapon Crate',
    style: {
      fill: 0xfff3cf,
      fontSize: 22,
      fontFamily: 'Trebuchet MS',
      fontWeight: '700',
    },
  });
  private readonly hint = new Text({
    text: 'Arrows/WASD: move   Enter: select   Esc/Tab: close',
    style: {
      fill: 0xcdd6ea,
      fontSize: 14,
      fontFamily: 'Trebuchet MS',
      fontWeight: '600',
    },
  });
  private readonly cellLabels: Text[] = [];
  private isOpen = false;
  private panelBounds = { x: 0, y: 0, width: 0, height: 0 };
  private readonly cellBounds: Array<{ index: number; x: number; y: number; width: number; height: number }> = [];

  constructor(
    private readonly worldWidth: number,
    private readonly worldHeight: number,
  ) {
    this.container.visible = false;
    this.container.addChild(this.backdrop);
    this.container.addChild(this.panel);
    this.container.addChild(this.title);
    this.container.addChild(this.hint);
  }

  render(menu: WeaponMenuView): void {
    this.isOpen = menu.isOpen;
    this.container.visible = menu.isOpen;
    if (!menu.isOpen) {
      this.cellBounds.length = 0;
      return;
    }

    const columns = Math.max(1, menu.columns);
    const rows = Math.max(1, Math.ceil(menu.entries.length / columns));
    const cellWidth = 160;
    const cellHeight = 70;
    const gap = 12;
    const panelWidth = (columns * cellWidth) + ((columns - 1) * gap) + 56;
    const panelHeight = (rows * cellHeight) + ((rows - 1) * gap) + 112;
    const panelX = (this.worldWidth - panelWidth) * 0.5;
    const panelY = (this.worldHeight - panelHeight) * 0.5;
    this.panelBounds = { x: panelX, y: panelY, width: panelWidth, height: panelHeight };
    this.cellBounds.length = 0;

    this.backdrop.clear();
    this.backdrop.beginFill(0x000000, 0.42);
    this.backdrop.drawRect(0, 0, this.worldWidth, this.worldHeight);
    this.backdrop.endFill();

    this.panel.clear();
    this.panel.beginFill(0x1d2840, 0.96);
    this.panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 14);
    this.panel.endFill();
    this.panel.lineStyle(2, 0x5e6f97, 0.95);
    this.panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 14);

    this.title.text = `Weapon Crate (${menu.entries.length})`;
    this.title.x = panelX + 24;
    this.title.y = panelY + 18;
    this.hint.x = panelX + 24;
    this.hint.y = panelY + 48;

    const gridX = panelX + 24;
    const gridY = panelY + 74;
    for (let index = 0; index < menu.entries.length; index += 1) {
      const entry = menu.entries[index];
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = gridX + (column * (cellWidth + gap));
      const y = gridY + (row * (cellHeight + gap));
      const isCursor = index === menu.cursorIndex;
      this.cellBounds.push({
        index,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
      });

      this.panel.beginFill(
        isCursor ? 0x314a76 : 0x24324f,
        entry.isEquipped ? 1 : 0.88,
      );
      this.panel.drawRoundedRect(x, y, cellWidth, cellHeight, 10);
      this.panel.endFill();
      this.panel.lineStyle(2, isCursor ? 0xffdd87 : 0x5e6f97, 1);
      this.panel.drawRoundedRect(x, y, cellWidth, cellHeight, 10);

      const label = this.ensureLabel(index);
      label.visible = true;
      label.text = entry.isEquipped
        ? `${entry.label}\nEquipped`
        : entry.label;
      label.x = x + 12;
      label.y = y + 12;
    }

    for (let index = menu.entries.length; index < this.cellLabels.length; index += 1) {
      this.cellLabels[index].visible = false;
    }
  }

  resolveClick(x: number, y: number): WeaponMenuClickResult | null {
    if (!this.isOpen) {
      return null;
    }

    for (const bounds of this.cellBounds) {
      const withinX = x >= bounds.x && x <= bounds.x + bounds.width;
      const withinY = y >= bounds.y && y <= bounds.y + bounds.height;
      if (withinX && withinY) {
        return { kind: 'entry', index: bounds.index };
      }
    }

    const inPanelX = x >= this.panelBounds.x && x <= this.panelBounds.x + this.panelBounds.width;
    const inPanelY = y >= this.panelBounds.y && y <= this.panelBounds.y + this.panelBounds.height;
    if (inPanelX && inPanelY) {
      return null;
    }

    return { kind: 'outside' };
  }

  private ensureLabel(index: number): Text {
    const existing = this.cellLabels[index];
    if (existing) {
      return existing;
    }

    const label = new Text({
      text: '',
      style: {
        fill: 0xf2f4ff,
        fontSize: 15,
        lineHeight: 19,
        fontFamily: 'Trebuchet MS',
        fontWeight: '700',
      },
    });
    this.cellLabels.push(label);
    this.container.addChild(label);
    return label;
  }
}
