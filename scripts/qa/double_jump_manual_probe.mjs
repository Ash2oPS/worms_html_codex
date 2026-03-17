import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:41783';

function parseState(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function prepareHumanScenario(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.name-setup__submit', { timeout: 10000 });
  await page.selectOption('#team-controller-red', 'human');
  await page.selectOption('#team-controller-blue', 'ai');
  await page.click('.name-setup__submit');

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.waitForTimeout(125);
    const ready = await page.evaluate(() => (
      typeof window.advanceTime === 'function'
      && typeof window.render_game_to_text === 'function'
    ));
    if (ready) {
      return;
    }
  }

  throw new Error('game-hooks-not-ready-after-modal');
}

async function sampleCurrentWorm(page) {
  const state = parseState(await page.evaluate(() => window.render_game_to_text?.() ?? null));
  if (!state) {
    throw new Error('state-unavailable');
  }
  const wormId = state.turn?.currentWormId;
  const worm = (state.worms ?? []).find((entry) => entry.id === wormId);
  if (!worm) {
    throw new Error('current-worm-missing');
  }
  return { state, worm };
}

async function runNormalJumpScenario(browser) {
  const page = await browser.newPage();
  try {
    await prepareHumanScenario(page);
    const before = await sampleCurrentWorm(page);

    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(260));

    const after = await sampleCurrentWorm(page);
    return {
      before: before.worm,
      after: after.worm,
      dx: Number((after.worm.x - before.worm.x).toFixed(2)),
      dy: Number((after.worm.y - before.worm.y).toFixed(2)),
    };
  } finally {
    await page.close();
  }
}

async function runDoubleTapScenario(browser) {
  const page = await browser.newPage();
  try {
    await prepareHumanScenario(page);
    const before = await sampleCurrentWorm(page);

    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(70));
    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(260));

    const after = await sampleCurrentWorm(page);
    return {
      before: before.worm,
      after: after.worm,
      dx: Number((after.worm.x - before.worm.x).toFixed(2)),
      dy: Number((after.worm.y - before.worm.y).toFixed(2)),
    };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const normal = await runNormalJumpScenario(browser);
  const doubleTap = await runDoubleTapScenario(browser);

  const summary = {
    normal,
    doubleTap,
    interpretation: {
      normalForwardDirection: normal.before.facing === 1 ? 'x+' : 'x-',
      normalLooksForward: normal.before.facing === 1 ? normal.dx > 0 : normal.dx < 0,
      doubleTapLooksBackward: doubleTap.before.facing === 1 ? doubleTap.dx < 0 : doubleTap.dx > 0,
      doubleTapHigherThanNormal: doubleTap.dy < normal.dy,
    },
  };

  console.log('SUMMARY_JSON_START');
  console.log(JSON.stringify(summary, null, 2));
  console.log('SUMMARY_JSON_END');
} finally {
  await browser.close();
}
