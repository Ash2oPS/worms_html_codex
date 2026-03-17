export class IdFactory {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const current = this.counters.get(prefix) ?? 0;
    const nextValue = current + 1;
    this.counters.set(prefix, nextValue);
    return `${prefix}_${nextValue}`;
  }
}
