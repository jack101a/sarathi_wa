const fs = require('fs');
const path = require('path');
const { smartSolveCaptcha } = require('../../sarathiCommon');

async function checkFinalDeclarations(page) {
    console.log("[DLSubmit] Preparing for final declarations...");

    // Wait for the form content to settle
    await page.waitForTimeout(2000);

    // Iteratively check the declaration checkboxes because the portal renders them dynamically
    for (let i = 0; i < 8; i++) {
        await page.evaluate(() => {
            const trs = document.querySelectorAll('#trDeclare tr');
            trs.forEach(tr => {
                const cb = tr.querySelector('input[type="checkbox"]');
                if (cb && !cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
        await page.waitForTimeout(500);
    }
}

async function forceEnableSubmitElements(page) {
    // In case the captcha script disables the submit elements and we solve it manually
    await page.evaluate(() => {
        ['subtn', 'submitbtn', 'buttonSubmit'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        });
    });
}

async function submitFinalForm(page) {
    let appNumber = null;
    let screenshotPath = null;
    
    // Attempt Captcha loop and submit
    for (let attempts = 1; attempts <= 5; attempts++) {
        await checkFinalDeclarations(page);
        
        console.log(`[DLSubmit] Final Captcha Attempt ${attempts}...`);
        await smartSolveCaptcha(page, `Final Captcha ${attempts}`, 'DLSubmit');
        await page.waitForTimeout(1000);

        await forceEnableSubmitElements(page);

        // Try to click Submit
        const submitBtn = page.locator('#subtn, #submitbtn, #buttonSubmit, input[type="submit"][value="Submit"]').first();
        if (await submitBtn.isVisible()) {
            console.log("🛑 [DLSubmit] [TEST MODE] Final Submit button is VISIBLE! Skipped click for testing.");
            await page.waitForTimeout(15000); // Leave it open for 15s to verify visually
            appNumber = "TEST_SUCCESS";
            break;
        } else {
            console.log("[DLSubmit] Could not find Submit button. Attempting generic form submit.");
            await page.evaluate(() => {
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) forms[0].submit();
            });
        }

        console.log("[DLSubmit] Waiting for response/redirect after Submit...");
        try {
            // Wait for URL change to acknowledgment or error message
            await Promise.race([
                page.waitForURL(/acknowledgement/i, { timeout: 15000 }),
                page.locator('.errorMessage').first().waitFor({ state: 'visible', timeout: 8000 })
            ]);
        } catch (e) {}

        const currentUrl = page.url();
        console.log("[DLSubmit] Current URL after submit:", currentUrl);

        if (currentUrl.toLowerCase().includes('acknowledgement')) {
            console.log("[DLSubmit] Reached acknowledgment page!");
            
            const nallocPanel = page.locator('.panel-body.NALOC');
            await nallocPanel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            
            if (await nallocPanel.isVisible()) {
                // Extract Application No
                const textContent = await nallocPanel.innerText();
                const match = textContent.match(/Application No \s*:\s*(\d+)/i);
                if (match && match[1]) {
                    appNumber = match[1];
                }
                
                // Screenshot
                const ssName = `success_final_${Date.now()}.png`;
                screenshotPath = path.join(__dirname, '../../../../screenshots', ssName);
                if (!fs.existsSync(path.dirname(screenshotPath))) fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
                await nallocPanel.screenshot({ path: screenshotPath });
                console.log("[DLSubmit] Success screenshot taken at:", screenshotPath);
            }
            break;
        } else {
            const errorEl = page.locator('.errorMessage').first();
            if (await errorEl.isVisible()) {
                const errorText = await errorEl.innerText();
                console.log("[DLSubmit] Portal returned error:", errorText);
                if (errorText.toLowerCase().includes('captcha')) {
                    console.log("[DLSubmit] Retrying due to captcha mismatch...");
                    await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                    await page.waitForTimeout(1500);
                    continue;
                } else {
                    throw new Error(`Govt Portal: ${errorText.trim()}`);
                }
            }
        }
    }

    if (!appNumber) {
        // Fallback search in entire body text
        const bodyText = await page.locator('body').innerText();
        const fallbackMatch = bodyText.match(/Application No \s*:\s*(\d+)/i);
        if (fallbackMatch && fallbackMatch[1]) {
            appNumber = fallbackMatch[1];
        } else {
            throw new Error("Failed to submit final form or extract application number.");
        }
    }

    return { appNumber, screenshotPath };
}

module.exports = {
    submitFinalForm
};
