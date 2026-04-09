/**
 * Review Replier
 * Handles the actual reply posting on Google Maps.
 */

const {
  randomDelay,
  replyDelay,
  simulateTyping,
  simulateMouseMovement,
  simulateScroll,
} = require('./humanBehavior');
const { detectCaptcha } = require('./reviewCollector');

/**
 * Reply to a review on the current page.
 * Assumes the page is showing the business reviews.
 * @param {import('playwright').Page} page
 * @param {string} reviewAuthor - To locate the specific review
 * @param {string} replyText - The reply to post
 * @returns {{ success: boolean, error?: string }}
 */
async function replyToReview(page, reviewAuthor, replyText) {
  try {
    // Human-like pre-action behavior
    await simulateMouseMovement(page);
    await randomDelay(1000, 3000);

    // Find the review by author name
    const reviewContainer = page.locator('.jftiEf').filter({ hasText: reviewAuthor }).first();

    if (!(await reviewContainer.isVisible({ timeout: 5000 }))) {
      return { success: false, error: `Review by "${reviewAuthor}" not found on page` };
    }

    // Scroll the review into view
    await reviewContainer.scrollIntoViewIfNeeded();
    await randomDelay(1000, 2000);

    // Find and click the Reply button within this review
    const replyButton = reviewContainer.getByRole('button', { name: /Reply/i }).first();

    if (!(await replyButton.isVisible({ timeout: 5000 }))) {
      // Try alternative: look for a menu button that reveals reply option
      const menuButton = reviewContainer.locator('button[aria-label*="More"]').first();
      if (await menuButton.isVisible({ timeout: 3000 })) {
        await menuButton.click();
        await randomDelay(800, 1500);
        const replyMenuItem = page.getByRole('menuitem', { name: /Reply/i });
        if (await replyMenuItem.isVisible({ timeout: 3000 })) {
          await replyMenuItem.click();
        }
      } else {
        return { success: false, error: 'Reply button not found' };
      }
    } else {
      await replyButton.click();
    }

    await randomDelay(1500, 3000);

    // Find the reply textarea/input
    const replyInput = page.getByRole('textbox').last();
    if (!(await replyInput.isVisible({ timeout: 5000 }))) {
      return { success: false, error: 'Reply text input not found' };
    }

    // Simulate human typing with delay
    await replyDelay(5000, 15000);
    await simulateTyping(page, replyInput, replyText);
    await randomDelay(2000, 4000);

    // Check for CAPTCHA before submitting
    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    // Find and click the submit/post button
    const submitButton = page.getByRole('button', { name: /Post|Submit|Send|Publish/i }).last();
    if (!(await submitButton.isVisible({ timeout: 5000 }))) {
      return { success: false, error: 'Submit button not found' };
    }

    await simulateMouseMovement(page);
    await randomDelay(500, 1500);
    await submitButton.click();

    // Wait for submission to complete
    await randomDelay(3000, 5000);

    // Check for errors after submission
    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reply to a review via a direct review link.
 * Opens the link, finds the review, and posts a reply.
 * @param {import('playwright').Page} page
 * @param {string} linkUrl - Direct URL to the review
 * @param {string} replyText - The reply to post
 * @returns {{ success: boolean, error?: string }}
 */
async function replyViaDirectLink(page, linkUrl, replyText) {
  try {
    // Navigate to the direct link
    await page.goto(linkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 6000);

    // Check for CAPTCHA
    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    // Human behavior
    await simulateMouseMovement(page);
    await simulateScroll(page);
    await randomDelay(2000, 4000);

    // Try to find a reply button - the review should be prominently displayed
    const replyButton = page.getByRole('button', { name: /Reply/i }).first();

    if (await replyButton.isVisible({ timeout: 8000 })) {
      await replyButton.click();
      await randomDelay(1500, 3000);
    } else {
      // Try alternative approaches
      // Sometimes we need to click on the review first
      const reviewElement = page.locator('.jftiEf, [data-review-id]').first();
      if (await reviewElement.isVisible({ timeout: 5000 })) {
        await reviewElement.click();
        await randomDelay(1000, 2000);

        const replyBtn = page.getByRole('button', { name: /Reply/i }).first();
        if (await replyBtn.isVisible({ timeout: 5000 })) {
          await replyBtn.click();
          await randomDelay(1500, 3000);
        } else {
          return { success: false, error: 'Reply button not found on direct link page' };
        }
      } else {
        return { success: false, error: 'Review not found on direct link page' };
      }
    }

    // Find the reply textarea
    const replyInput = page.getByRole('textbox').last();
    if (!(await replyInput.isVisible({ timeout: 5000 }))) {
      return { success: false, error: 'Reply text input not found' };
    }

    // Type reply with human-like behavior
    await replyDelay(5000, 15000);
    await simulateTyping(page, replyInput, replyText);
    await randomDelay(2000, 4000);

    // Submit
    const submitButton = page.getByRole('button', { name: /Post|Submit|Send|Publish/i }).last();
    if (!(await submitButton.isVisible({ timeout: 5000 }))) {
      return { success: false, error: 'Submit button not found' };
    }

    await submitButton.click();
    await randomDelay(3000, 5000);

    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  replyToReview,
  replyViaDirectLink,
};
