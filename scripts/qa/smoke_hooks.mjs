import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:41783';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];

  page.on('pageerror', (error) => {
    errors.push(`pageerror:${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console:${message.text()}`);
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 10000 });

    try {
      await page.waitForSelector('.name-setup__submit', { timeout: 2500 });
      await page.click('.name-setup__submit');
    } catch {
      // Setup modal can be absent depending on game flow.
    }

    await page.waitForFunction(() => typeof window.advanceTime === 'function', { timeout: 10000 });
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 10000 });
    await page.evaluate(() => window.advanceTime?.(1000));

    const snapshot = await page.evaluate(() => window.render_game_to_text?.() ?? null);
    if (!snapshot || typeof snapshot !== 'string') {
      throw new Error('render_game_to_text returned an invalid payload');
    }

    let parsed;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      throw new Error('render_game_to_text did not return valid JSON');
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.phase !== 'string') {
      throw new Error('snapshot JSON is missing expected gameplay fields');
    }

    await page.evaluate(() => window.advanceTime?.(1000));
    if (errors.length > 0) {
      throw new Error(`runtime console errors detected: ${errors[0]}`);
    }

    console.log(`smoke-ok ${url}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
