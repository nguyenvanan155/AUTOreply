/**
 * Human Behavior Simulator
 * Makes automation appear human-like to avoid detection.
 */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

async function randomDelay(minMs = 3000, maxMs = 10000) {
  const delay = randomInt(minMs, maxMs);
  await new Promise(r => setTimeout(r, delay));
  return delay;
}

async function replyDelay(minMs = 10000, maxMs = 30000) {
  const delay = randomInt(minMs, maxMs);
  await new Promise(r => setTimeout(r, delay));
  return delay;
}

async function simulateTyping(page, locator, text) {
  // Click the element first
  await locator.click();
  await new Promise(r => setTimeout(r, randomInt(300, 700)));

  // Type character by character with varying speed
  for (const char of text) {
    await locator.pressSequentially(char, { delay: 0 });
    await new Promise(r => setTimeout(r, randomInt(40, 160)));

    // Occasional pause mid-word (simulates thinking)
    if (Math.random() < 0.05) {
      await new Promise(r => setTimeout(r, randomInt(300, 800)));
    }
  }
}

async function simulateMouseMovement(page) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const movements = randomInt(2, 5);

  for (let i = 0; i < movements; i++) {
    const x = randomInt(100, viewport.width - 100);
    const y = randomInt(100, viewport.height - 100);
    await page.mouse.move(x, y, { steps: randomInt(5, 15) });
    await new Promise(r => setTimeout(r, randomInt(100, 400)));
  }
}

async function simulateScroll(page) {
  const direction = Math.random() > 0.5 ? 1 : -1;
  const amount = randomInt(100, 400) * direction;
  await page.mouse.wheel(0, amount);
  await new Promise(r => setTimeout(r, randomInt(500, 1500)));
}

function shouldTakeBreak(replyCount, breakAfter = 7) {
  // Take a break after breakAfter ± 2 replies
  const threshold = breakAfter + randomInt(-2, 1);
  return replyCount > 0 && replyCount % threshold === 0;
}

async function takeBreak(minMs = 120000, maxMs = 300000) {
  const duration = randomInt(minMs, maxMs);
  await new Promise(r => setTimeout(r, duration));
  return duration;
}

module.exports = {
  randomInt,
  randomFloat,
  randomDelay,
  replyDelay,
  simulateTyping,
  simulateMouseMovement,
  simulateScroll,
  shouldTakeBreak,
  takeBreak,
};
