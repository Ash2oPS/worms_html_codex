import type { WormState } from '../../domain/state';
import { clamp } from '../../core/math';
import { WeaponCatalog } from './WeaponCatalog';

export interface WeaponMenuEntryView {
  id: string;
  label: string;
  isEquipped: boolean;
}

export interface WeaponMenuView {
  isOpen: boolean;
  columns: number;
  cursorIndex: number;
  entries: WeaponMenuEntryView[];
}

export class WeaponMenuController {
  private isOpen = false;
  private cursorIndex = 0;
  private readonly columns = 4;

  constructor(private readonly catalog: WeaponCatalog) {}

  toggle(currentWeaponId: string): void {
    if (this.isOpen) {
      this.close();
      return;
    }

    this.isOpen = true;
    const equippedIndex = this.catalog.indexOf(currentWeaponId);
    this.cursorIndex = equippedIndex >= 0 ? equippedIndex : 0;
  }

  close(): void {
    this.isOpen = false;
  }

  moveCursor(moveX: number, moveY: number): void {
    if (!this.isOpen || (moveX === 0 && moveY === 0)) {
      return;
    }

    const entries = this.catalog.list();
    if (entries.length === 0) {
      return;
    }

    const rows = Math.ceil(entries.length / this.columns);
    const currentColumn = this.cursorIndex % this.columns;
    const currentRow = Math.floor(this.cursorIndex / this.columns);
    const targetColumn = this.wrap(currentColumn + moveX, this.columns);
    const targetRow = this.wrap(currentRow + moveY, rows);
    const targetIndex = (targetRow * this.columns) + targetColumn;

    if (targetIndex < entries.length) {
      this.cursorIndex = targetIndex;
      return;
    }

    this.cursorIndex = entries.length - 1;
  }

  confirm(activeWorm: WormState): boolean {
    if (!this.isOpen) {
      return false;
    }

    const entries = this.catalog.list();
    const chosenIndex = clamp(this.cursorIndex, 0, Math.max(0, entries.length - 1));
    const weapon = entries[chosenIndex];
    if (!weapon) {
      this.close();
      return false;
    }

    activeWorm.selectedWeaponId = weapon.id;
    this.close();
    return true;
  }

  selectIndex(index: number, activeWorm: WormState): boolean {
    this.cursorIndex = index;
    return this.confirm(activeWorm);
  }

  getView(activeWeaponId: string): WeaponMenuView {
    const entries = this.catalog.list().map((weapon) => ({
      id: weapon.id,
      label: weapon.label,
      isEquipped: weapon.id === activeWeaponId,
    }));

    const safeCursorIndex = clamp(this.cursorIndex, 0, Math.max(0, entries.length - 1));
    return {
      isOpen: this.isOpen,
      columns: this.columns,
      cursorIndex: safeCursorIndex,
      entries,
    };
  }

  private wrap(value: number, size: number): number {
    if (size <= 0) {
      return 0;
    }

    const normalized = value % size;
    return normalized < 0 ? normalized + size : normalized;
  }
}
