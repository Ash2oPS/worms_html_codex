import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:41783';
const gameCount = Number.parseInt(process.argv[3] ?? '8', 10);
const maxSecondsPerGame = Number.parseInt(process.argv[4] ?? '420', 10);

function parseState(raw) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeTeams(state) {
  const hpByTeam = new Map();
  const aliveByTeam = new Map();

  for (const worm of state.worms ?? []) {
    hpByTeam.set(worm.teamId, (hpByTeam.get(worm.teamId) ?? 0) + Math.max(0, worm.hp ?? 0));
    aliveByTeam.set(
      worm.teamId,
      (aliveByTeam.get(worm.teamId) ?? 0) + (worm.alive ? 1 : 0),
    );
  }

  return { hpByTeam, aliveByTeam };
}

async function runSingleGame(browser, index) {
  const page = await browser.newPage();
  const issues = [];

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.name-setup__submit', { timeout: 10000 });
    await page.click('.name-setup__submit');
  } catch {
    // If setup modal is not present, continue with current flow.
  }
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 10000 });
  await page.waitForFunction(() => typeof window.advanceTime === 'function', { timeout: 10000 });

  let state = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    state = parseState(await page.evaluate(() => window.render_game_to_text?.() ?? null));
    if (state) {
      break;
    }
    await page.waitForTimeout(120);
  }

  if (!state) {
    await page.close();
    return {
      game: index,
      result: 'error',
      issues: ['state_unavailable_at_start'],
      turns: 0,
      seconds: 0,
      winnerTeamId: null,
      hpByTeam: {},
      aliveByTeam: {},
    };
  }

  let lastTurn = state.turn?.number ?? 0;
  let sameTurnSeconds = 0;
  let totalHp = (state.worms ?? []).reduce((sum, worm) => sum + Math.max(0, worm.hp ?? 0), 0);
  let noDamageSeconds = 0;
  let nullTimerSeen = false;
  let ended = false;
  let endSecond = 0;

  for (let second = 1; second <= maxSecondsPerGame; second += 1) {
    await page.evaluate(() => window.advanceTime?.(1000));
    state = parseState(await page.evaluate(() => window.render_game_to_text?.() ?? null));
    if (!state) {
      issues.push('state_unavailable_during_game');
      break;
    }

    const turnNumber = state.turn?.number ?? 0;
    if (turnNumber === lastTurn) {
      sameTurnSeconds += 1;
    } else {
      sameTurnSeconds = 0;
      lastTurn = turnNumber;
    }

    if ((state.phase === 'aiming' || state.phase === 'post_shot') && sameTurnSeconds > 35) {
      issues.push(`turn_stall_${state.phase}_${sameTurnSeconds}s`);
      break;
    }

    if (state.turn?.turnTimeLeftMs === null) {
      nullTimerSeen = true;
    }

    const nextTotalHp = (state.worms ?? []).reduce((sum, worm) => sum + Math.max(0, worm.hp ?? 0), 0);
    if (nextTotalHp < totalHp) {
      noDamageSeconds = 0;
    } else {
      noDamageSeconds += 1;
    }
    totalHp = nextTotalHp;

    if (noDamageSeconds > 180) {
      issues.push(`no_damage_for_${noDamageSeconds}s`);
      break;
    }

    if (state.phase === 'match_over') {
      ended = true;
      endSecond = second;
      break;
    }
  }

  if (!ended && issues.length === 0) {
    issues.push('match_not_finished_within_budget');
  }

  if (nullTimerSeen) {
    issues.push('turn_timer_serialized_as_null');
  }

  const summary = summarizeTeams(state);
  const hpByTeam = Object.fromEntries(summary.hpByTeam.entries());
  const aliveByTeam = Object.fromEntries(summary.aliveByTeam.entries());

  const report = {
    game: index,
    result: ended ? 'finished' : 'incomplete',
    issues,
    turns: state.turn?.number ?? 0,
    seconds: ended ? endSecond : maxSecondsPerGame,
    winnerTeamId: state.winnerTeamId ?? null,
    hpByTeam,
    aliveByTeam,
  };

  await page.close();
  return report;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });

  const reports = [];
  try {
    for (let game = 1; game <= gameCount; game += 1) {
      const report = await runSingleGame(browser, game);
      reports.push(report);
      console.log(`game ${game}: ${report.result} turns=${report.turns} winner=${report.winnerTeamId ?? 'none'} issues=${report.issues.join('|') || 'none'}`);
    }
  } finally {
    await browser.close();
  }

  const totalIssues = reports.reduce((sum, report) => sum + report.issues.length, 0);
  const unfinished = reports.filter((report) => report.result !== 'finished').length;
  const issueHistogram = new Map();
  for (const report of reports) {
    for (const issue of report.issues) {
      issueHistogram.set(issue, (issueHistogram.get(issue) ?? 0) + 1);
    }
  }

  const summary = {
    url,
    gameCount,
    maxSecondsPerGame,
    totalIssues,
    unfinished,
    issueHistogram: Object.fromEntries(issueHistogram.entries()),
    reports,
  };

  console.log('\nSUMMARY_JSON_START');
  console.log(JSON.stringify(summary, null, 2));
  console.log('SUMMARY_JSON_END');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
