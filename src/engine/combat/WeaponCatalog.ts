import type { WeaponConfig } from '../../domain/config';

export class WeaponCatalog {
  private readonly byId = new Map<string, WeaponConfig>();
  private readonly orderedWeapons: WeaponConfig[];

  constructor(weapons: WeaponConfig[]) {
    this.orderedWeapons = [...weapons];
    for (const weapon of weapons) {
      this.byId.set(weapon.id, weapon);
    }
  }

  getById(id: string): WeaponConfig {
    const weapon = this.byId.get(id);
    if (!weapon) {
      throw new Error(`Unknown weapon: ${id}`);
    }

    return weapon;
  }

  defaultWeaponId(): string {
    return this.orderedWeapons[0]?.id ?? 'bazooka';
  }

  nextWeaponId(currentId: string): string {
    const index = this.orderedWeapons.findIndex((weapon) => weapon.id === currentId);
    if (index < 0) {
      return this.defaultWeaponId();
    }

    const nextIndex = (index + 1) % this.orderedWeapons.length;
    return this.orderedWeapons[nextIndex]?.id ?? this.defaultWeaponId();
  }

  list(): WeaponConfig[] {
    return [...this.orderedWeapons];
  }

  indexOf(weaponId: string): number {
    return this.orderedWeapons.findIndex((weapon) => weapon.id === weaponId);
  }
}
