import { Container, Graphics, Text } from 'pixi.js';
import type { WeaponMenuView } from '../engine/combat/WeaponMenuController';
import {
  createWeaponMenuLayout,
  resolveWeaponMenuClick,
  type WeaponMenuLayout,
} from '../engine/combat/WeaponMenuLayout';

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
  private layout: WeaponMenuLayout | null = null;

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
    this.container.visible = menu.isOpen;
    this.layout = createWeaponMenuLayout(this.worldWidth, this.worldHeight, menu);
    if (!menu.isOpen) {
      return;
    }

    if (!this.layout) {
      return;
    }

    const { panelBounds, cellBounds, cellWidth, cellHeight } = this.layout;
    const panelX = panelBounds.x;
    const panelY = panelBounds.y;
    const panelWidth = panelBounds.width;
    const panelHeight = panelBounds.height;

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

    for (let index = 0; index < menu.entries.length; index += 1) {
      const entry = menu.entries[index];
      const bounds = cellBounds[index];
      if (!bounds) {
        continue;
      }
      const x = bounds.x;
      const y = bounds.y;
      const isCursor = index === menu.cursorIndex;

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

  resolveClick(x: number, y: number) {
    return resolveWeaponMenuClick(this.layout, x, y);
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.cellLabels.length = 0;
    this.layout = null;
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
