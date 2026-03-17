import fs from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:41783';
const outDir = 'output/double-jump-captures';
fs.mkdirSync(outDir, { recursive: true });

async function prepareHuman(page) {
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

  throw new Error('hooks-not-ready');
}

async function screenshotCanvas(page, outputPath) {
  const canvas = await page.locator('canvas').first();
  await canvas.screenshot({ path: outputPath });
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
try {
  {
    const page = await browser.newPage();
    await prepareHuman(page);
    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(260));
    await screenshotCanvas(page, `${outDir}/normal-jump.png`);
    await page.close();
  }

  {
    const page = await browser.newPage();
    await prepareHuman(page);
    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(70));
    await page.keyboard.press('ArrowUp');
    await page.evaluate(() => window.advanceTime?.(260));
    await screenshotCanvas(page, `${outDir}/double-jump.png`);
    await page.close();
  }

  console.log('captures-ready');
} finally {
  await browser.close();
}
