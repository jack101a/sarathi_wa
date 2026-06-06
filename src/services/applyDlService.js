const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha, BASE_URL } = require('./sarathiCommon');

const APPLY_DL_TERMINAL_DIALOG_PATTERNS = [
    /\bapply\s+(?:your\s+)?dl\s+after\s+\d+\s*days?\b/i,
    /\bplease\s+apply\s+(?:your\s+)?dl\s+after\b/i,
];

function normalizePortalMessage(message) {
    return String(message || '').replace(/\s+/g, ' ').trim();
}

function isTerminalApplyDLDialog(message) {
    const normalized = normalizePortalMessage(message);
    if (!normalized) return false;

    if (APPLY_DL_TERMINAL_DIALOG_PATTERNS.some(pattern => pattern.test(normalized))) {
        return true;
    }

    const lower = normalized.toLowerCase();
    const fatalKeywords = ['invalid', 'not found', 'expired', 'incorrect', 'exist', 'record', 'not match', 'cannot', 'already'];
    return fatalKeywords.some(kw => lower.includes(kw));
}

function createApplyDLPortalError(message, stage = 'login') {
    const publicMessage = normalizePortalMessage(message) || 'The Sarathi portal rejected this DL application.';
    const error = new Error(`Govt Portal Dialog Error: ${publicMessage}`);
    error.code = 'PORTAL_BUSINESS_RULE';
    error.publicMessage = publicMessage;
    error.portalStage = stage;
    error.retryable = false;
    return error;
}

