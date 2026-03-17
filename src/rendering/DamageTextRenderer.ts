import { Container, Text } from 'pixi.js';
import type { MatchState } from '../domain/state';

export class DamageTextRenderer {
  private static readonly RISE_DISTANCE_PX = 34;

  readonly container = new Container();
  private readonly labels = new Map<string, Text>();

  render(match: MatchState): void {
    const visibleIds = new Set<string>();

    for (const damageText of match.damageTexts) {
      const label = this.ensureLabel(damageText.id);
      const lifeRatio = damageText.ttlMs / damageText.maxTtlMs;
      const progress = 1 - lifeRatio;
      label.text = `-${damageText.damage}`;
      label.alpha = Math.max(0, lifeRatio);
      const scale = 1 + (progress * 0.12);
      label.scale.set(scale, scale);
      label.x = damageText.position.x - (label.width * 0.5);
      label.y = damageText.position.y - label.height - (progress * DamageTextRenderer.RISE_DISTANCE_PX);
      label.visible = true;
      visibleIds.add(damageText.id);
    }

    for (const [id, label] of this.labels.entries()) {
      if (visibleIds.has(id)) {
        continue;
      }

      this.container.removeChild(label);
      label.destroy();
      this.labels.delete(id);
    }
  }

  private ensureLabel(id: string): Text {
    const existing = this.labels.get(id);
    if (existing) {
      return existing;
    }

    const label = new Text({
      text: '',
      style: {
        fill: 0xff3f3f,
        fontSize: 22,
        fontFamily: 'Trebuchet MS',
        fontWeight: '800',
        stroke: { color: '#2a0808', width: 4 },
      },
    });
    label.visible = false;
    label.roundPixels = true;
    this.labels.set(id, label);
    this.container.addChild(label);
    return label;
  }
}
