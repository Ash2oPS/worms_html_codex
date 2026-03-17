import { pathToFileURL } from 'node:url';

const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH
  ?? 'C:/Users/esibe/.codex/skills/develop-web-game/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightModulePath).href);

const url = process.argv[2] ?? 'http://127.0.0.1:4173';
const games = Number.parseInt(process.argv[3] ?? '4', 10);

function parseState(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function runGame(browser, index) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.name-setup__submit', { timeout: 10000 });
  await page.click('.name-setup__submit');
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await page.waitForTimeout(250);
    const availability = await page.evaluate(() => ({
      hasAdvanceTime: typeof window.advanceTime === 'function',
      hasRenderToText: typeof window.render_game_to_text === 'function',
    }));
    if (availability.hasAdvanceTime && availability.hasRenderToText) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    throw new Error('game-hooks-not-ready');
  }

  let backJumpEvents = 0;
  let normalJumpStarts = 0;
  const previousByWormId = new Map();

  for (let step = 0; step < 1600; step += 1) {
    await page.evaluate(() => window.advanceTime?.(200));
    const stateRaw = await page.evaluate(() => window.render_game_to_text?.() ?? null);
    const state = parseState(stateRaw);
    if (!state) {
      continue;
    }

    for (const worm of state.worms ?? []) {
      const previous = previousByWormId.get(worm.id);
      previousByWormId.set(worm.id, worm);
      if (!previous) {
        continue;
      }

      const startedJump = previous.grounded && !worm.grounded;
      if (!startedJump) {
        continue;
      }

      const dx = worm.x - previous.x;
      const dy = worm.y - previous.y;
      if (dy >= -0.2) {
        continue;
      }

      normalJumpStarts += 1;
      const oppositeToFacing = (worm.facing === 1 && dx < -0.35) || (worm.facing === -1 && dx > 0.35);
      if (oppositeToFacing) {
        backJumpEvents += 1;
      }
    }

    if (state.phase === 'match_over') {
      break;
    }
  }

  const result = {
    game: index,
    backJumpEvents,
    normalJumpStarts,
  };
  await page.close();
  return result;
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const results = [];
  for (let game = 1; game <= games; game += 1) {
    const result = await runGame(browser, game);
    results.push(result);
    console.log(`game ${game}: backJumpEvents=${result.backJumpEvents} jumpStarts=${result.normalJumpStarts}`);
  }

  const totalBackJumpEvents = results.reduce((sum, item) => sum + item.backJumpEvents, 0);
  const totalJumpStarts = results.reduce((sum, item) => sum + item.normalJumpStarts, 0);
  console.log('SUMMARY_JSON_START');
  console.log(JSON.stringify({ games, totalBackJumpEvents, totalJumpStarts, results }, null, 2));
  console.log('SUMMARY_JSON_END');
} finally {
  await browser.close();
}
