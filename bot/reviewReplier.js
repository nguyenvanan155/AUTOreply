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

    // Hide intercepting iframes (like the business chat/booking popup)
    try {
      await page.evaluate(() => {
        const iframe = document.getElementById('guest-app-iframe');
        if (iframe) iframe.style.display = 'none';
      });
    } catch(e) {}

    // Find ALL reviews by author name (Google Maps sometimes shows snippets without buttons first)
    const reviewContainers = page.locator('.jftiEf').filter({ hasText: reviewAuthor });
    const matchCount = await reviewContainers.count();

    if (matchCount === 0) {
      return { success: false, error: `Review by "${reviewAuthor}" not found on page` };
    }

    let replyButton = null;
    let menuReplyItem = null;

    // ✅ 3. Scroll trước khi tìm để kích hoạt lazy load của Google Maps
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2000);

    // Iterate to find the container that ACTUALLY has a reply button
    for (let i = 0; i < matchCount; i++) {
      const container = reviewContainers.nth(i);
      await container.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);

      // 🔥 Pro: dùng aria-label (ổn định hơn text)
      let btn = container.locator('[aria-label*="Reply"], [aria-label*="Trả lời"], [aria-label*="Responder"]').first();
      
      // ✅ 2. Dùng selector siêu mềm (Bắt bằng Text đè vỡ mọi rào cản Tag HTML)
      if (await btn.count() === 0 || !(await btn.isVisible({ timeout: 1500 }))) {
        // Tìm element nằm sâu nhất có chứa cụm từ chính xác (bỏ qua việc nó là div, span, hay a)
        btn = container.getByText(/^(Reply|Trả lời|Responder)$/i).first();
      }

      // ✅ 5. Check cẩn thận đừng assume có nút
      if (await btn.count() > 0 && await btn.isVisible({ timeout: 1500 })) {
        replyButton = btn;
        break; // found it!
      } else {
        // Check for "More" menu approach on this container
        const mBtn = container.locator('button[aria-label*="More"], button[aria-label*="Thêm"]').first();
        if (await mBtn.isVisible({ timeout: 1000 })) {
          await mBtn.click();
          await randomDelay(800, 1500);
          const rItem = page.locator('[role="menuitem"]').filter({ hasText: /(Reply|Trả lời)/i }).first();
          if (await rItem.isVisible({ timeout: 1000 })) {
            menuReplyItem = rItem;
            break; // found it inside menu!
          }
          // Close menu if not found
          await page.keyboard.press('Escape'); 
        }
      }
    }

    if (replyButton) {
      await replyButton.click();
    } else if (menuReplyItem) {
      await menuReplyItem.click({ force: true });
    } else {
      // ✅ 1. Debug xem nút có tồn tại không
      console.log(`[Debug] Không tìm thấy nút Reply cho "${reviewAuthor}"`);
      try {
        const buttons = await page.locator('button').allTextContents();
        console.log(`[Debug] Các nút trên trang:`, buttons.map(b => b.trim()).filter(b => b));
      } catch (e) {}
      
      return { success: false, error: 'Reply button not found' };
    }

    await randomDelay(1500, 3000);

    // Find the reply textarea/input
    let replyInput = page.getByRole('textbox').last();
    if (!(await replyInput.isVisible({ timeout: 5000 }))) {
      // Fallback: try standard textarea locator
      replyInput = page.locator('textarea').last();
      if (!(await replyInput.isVisible({ timeout: 3000 }))) {
        return { success: false, error: 'Reply text input not found' };
      }
    }

    // Simulate human typing with delay
    await replyDelay(5000, 15000);
    await simulateTyping(page, replyInput, replyText);
    await randomDelay(2000, 4000);

    // Check for CAPTCHA before submitting
    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    // ✅ Cập nhật tìm nút Submit (Lần 2 - nút gửi đi)
    // Cũng áp dụng selector Pro: ưu tiên aria-label sau đó dùng text mềm, lấy nút cuối cùng (thường nằm ở bottom Modal)
    let submitButton = page.locator('[aria-label*="Post"], [aria-label*="Submit"], [aria-label*="Send"], [aria-label*="Reply"], [aria-label*="Trả lời"], [aria-label*="Gửi"]').last();
    
    if (await submitButton.count() === 0 || !(await submitButton.isVisible({ timeout: 2000 }))) {
      submitButton = page.getByText(/^(Post|Submit|Send|Reply|Trả lời|Gửi)$/i).last();
    }

    if (await submitButton.count() === 0 || !(await submitButton.isVisible({ timeout: 2000 }))) {
      // ✅ 1. Debug xem nút có tồn tại không
      console.log(`[Debug] Không tìm thấy nút Submit/Reply cuối cùng để gửi`);
      try {
        const buttons = await page.locator('button').allTextContents();
        console.log(`[Debug] Các nút trên trang lúc Submit:`, buttons.map(b => b.trim()).filter(b => b));
      } catch (e) {}

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

    // Hide intercepting iframes (like the business chat/booking popup)
    try {
      await page.evaluate(() => {
        const iframe = document.getElementById('guest-app-iframe');
        if (iframe) iframe.style.display = 'none';
      });
    } catch(e) {}

    // Check for CAPTCHA
    if (await detectCaptcha(page)) {
      return { success: false, error: 'CAPTCHA_DETECTED' };
    }

    // ✅ 3. Scroll sâu để DOM kích hoạt layout
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2000);

    // Try to find a reply button - the review should be prominently displayed
    // 🔥 Pro: aria-label ổn định nhất
    let replyButton = page.locator('[aria-label*="Reply"], [aria-label*="Trả lời"], [aria-label*="Responder"]').first();
    let isVisible = await replyButton.count() > 0 && await replyButton.isVisible({ timeout: 2000 });

    if (!isVisible) {
      // ✅ 2. Softer selector fallback đè tag
      replyButton = page.getByText(/^(Reply|Trả lời|Responder)$/i).first();
      isVisible = await replyButton.count() > 0 && await replyButton.isVisible({ timeout: 2000 });
    }

    if (isVisible) {
      await replyButton.click();
      await randomDelay(1500, 3000);
    } else {
      // Try alternative approaches
      // Sometimes we need to click on the review first
      const reviewElement = page.locator('.jftiEf, [data-review-id]').first();
      if (await reviewElement.isVisible({ timeout: 5000 })) {
        await reviewElement.click({ force: true });
        await randomDelay(1000, 2000);

        // 🔥 Aria-label
        let replyBtn = page.locator('[aria-label*="Reply"], [aria-label*="Trả lời"], [aria-label*="Responder"]').first();
        if (await replyBtn.count() === 0 || !(await replyBtn.isVisible({ timeout: 2000 }))) {
           // Mềm hơn (Softer selector)
           replyBtn = page.locator('button:has-text("Reply"), button:has-text("Trả lời"), button:has-text("Responder")').first();
        }

        // ✅ 5. Check count trước khi assume nó có mặt
        if (await replyBtn.count() > 0 && await replyBtn.isVisible({ timeout: 3000 })) {
          await replyBtn.click();
          await randomDelay(1500, 3000);
        } else {
          // ✅ 1. Debug xem nút có tồn tại không
          console.log(`[Debug] Direct Link - Không tìm thấy nút Reply`);
          try {
            const buttons = await page.locator('button').allTextContents();
            console.log(`[Debug] Direct Link - Các nút trên trang:`, buttons.map(b => b.trim()).filter(b => b));
          } catch (e) {}

          return { success: false, error: 'Reply button not found on direct link page' };
        }
      } else {
        return { success: false, error: 'Review not found on direct link page' };
      }
    }

    // Find the reply textarea
    let replyInput = page.getByRole('textbox').last();
    if (!(await replyInput.isVisible({ timeout: 5000 }))) {
      // Fallback
      replyInput = page.locator('textarea').last();
      if (!(await replyInput.isVisible({ timeout: 3000 }))) {
        return { success: false, error: 'Reply text input not found' };
      }
    }

    // Type reply with human-like behavior
    await replyDelay(5000, 15000);
    await simulateTyping(page, replyInput, replyText);
    await randomDelay(2000, 4000);

    // ✅ Cập nhật tìm nút Submit (Lần 2 - nút gửi đi) trong Direct Link
    let submitButton = page.locator('[aria-label*="Post"], [aria-label*="Submit"], [aria-label*="Send"], [aria-label*="Reply"], [aria-label*="Trả lời"], [aria-label*="Gửi"]').last();
    
    if (await submitButton.count() === 0 || !(await submitButton.isVisible({ timeout: 2000 }))) {
      submitButton = page.getByText(/^(Post|Submit|Send|Reply|Trả lời|Gửi)$/i).last();
    }

    if (await submitButton.count() === 0 || !(await submitButton.isVisible({ timeout: 2000 }))) {
      console.log(`[Debug] Direct Link - Không tìm thấy nút Submit/Reply cuối cùng để gửi`);
      try {
        const buttons = await page.locator('button').allTextContents();
        console.log(`[Debug] Direct Link - Các nút lúc Submit:`, buttons.map(b => b.trim()).filter(b => b));
      } catch (e) {}

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
