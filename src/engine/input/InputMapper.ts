export interface InputFrame {
  moveAxis: number;
  aimAxis: number;
  powerAxis: number;
  menuMoveX: number;
  menuMoveY: number;
  menuPointerSelect: { x: number; y: number } | null;
  jumpPressed: boolean;
  backJumpPressed: boolean;
  firePressed: boolean;
  fireHeld: boolean;
  fireReleased: boolean;
  weaponMenuTogglePressed: boolean;
  menuConfirmPressed: boolean;
  menuCancelPressed: boolean;
  forceTurnEndPressed: boolean;
}

export class InputMapper {
  private static readonly DOUBLE_JUMP_PRESS_WINDOW_MS = 280;

  private readonly pressed = new Set<string>();
  private readonly justPressed = new Set<string>();
  private readonly justReleased = new Set<string>();
  private readonly pointerClicks: Array<{ x: number; y: number }> = [];
  private attached = false;
  private pointerTarget: HTMLCanvasElement | null = null;
  private pointerWidth = 1;
  private pointerHeight = 1;
  private lastJumpPressAtMs = Number.NEGATIVE_INFINITY;
  private backJumpPending = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const isFreshPress = !this.pressed.has(event.code);
    if (isFreshPress) {
      this.justPressed.add(event.code);
      if (this.isJumpCode(event.code)) {
        const nowMs = performance.now();
        this.backJumpPending = (nowMs - this.lastJumpPressAtMs) <= InputMapper.DOUBLE_JUMP_PRESS_WINDOW_MS;
        this.lastJumpPressAtMs = nowMs;
      }
    }
    this.pressed.add(event.code);

    if (
      event.code === 'Space'
      || event.code === 'Tab'
      || event.code === 'ArrowUp'
      || event.code === 'ArrowDown'
      || event.code === 'ArrowLeft'
      || event.code === 'ArrowRight'
      || event.code === 'Enter'
      || event.code === 'Escape'
    ) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const wasPressed = this.pressed.delete(event.code);
    if (wasPressed) {
      this.justReleased.add(event.code);
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.pointerTarget) {
      return;
    }

    const rect = this.pointerTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const localX = ((event.clientX - rect.left) / rect.width) * this.pointerWidth;
    const localY = ((event.clientY - rect.top) / rect.height) * this.pointerHeight;
    if (localX < 0 || localY < 0 || localX > this.pointerWidth || localY > this.pointerHeight) {
      return;
    }

    this.pointerClicks.push({ x: localX, y: localY });
    event.preventDefault();
  };

  attach(canvas?: HTMLCanvasElement, width = 1, height = 1): void {
    if (this.attached) {
      return;
    }

    this.attached = true;
    this.pointerTarget = canvas ?? null;
    this.pointerWidth = width;
    this.pointerHeight = height;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.pointerTarget?.addEventListener('pointerdown', this.onPointerDown);
  }

  detach(): void {
    if (!this.attached) {
      return;
    }

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.pointerTarget?.removeEventListener('pointerdown', this.onPointerDown);
    this.attached = false;
    this.pointerTarget = null;
    this.pressed.clear();
    this.justPressed.clear();
    this.justReleased.clear();
    this.pointerClicks.length = 0;
    this.lastJumpPressAtMs = Number.NEGATIVE_INFINITY;
    this.backJumpPending = false;
  }

  sample(): InputFrame {
    const moveAxis = Number(this.isDown('ArrowRight') || this.isDown('KeyD'))
      - Number(this.isDown('ArrowLeft') || this.isDown('KeyA'));
    const aimAxis = Number(this.isDown('KeyE')) - Number(this.isDown('KeyQ'));
    const powerAxis = Number(this.isDown('KeyX')) - Number(this.isDown('KeyZ'));
    const menuMoveX = Number(this.consume('ArrowRight') || this.consume('KeyD'))
      - Number(this.consume('ArrowLeft') || this.consume('KeyA'));
    const menuMoveY = Number(this.consume('ArrowDown') || this.consume('KeyS'))
      - Number(this.consume('ArrowUp') || this.consume('KeyW'));
    const jumpPressed = this.consume('ArrowUp') || this.consume('KeyW');
    const backJumpPressed = jumpPressed && this.backJumpPending;
    if (jumpPressed) {
      this.backJumpPending = false;
    }

    const frame: InputFrame = {
      moveAxis,
      aimAxis,
      powerAxis,
      menuMoveX,
      menuMoveY,
      menuPointerSelect: this.pointerClicks.shift() ?? null,
      jumpPressed,
      backJumpPressed,
      firePressed: this.consume('Space'),
      fireHeld: this.isDown('Space'),
      fireReleased: this.consumeReleased('Space'),
      weaponMenuTogglePressed: this.consume('Tab') || this.consume('KeyB'),
      menuConfirmPressed: this.consume('Enter') || this.consume('Space'),
      menuCancelPressed: this.consume('Escape'),
      forceTurnEndPressed: this.consume('KeyN'),
    };

    this.justPressed.clear();
    this.justReleased.clear();
    return frame;
  }

  private isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  private consume(code: string): boolean {
    return this.justPressed.has(code);
  }

  private consumeReleased(code: string): boolean {
    return this.justReleased.has(code);
  }

  private isJumpCode(code: string): boolean {
    return code === 'ArrowUp' || code === 'KeyW';
  }
}
