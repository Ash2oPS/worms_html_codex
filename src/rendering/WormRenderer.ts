import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { MatchState } from '../domain/state';

export class WormRenderer {
  private static readonly WORM_SPRITE_BASE_SIZE = 32;
  private static readonly WORM_VISUAL_DIAMETER_FACTOR = 2.0;

  readonly container = new Container();
  private readonly wormLayer = new Container();
  private readonly weaponLayer = new Container();
  private readonly handLayer = new Container();
  readonly graphics = new Graphics();
  private readonly nameLabels = new Map<string, Text>();
  private readonly wormSprites = new Map<string, Sprite>();
  private readonly handAimSprite = Sprite.from('/assets/worms/worms_hand_sprite_00.png');
  private readonly bazookaAimSprite = Sprite.from('/assets/weapons/bazooka_sprite_00.png');

  constructor() {
    this.container.addChild(this.wormLayer);
    this.container.addChild(this.weaponLayer);
    this.container.addChild(this.handLayer);
    this.container.addChild(this.graphics);

    this.bazookaAimSprite.anchor.set(0.5);
    this.bazookaAimSprite.texture.source.scaleMode = 'nearest';
    this.bazookaAimSprite.roundPixels = true;
    this.bazookaAimSprite.visible = false;
    this.weaponLayer.addChild(this.bazookaAimSprite);

    this.handAimSprite.anchor.set(0.5);
    this.handAimSprite.texture.source.scaleMode = 'nearest';
    this.handAimSprite.roundPixels = true;
    this.handAimSprite.visible = false;
    this.handLayer.addChild(this.handAimSprite);
  }

  render(match: MatchState): void {
    this.graphics.clear();
    this.bazookaAimSprite.visible = false;
    this.handAimSprite.visible = false;
    const visibleLabelIds = new Set<string>();
    const visibleSpriteIds = new Set<string>();

    for (const worm of match.worms) {
      if (!worm.alive) {
        continue;
      }

      const isActive = worm.id === match.currentWormId && match.phase !== 'match_over';
      const wormSprite = this.ensureWormSprite(worm.id);
      const spriteSize = worm.radius * WormRenderer.WORM_VISUAL_DIAMETER_FACTOR;
      const spriteScale = spriteSize / WormRenderer.WORM_SPRITE_BASE_SIZE;
      const facing = worm.facing >= 0 ? 1 : -1;
      const parsedTeamColor = Number.parseInt(worm.teamColor.replace('#', ''), 16);
      const teamColor = Number.isFinite(parsedTeamColor) ? parsedTeamColor : 0x68d55f;
      wormSprite.position.set(worm.position.x, worm.position.y + worm.radius);
      wormSprite.scale.set(spriteScale * facing, spriteScale);
      wormSprite.rotation = worm.groundAngleRad;
      wormSprite.visible = true;
      visibleSpriteIds.add(worm.id);

      const hpRatio = Math.max(0, worm.health / worm.maxHealth);
      const barWidth = worm.radius * 2.05;
      const barHeight = 4;
      const barX = worm.position.x - (barWidth * 0.5);
      const barY = worm.position.y - worm.radius - 12;

      this.graphics.beginFill(teamColor, 0.28);
      this.graphics.drawRoundedRect(barX, barY, barWidth, barHeight, 2);
      this.graphics.endFill();
      this.graphics.lineStyle(1, 0x101018, 0.55);
      this.graphics.drawRoundedRect(barX, barY, barWidth, barHeight, 2);

      this.graphics.beginFill(teamColor, 0.95);
      this.graphics.drawRoundedRect(barX, barY, barWidth * hpRatio, barHeight, 2);
      this.graphics.endFill();

      const nameLabel = this.ensureNameLabel(worm.id);
      nameLabel.text = worm.name;
      nameLabel.style.fill = teamColor;
      nameLabel.x = worm.position.x - (nameLabel.width * 0.5);
      nameLabel.y = barY - nameLabel.height - 3;
      nameLabel.visible = true;
      visibleLabelIds.add(worm.id);

      if (isActive) {
        const direction = worm.facing;
        const aimAngle = (worm.aimDeg * Math.PI) / 180;
        const aimDirX = Math.cos(aimAngle) * direction;
        const aimDirY = -Math.sin(aimAngle);
        const aimRotation = Math.atan2(aimDirY, aimDirX);
        const handX = worm.position.x;
        const handY = worm.position.y;

        const bazookaScale = spriteScale * 0.95;
        const bazookaX = handX;
        const bazookaY = handY - (spriteSize * 0.28);
        this.bazookaAimSprite.position.set(bazookaX, bazookaY);
        this.bazookaAimSprite.scale.set(bazookaScale, bazookaScale);
        this.bazookaAimSprite.rotation = aimRotation;
        this.bazookaAimSprite.visible = true;

        const handScale = spriteScale * 0.95;
        this.handAimSprite.position.set(handX, handY);
        this.handAimSprite.scale.set(handScale, handScale);
        this.handAimSprite.rotation = aimRotation;
        this.handAimSprite.visible = true;
      }
    }

    for (const [wormId, sprite] of this.wormSprites.entries()) {
      if (!visibleSpriteIds.has(wormId)) {
        sprite.visible = false;
      }
    }

    for (const [wormId, label] of this.nameLabels.entries()) {
      if (!visibleLabelIds.has(wormId)) {
        label.visible = false;
      }
    }
  }

  private ensureWormSprite(wormId: string): Sprite {
    const existing = this.wormSprites.get(wormId);
    if (existing) {
      return existing;
    }

    const sprite = Sprite.from('/assets/worms/worms_sprite_00.png');
    sprite.anchor.set(0.5, 1);
    sprite.texture.source.scaleMode = 'nearest';
    sprite.roundPixels = true;
    sprite.visible = false;
    this.wormSprites.set(wormId, sprite);
    this.wormLayer.addChild(sprite);
    return sprite;
  }

  private ensureNameLabel(wormId: string): Text {
    const existing = this.nameLabels.get(wormId);
    if (existing) {
      return existing;
    }

    const label = new Text({
      text: '',
      style: {
        fill: 0xf3f6ff,
        fontSize: 11,
        fontFamily: 'Trebuchet MS',
        fontWeight: '700',
        stroke: { color: '#101018', width: 3 },
      },
    });
    label.visible = false;
    this.nameLabels.set(wormId, label);
    this.container.addChild(label);
    return label;
  }
}