async function startApplyDLFlow(llNo, dob, mobile) {
    console.log(`🚀 [ApplyDL] Starting flow for LL: ${llNo}, DOB: ${dob}`);

    const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        acceptDownloads: true
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    try {
        await navigateToSarathiHome(page, 'MH');

        console.log("[ApplyDL] Clicking Apply for Driving Licence link...");
        await page.getByRole('link', { name: 'Apply for Driving Licence Apply for Driving Licence' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        let detailsLoaded = false;
        let attempts = 0;
        let lastDialogMessage = null;

        const dialogHandler = async dialog => {
            lastDialogMessage = dialog.message();
            console.log(`💬 [ApplyDL Dialog] ${dialog.type()}: ${lastDialogMessage}`);
            await dialog.dismiss().catch(() => {});
        };
        page.on('dialog', dialogHandler);

        while (!detailsLoaded && attempts < 5) {
            attempts++;
            lastDialogMessage = null;

            console.log(`[ApplyDL] Attempt ${attempts}: Entering LL and DOB with human-like sequence...`);

            const llInput = page.locator('#learningLicence').first();
            await llInput.waitFor({ state: 'visible', timeout: 15000 });

            // Dynamically remove maxlength attribute on the input field once attached to prevent truncation issues
            await llInput.evaluate(el => el.removeAttribute('maxlength'));

            // Simulating human typing for LL Number
            await llInput.click();
            await llInput.focus();
            await llInput.fill('');
            await llInput.pressSequentially(llNo, { delay: 100 });
            await page.waitForTimeout(500);

            // Simulating human typing for DOB
            const dobInput = page.locator('#DOB').first();
            await dobInput.waitFor({ state: 'visible', timeout: 5000 });
            await dobInput.click();
            await dobInput.focus();
            await dobInput.fill('');
            await dobInput.pressSequentially(dob, { delay: 100 });
            await page.waitForTimeout(1000);

            await smartSolveCaptcha(page, `Initial LL Login Attempt ${attempts}`, 'ApplyDL');
            await page.getByRole('button', { name: 'OK' }).click();
            await page.waitForTimeout(2000);

            // Check if dialog appeared with a validation message
            if (lastDialogMessage) {
                console.log(`❌ [ApplyDL] Dialog appeared: "${lastDialogMessage}"`);
                if (isTerminalApplyDLDialog(lastDialogMessage)) {
                    throw createApplyDLPortalError(lastDialogMessage, 'login');
                }
                lastDialogMessage = null; // Clear if ignorable
            }

            // Check if it loaded details or went to the generate OTP page
            const genBtn = page.getByRole('button', { name: 'Generate OTP' }).first();
            const errorMsg = page.locator('.alert-danger, #errorMessages').first();
            
            if (await genBtn.isVisible().catch(() => false) || await page.locator('#otpNumberSarathi').isVisible().catch(() => false)) {
                detailsLoaded = true;
            } else if (await errorMsg.isVisible().catch(() => false)) {
                const text = await errorMsg.textContent();
                throw new Error(`Govt Portal says: ${text.trim()}`);
            } else {
                console.log("[ApplyDL] Retrying login captcha...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!detailsLoaded) {
            throw new Error("Failed to load DL application details after captcha retries.");
        }

        // Remove the temporary login dialog handler
        page.off('dialog', dialogHandler);

        console.log("[ApplyDL] Generating OTP...");
        let otpSent = false;
        attempts = 0;
        let otpDialogMessage = null;

        const otpDialogHandler = async dialog => {
            otpDialogMessage = dialog.message();
            console.log(`💬 [ApplyDL OTP Dialog] ${dialog.type()}: ${otpDialogMessage}`);
            await dialog.dismiss().catch(() => {});
        };
        page.on('dialog', otpDialogHandler);

        let maskedMobile = '';

        while (!otpSent && attempts < 5) {
            attempts++;
            otpDialogMessage = null;
            await smartSolveCaptcha(page, `OTP Generation Attempt ${attempts}`, 'ApplyDL');
            await page.getByRole('button', { name: 'Generate OTP' }).click();
            await page.waitForTimeout(2000);

            if (otpDialogMessage) {
                console.log(`❌ [ApplyDL] Dialog appeared on OTP generation: "${otpDialogMessage}"`);
                if (isTerminalApplyDLDialog(otpDialogMessage)) {
                    throw createApplyDLPortalError(otpDialogMessage, 'otp');
                }
                throw new Error(`Govt Portal OTP Error: ${normalizePortalMessage(otpDialogMessage)}`);
            }

            if (await page.locator('#otpNumberSarathi').isVisible()) {
                otpSent = true;

                // Dynamically extract the masked mobile number directly from DOM elements
                try {
                    // Try 1: Extract from mobilesuccMsgBox
                    const succBoxText = await page.locator('#mobilesuccMsgBox').innerText().catch(() => '');
                    if (succBoxText) {
                        const match = succBoxText.match(/(?:\d+\*+\d+|\*+\d+)/);
                        if (match) {
                            maskedMobile = match[0].replace(/^\d+/, '');
                        }
                    }

                    // Try 2: Extract from text node next to hidden input if Try 1 failed
                    if (!maskedMobile) {
                        const parentText = await page.evaluate(() => {
                            const input = document.getElementById('mobileNumber');
                            if (input && input.parentElement) {
                                return input.parentElement.textContent.replace(input.value, '').trim();
                            }
                            return '';
                        }).catch(() => '');
                        if (parentText && parentText.includes('*')) {
                            maskedMobile = parentText.trim();
                        }
                    }

                    // Try 3: Safe fallback generation using the last 4 digits of the actual value
                    if (!maskedMobile) {
                        const rawMob = await page.locator('#mobileNumber').getAttribute('value').catch(() => '');
                        if (rawMob && rawMob.length >= 6) {
                            maskedMobile = `******${rawMob.slice(-4)}`;
                        }
                    }
                } catch (maskErr) {
                    console.error("[ApplyDL] Error extracting masked mobile:", maskErr);
                }

                if (!maskedMobile) {
                    maskedMobile = '******';
                }
                console.log(`[ApplyDL] OTP sent successfully. Masked mobile: ${maskedMobile}`);
            } else {
                console.log("[ApplyDL] Failed to generate OTP, retrying...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        // Clean up the OTP dialog handler
        page.off('dialog', otpDialogHandler);

        if (!otpSent) {
            throw new Error("Failed to trigger SMS OTP for DL application.");
        }

        return { browser, context, page, maskedMobile };

    } catch (error) {
        console.error("❌ Error in startApplyDLFlow:", error);
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        } else {
            console.log("⚠️ Headless mode is disabled; keeping browser open for inspection.");
        }
        throw error;
    }
}

async function submitApplyDLOTP(browser, context, page, otpCode) {
    console.log("[ApplyDL] Submitting OTP...");
    try {
        await page.locator('#otpNumberSarathi').fill(otpCode);
        await smartSolveCaptcha(page, "OTP Submission", 'ApplyDL');
        await page.locator('#otpCheckbox').check().catch(() => {});
        await page.getByRole('button', { name: 'Submit OTP' }).click();
        await page.waitForTimeout(3000);

        console.log("[ApplyDL] Selecting all class of vehicles...");
        await page.locator('#selectAll').check().catch(() => {});
        await page.waitForTimeout(1000);

        // --- Handle Self-Declaration Form 1 Popup ---
        console.log("[ApplyDL] Clicking Self-Declaration Form...");
        const page1Promise = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'Self Declaration as to' }).click();
        const page1 = await page1Promise;

        console.log("[ApplyDL] Answering Form 1 questionnaire in popup...");
        await page1.waitForLoadState('domcontentloaded');
        await page1.locator('#scopeaN').check().catch(() => {});
        await page1.locator('#scopebY').check().catch(() => {});
        await page1.locator('#scopecN').check().catch(() => {});
        await page1.locator('#scopeeN').check().catch(() => {});
        await page1.locator('#scopefN').check().catch(() => {});
        await page1.locator('#scopegN').check().catch(() => {});
        await page1.locator('#declaringcheck').check().catch(() => {});

        page1.once('dialog', dialog => {
            console.log(`[ApplyDL - Form 1] Dialog: ${dialog.message()}`);
            dialog.accept().catch(() => {});
        });
        await page1.getByRole('button', { name: 'Submit' }).click();
        await page1.waitForTimeout(1000);
        await page1.getByRole('button', { name: 'Okay' }).click().catch(() => {});
        await page1.close().catch(() => {});

        console.log("[ApplyDL] Back to main page. Submitting form...");
        await page.waitForTimeout(2000);

        let submissionSuccessful = false;
        let submitAttempts = 0;

        const submitDialogHandler = async dialog => {
            console.log(`[ApplyDL - Submit Dialog] ${dialog.type()}: ${dialog.message()}`);
            await dialog.accept().catch(() => {});
        };
        page.on('dialog', submitDialogHandler);

        while (!submissionSuccessful && submitAttempts < 5) {
            submitAttempts++;
            console.log(`[ApplyDL] Final submission attempt ${submitAttempts}...`);

            // Locate and check all visible declaration/disclaimer checkboxes first to enable the captcha input & Submit button
            try {
                let checkedAny = true;
                let scanAttempts = 0;
                while (checkedAny && scanAttempts < 8) {
                    scanAttempts++;
                    checkedAny = false;
                    const checkboxes = await page.locator('input[type="checkbox"]').all();
                    for (const cb of checkboxes) {
                        const isVisible = await cb.isVisible().catch(() => false);
                        if (isVisible) {
                            const isChecked = await cb.isChecked().catch(() => false);
                            const id = await cb.getAttribute('id').catch(() => '');
                            const name = await cb.getAttribute('name').catch(() => '');
                            if (id === 'addOrDelcoa') {
                                console.log(`[ApplyDL] Skipping dangerous checkbox: id="${id}" (Change of Address)`);
                                continue;
                            }
                            if (!isChecked) {
                                console.log(`[ApplyDL] Clicking unchecked checkbox: id="${id}", name="${name}"`);
                                await cb.click().catch(() => {});
                                await page.waitForTimeout(600); // Wait for portal JS to run
                                checkedAny = true;
                                break; // Re-scan from beginning to catch newly revealed checkboxes
                            }
                        }
                    }
                }
                await page.waitForTimeout(1500);
            } catch (err) {
                console.error("[ApplyDL] Error checking submission page checkboxes:", err);
            }

            // DOM Force-Enable Fail-Safe
            try {
                await page.evaluate(() => {
                    const captchaEl = document.getElementById('entcaptxtatsubmit')
                                   || document.getElementById('entcaptxt');
                    if (captchaEl && captchaEl.disabled) {
                        captchaEl.removeAttribute('disabled');
                        captchaEl.disabled = false;
                    }
                    const submitEl = document.getElementById('subToDB');
                    if (submitEl && submitEl.disabled) {
                        submitEl.removeAttribute('disabled');
                        submitEl.disabled = false;
                    }
                });
                await page.waitForTimeout(500);
            } catch (err) {
                console.error("[ApplyDL] Error in DOM force-enable fail-safe:", err);
            }

            await smartSolveCaptcha(page, `Final Submission Attempt ${submitAttempts}`, 'ApplyDL');

            await page.getByRole('button', { name: 'Submit' }).click();
            
            // Wait up to 15 seconds for redirection to complete
            console.log("[ApplyDL] Waiting for page redirection...");
            try {
                await page.waitForURL('**/applNoRedirect.do', { timeout: 15000 });
            } catch (e) {
                // If it times out, the redirect may not have happened yet or there was a validation error
            }

            // Check if we are redirected or if application number is visible
            if (page.url().includes('applNoRedirect.do') || await page.locator('text=/Application No/i').first().isVisible().catch(() => false)) {
                submissionSuccessful = true;
            } else {
                console.log("[ApplyDL] Captcha mismatch or validation failed on submit, retrying...");
                await page.locator("#capimgatsubmit, #capimg, img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1500);
            }
        }

        page.off('dialog', submitDialogHandler);

        if (!submissionSuccessful) {
            throw new Error("Application submission failed due to persistent captcha issues or portal timeouts.");
        }

        console.log("[ApplyDL] Successfully submitted! Extracting details...");
        const slipTextLocator = page.locator('text=/Application No :|Application Reference Slip/i').first();
        let extractedText = "Submitted successfully. Page redirected.";
        let appNo = "Unknown";
        let name = "Unknown";

        if (await slipTextLocator.isVisible()) {
            const bodyText = await page.innerText('body');
            const match = bodyText.match(/Application No\s*:\s*(\d+)/i);
            const nameMatch = bodyText.match(/Name\s*:\s*([A-Za-z\s]+)/i);
            
            appNo = match ? match[1] : "Unknown";
            name = nameMatch ? nameMatch[1].trim() : "Unknown";
            extractedText = `Application No: ${appNo}, Name: ${name}`;
            console.log(`🎉 [ApplyDL] Extracted: ${extractedText}`);
        }

        // Take a full-page screenshot of the acknowledgment slip page
        if (!fs.existsSync(CONFIG.TEMP.DIR)) {
            fs.mkdirSync(CONFIG.TEMP.DIR, { recursive: true });
        }
        const screenshotPath = path.join(CONFIG.TEMP.DIR, `ApplyDL_Ack_${Date.now()}.png`);
        console.log(`[ApplyDL] Saving acknowledgment slip screenshot to: ${screenshotPath}`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(err => {
            console.error("[ApplyDL] Failed to take acknowledgment screenshot:", err);
        });

        return {
            success: true,
            extractedText,
            appNo,
            name,
            screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null
        };

    } catch (error) {
        console.error("❌ Error in submitApplyDLOTP:", error);
        throw error;
    } finally {
        const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        } else {
            console.log("⚠️ Headless mode is disabled; keeping browser open for inspection.");
        }
    }
}

module.exports = {
    startApplyDLFlow,
    submitApplyDLOTP,
    isTerminalApplyDLDialog,
    normalizePortalMessage
};
