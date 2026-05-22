const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha, BASE_URL } = require('./sarathiCommon');

async function startDLRenewalFlow(dlNo, dob, rtoCode, mobile) {
    console.log(`🚀 [DLRenewal] Starting flow for DL: ${dlNo}, DOB: ${dob}`);

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

        console.log("[DLRenewal] Clicking DL Renewal link...");
        await page.getByRole('link', { name: 'Apply for Driving Licence Apply for DL Renewal' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        let otpTriggered = false;
        let attempts = 0;
        let lastDialogMessage = null;

        const dialogHandler = async dialog => {
            const msg = dialog.message();
            lastDialogMessage = msg;
            console.log(`💬 [DLRenewal Dialog] ${dialog.type()}: ${msg}`);
            const msgLower = msg.toLowerCase();
            if (dialog.type() === 'confirm' || msgLower.includes('confirm') || msgLower.includes('sure') || msgLower.includes('submit') || msgLower.includes('want to') || msgLower.includes('correct') || msgLower.includes('proceed') || msgLower.includes('would you like to') || msgLower.includes('change')) {
                await dialog.accept().catch(() => {});
            } else {
                await dialog.dismiss().catch(() => {});
            }
        };
        page.on('dialog', dialogHandler);

        while (!otpTriggered && attempts < 5) {
            attempts++;
            lastDialogMessage = null;

            console.log(`[DLRenewal] Attempt ${attempts}: Entering DL and DOB with human-like sequence...`);

            const dlInput = page.getByRole('textbox', { name: 'DL number' }).first();
            await dlInput.waitFor({ state: 'visible', timeout: 15000 });
            await dlInput.click();
            await dlInput.focus();
            await dlInput.fill('');
            await dlInput.pressSequentially(dlNo, { delay: 100 });
            await page.waitForTimeout(500);

            const dobInput = page.getByRole('textbox', { name: 'DD-MM-YYYY' }).first();
            await dobInput.waitFor({ state: 'visible', timeout: 5000 });
            await dobInput.click();
            await dobInput.focus();
            await dobInput.fill('');
            await dobInput.pressSequentially(dob, { delay: 100 });
            await page.waitForTimeout(1000);

            await smartSolveCaptcha(page, `Initial Login Attempt ${attempts}`, 'DLRenewal');
            await page.locator('#PrivacyPolicyTermsofService').check().catch(() => {});
            
            const getDetailsBtn = page.getByRole('button', { name: 'Get DL Details' });
            await getDetailsBtn.click();
            
            console.log("[DLRenewal] Waiting for DL details or error dialog...");
            try {
                // Wait up to 10 seconds for dispDLDet to become visible
                await page.locator('#dispDLDet').waitFor({ state: 'visible', timeout: 10000 });
                otpTriggered = true;
            } catch (e) {
                if (lastDialogMessage) {
                    console.log(`❌ [DLRenewal] Dialog appeared: "${lastDialogMessage}"`);
                    lastDialogMessage = null;
                }
                console.log("[DLRenewal] Failed to load DL Details, refreshing captcha...");
                await page.locator("#capimg, img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!otpTriggered) {
            throw new Error("Failed to pass initial DL login screen. Check DL number or DOB.");
        }

        console.log("[DLRenewal] Setting display details to YES and selecting RTO...");
        await page.locator('#dispDLDet').selectOption('YES');
        
        // Handle selecting RTO. Default to MH47 (Borivali) as per user's instruction
        let targetRto = rtoCode || 'MH47';

        const rtoSelect = page.locator('#rtoCodeDLTr');
        if (targetRto) {
            const options = await rtoSelect.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.textContent })));
            const match = options.find(o => o.text.toLowerCase().includes(targetRto.toLowerCase()) || o.value.includes(targetRto));
            if (match) {
                console.log(`[DLRenewal] Selecting RTO: ${match.text}`);
                await rtoSelect.selectOption(match.value);
            } else {
                console.log(`[DLRenewal] RTO "${targetRto}" not found in dropdown options. Falling back to first option.`);
                await rtoSelect.selectOption({ index: 1 }); // Default fallback to first valid option
            }
        } else {
            console.log(`[DLRenewal] No RTO specified or found. Falling back to first option.`);
            await rtoSelect.selectOption({ index: 1 });
        }

        const injectDirectDropdowns = async () => {
            return await page.evaluate(() => {
                let bgInjected = false;
                let catInjected = false;
                
                const bgSelect = document.getElementById('bloodGroup') || document.querySelector('select[name="bloodGroup"]');
                if (bgSelect) {
                    bgSelect.value = 'U';
                    bgSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    bgInjected = true;
                }
                
                const catSelect = document.getElementById('applEmpCatg') || document.querySelector('select[name="applEmpCatg"]');
                if (catSelect) {
                    catSelect.value = '0';
                    catSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    catInjected = true;
                }
                
                return { bgInjected, catInjected };
            }).catch(err => {
                console.error("[DLRenewal] Error in injectDirectDropdowns:", err);
                return { bgInjected: false, catInjected: false };
            });
        };

        // Let the dropdowns settle after RTO selection
        await page.waitForTimeout(2000);

        // Inject early if present
        console.log("[DLRenewal] Injecting dropdown values early (pre-Proceed)...");
        await injectDirectDropdowns();

        await page.getByRole('button', { name: 'Proceed' }).click();
        await page.waitForTimeout(1000);

        // Inject pre-Confirm
        console.log("[DLRenewal] Injecting dropdown values pre-Confirm...");
        await injectDirectDropdowns();

        const confirmBtn = page.getByRole('button', { name: 'Confirm' }).first();
        if (await confirmBtn.isVisible().catch(() => false)) {
            console.log("[DLRenewal] Confirm button is visible, clicking it...");
            await confirmBtn.click();
        } else {
            console.log("[DLRenewal] Confirm button is not visible, proceeding...");
        }

        // Let the next page load and settle
        console.log("[DLRenewal] Waiting for Aadhaar/Details page to load and settle...");
        await page.waitForTimeout(3000);

        // Fast check/inject on Aadhaar/Details page in case they are dynamically rendered here
        const result = await injectDirectDropdowns();
        if (result.bgInjected || result.catInjected) {
            console.log(`[DLRenewal] ✅ Injected dropdown values on Aadhaar/Details page: BloodGroup=${result.bgInjected}, Category=${result.catInjected}`);
        }

        await page.locator('#aadhaarHoldingType0').check().catch(() => {});
        
        const submitBtn = page.getByRole('button', { name: 'Submit' }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click();
        }

        console.log("[DLRenewal] Generating OTP...");
        let otpSent = false;
        attempts = 0;

        while (!otpSent && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `OTP Request Attempt ${attempts}`, 'DLRenewal');
            await page.getByRole('button', { name: 'Generate OTP' }).click();
            await page.waitForTimeout(2000);

            if (await page.locator('#otpNumberSarathi').isVisible()) {
                otpSent = true;
            } else {
                console.log("[DLRenewal] Failed to generate OTP, retrying...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!otpSent) {
            throw new Error("Failed to trigger SMS OTP for DL Renewal.");
        }

        // Clean up global dialog handler before returning
        page.off('dialog', dialogHandler);

        // Return context, page, and browser to pause
        return { browser, context, page };

    } catch (error) {
        console.error("❌ Error in startDLRenewalFlow:", error);
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        } else {
            console.log("⚠️ Headless mode is disabled; keeping browser open for inspection.");
        }
        throw error;
    }
}

async function submitDLRenewalOTP(browser, context, page, otpCode, serviceType = 'RENEWAL OF DL') {
    console.log("[DLRenewal] Submitting OTP...");
    const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
    try {
        // ── OTP Submission with retry on invalid OTP / captcha mismatch ──────────
        let otpAccepted = false;
        let otpAttempts = 0;
        let otpDialogMessage = null;

        const otpDialogHandler = async dialog => {
            otpDialogMessage = dialog.message();
            console.log(`💬 [DLRenewal - OTP Dialog] ${dialog.type()}: ${otpDialogMessage}`);
            await dialog.dismiss().catch(() => {});
        };
        page.on('dialog', otpDialogHandler);

        while (!otpAccepted && otpAttempts < 5) {
            otpAttempts++;
            otpDialogMessage = null;

            console.log(`[DLRenewal] OTP submission attempt ${otpAttempts}...`);
            await page.locator('#otpNumberSarathi').fill(otpCode);
            await smartSolveCaptcha(page, `OTP Submission Attempt ${otpAttempts}`, 'DLRenewal');
            await page.locator('#otpCheckbox').check().catch(() => {});
            await page.getByRole('button', { name: 'Submit OTP' }).click();
            await page.waitForTimeout(3000);

            if (otpDialogMessage) {
                const lower = otpDialogMessage.toLowerCase();
                console.log(`❌ [DLRenewal] OTP dialog: "${otpDialogMessage}"`);
                // Fatal errors — wrong OTP entered by user, cannot retry automatically
                const fatalKeywords = ['invalid otp', 'wrong otp', 'otp expired', 'otp not matched', 'incorrect otp'];
                if (fatalKeywords.some(kw => lower.includes(kw))) {
                    page.off('dialog', otpDialogHandler);
                    throw new Error(`Portal rejected OTP: ${otpDialogMessage}`);
                }
                // Captcha / temporary errors — retry
                console.log(`[DLRenewal] Retrying OTP submission (captcha/temp error)...`);
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            } else {
                // If no dialog popped up, let's verify if the OTP input is still visible
                // If it is still visible, the submission was not accepted (probably wrong captcha printed on screen)
                const stillOnOtpPage = await page.locator('#otpNumberSarathi').isVisible().catch(() => false);
                if (stillOnOtpPage) {
                    console.log("❌ [DLRenewal] Still on OTP page after submit. Captcha was probably wrong!");
                    const errorText = await page.locator('.errText, .error, #errDiv, #errorDiv').first().innerText().catch(() => '');
                    if (errorText) {
                        console.log(`[DLRenewal] Found page error text: "${errorText}"`);
                        const lowerErr = errorText.toLowerCase();
                        if (lowerErr.includes('invalid') && (lowerErr.includes('otp') || lowerErr.includes('one time password'))) {
                            page.off('dialog', otpDialogHandler);
                            throw new Error(`Portal rejected OTP (shown on page): ${errorText}`);
                        }
                    }
                    console.log(`[DLRenewal] Refreshing captcha and retrying OTP submission...`);
                    await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                    await page.waitForTimeout(1500);
                } else {
                    console.log("✅ [DLRenewal] OTP accepted successfully (navigated away from OTP page).");
                    otpAccepted = true;
                }
            }
        }

        page.off('dialog', otpDialogHandler);

        if (!otpAccepted) {
            throw new Error("Failed to submit OTP after 3 attempts — persistent captcha or portal error.");
        }

        console.log("[DLRenewal] OTP accepted. Waiting for service selection page to load...");

        // ── Service Selection Page ──────────────────────────────────────────────
        // All checkboxes share the same id - must target by value attribute
        // Wait up to 15s for the service selection page checkboxes to appear
        console.log("[DLRenewal] Waiting for service selection checkboxes to appear...");
        const firstServiceSelector = `input[type="checkbox"][name="dlc"]`;
        try {
            await page.locator(firstServiceSelector).first().waitFor({ state: 'visible', timeout: 15000 });
            console.log("[DLRenewal] Service selection page loaded.");
        } catch (_) {
            console.log("[DLRenewal] ⚠️ Service checkboxes did not appear within 15s — page may have changed.");
        }

        console.log(`[DLRenewal] Selecting required DL service: ${serviceType}...`);
        const checkbox = page.locator(`input[type="checkbox"][name="dlc"][value="${serviceType}"]`).first();
        const isVisible = await checkbox.isVisible().catch(() => false);
        if (isVisible) {
            const isChecked = await checkbox.isChecked().catch(() => false);
            if (!isChecked) {
                await checkbox.check().catch(() => {});
                console.log(`[DLRenewal] ✅ Checked service: ${serviceType}`);
            } else {
                console.log(`[DLRenewal] ℹ️ Already checked: ${serviceType}`);
            }
        } else {
            console.log(`[DLRenewal] ⚠️ Service not visible on page (may not apply): ${serviceType}`);
        }

        await page.waitForTimeout(1000);

        // Check if a popup modal appeared immediately after checking the service checkbox
        try {
            await page.waitForTimeout(2000); // Wait for modal popup to trigger/animate
            const selectPopupCloseBtn = page.locator('input[type="button"][data-dismiss="modal"][value="close"], input[value="close"], button[data-dismiss="modal"]', { hasText: 'close' }).first();
            if (await selectPopupCloseBtn.isVisible().catch(() => false)) {
                console.log("[DLRenewal] Popup detected after checking service. Clicking close button...");
                await selectPopupCloseBtn.click();
                await page.waitForTimeout(2000);
            }
        } catch (err) {
            console.log("[DLRenewal] Service selection popup check failed:", err.message);
        }

        // Click Proceed on service selection page
        console.log("[DLRenewal] Clicking Proceed on service selection...");
        const proceedByIdDone = await page.locator('#trsaction_enve_proceed').click().then(() => true).catch(() => false);
        if (!proceedByIdDone) {
            await page.getByRole('button', { name: 'Proceed' }).click();
        }
        await page.waitForTimeout(3000);

        // First pause removed for final pre-submit test

        // ── DL Extract Reason Selection Page ─────────────────────────────────────
        if (serviceType === 'DL EXTRACT') {
            console.log("[DLRenewal] DL Extract flow: checking for Reason Selection page...");
            try {
                const reasonSelect = page.locator('#dlextractreasoncd');
                await reasonSelect.waitFor({ state: 'visible', timeout: 5000 });
                console.log("[DLRenewal] Reason selection page detected. Selecting 'Miscellaneous'...");
                await reasonSelect.selectOption('Miscellaneous');
                await page.waitForTimeout(1000);
                
                console.log("[DLRenewal] Clicking Confirm on Reason Selection page...");
                await page.locator('#dlextconfirm').click();
                console.log("[DLRenewal] Confirm clicked. Waiting for navigation...");
                await page.waitForTimeout(3000);
            } catch (err) {
                console.log("[DLRenewal] Reason selection page not found or not required:", err.message);
            }
        }

        // ── DL Duplicate Reason Selection Page ─────────────────────────────────────
        if (serviceType === 'ISSUE OF DUPLICATE DL') {
            console.log("[DLRenewal] ISSUE OF DUPLICATE DL flow: checking for Reason Selection...");
            try {
                const reasonSelect = page.locator('#dupreasoncd');
                await reasonSelect.waitFor({ state: 'visible', timeout: 10000 });
                console.log("[DLRenewal] Selecting 'Miscellaneous' as duplicate reason...");
                await reasonSelect.selectOption('Miscellaneous');
                await page.waitForTimeout(1000);
                
                const descTextarea = page.locator('#dupreasondesc');
                if (await descTextarea.isVisible()) {
                    console.log("[DLRenewal] Entering 'misc' as description...");
                    await descTextarea.fill('misc');
                    await page.waitForTimeout(1000);
                }

                console.log("[DLRenewal] Clicking Confirm on Duplicate reason selection...");
                const confirmBtn = page.locator('#dupconfirm');
                await confirmBtn.click();
                console.log("[DLRenewal] Confirm clicked. Waiting for page to update...");
                await page.waitForTimeout(3000);

                // Now we click the main Submit button at the bottom of the page
                const mainSubmitBtn = page.locator('input[type="submit"][value="Submit"], button[type="submit"]', { hasText: 'Submit' }).first();
                if (await mainSubmitBtn.isVisible()) {
                    console.log("[DLRenewal] Clicking main Submit button on Duplicate page...");
                    await mainSubmitBtn.click();
                    await page.waitForTimeout(3000);
                }
            } catch (err) {
                console.log("[DLRenewal] Error in Duplicate reason selection flow:", err.message);
            }
        }


        // ── Form 1 Self-Declaration Popup (if it appears or button is visible) ──
        console.log("[DLRenewal] Checking for Form 1 Self-Declaration button or popup...");
        let popupPage = null;
        try {
            // First check if the popup already opened automatically
            popupPage = await page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
            if (!popupPage) {
                // If not automatically opened, check for the Form 1 button on page to click it
                const form1Button = page.locator('input[name="Form1"], input[value*="Self-Declaration"], button[name="Form1"]').first();
                if (await form1Button.isVisible()) {
                    console.log("[DLRenewal] Form 1 button is visible. Clicking to trigger popup...");
                    const popupPromise = page.waitForEvent('popup', { timeout: 10000 });
                    await form1Button.click();
                    popupPage = await popupPromise.catch(() => null);
                }
            }
        } catch (err) {
            console.log("[DLRenewal] Form 1 popup check failed:", err.message);
        }

        if (popupPage) {
            console.log("[DLRenewal] Form 1 popup detected. Filling self-declaration...");
            await popupPage.waitForLoadState('domcontentloaded');
            await popupPage.locator('#scopeaN').check().catch(() => {});
            await popupPage.locator('#scopebY').check().catch(() => {});
            await popupPage.locator('#scopecN').check().catch(() => {});
            await popupPage.locator('#scopeeN').check().catch(() => {});
            await popupPage.locator('#scopefN').check().catch(() => {});
            await popupPage.locator('#scopegN').check().catch(() => {});
            await popupPage.locator('#declaringcheck').check().catch(() => {});

            popupPage.once('dialog', async dialog => {
                console.log(`[DLRenewal - Form 1 Dialog] ${dialog.message()}`);
                await dialog.accept().catch(() => {});
            });
            await popupPage.getByRole('button', { name: 'Submit' }).click().catch(async () => {
                await popupPage.locator('input[type="submit"], button[type="submit"]').first().click().catch(() => {});
            });
            await popupPage.waitForTimeout(1000);
            await popupPage.getByRole('button', { name: 'Okay' }).click().catch(() => {});
            await popupPage.close().catch(() => {});
            console.log("[DLRenewal] Form 1 popup completed.");
            await page.waitForTimeout(2000);
        }

        // ── Final Submission with CAPTCHA ───────────────────────────────────────
        const submitDialogHandler = async dialog => {
            console.log(`[DLRenewal - Submit Dialog] ${dialog.type()}: ${dialog.message()}`);
            await dialog.accept().catch(() => {});
        };
        page.on('dialog', submitDialogHandler);

        let submissionSuccessful = false;
        let submitAttempts = 0;

        while (!submissionSuccessful && submitAttempts < 5) {
            submitAttempts++;
            console.log(`[DLRenewal] Final submission attempt ${submitAttempts}...`);

            // Locate and check all visible declaration/disclaimer checkboxes first to enable the captcha input & Submit button
            try {
                const checkboxes = await page.locator('input[type="checkbox"]').all();
                for (const cb of checkboxes) {
                    const isVisible = await cb.isVisible().catch(() => false);
                    if (isVisible) {
                        const id = await cb.getAttribute('id').catch(() => '');
                        const name = await cb.getAttribute('name').catch(() => '');
                        const isChecked = await cb.isChecked().catch(() => false);
                        console.log(`[DLRenewal] Found checkbox on submit page: id="${id}", name="${name}", checked=${isChecked}`);
                        if (!isChecked) {
                            await cb.check().catch(() => {});
                            console.log(`[DLRenewal] Checked submission page checkbox: id="${id}"`);
                        }
                    }
                }
                await page.waitForTimeout(1500);
            } catch (err) {
                console.error("[DLRenewal] Error checking submission page checkboxes:", err);
            }

            // Interactive pause before final submission has been disabled to make all flows fully automated

            // Solve the captcha now that the input box has been enabled
            await smartSolveCaptcha(page, `Final Submission Attempt ${submitAttempts}`, 'DLRenewal');

            await page.getByRole('button', { name: 'Submit' }).first().click();

            console.log("[DLRenewal] Waiting for acknowledgment redirect...");
            try {
                await page.waitForURL('**/applNoRedirect.do', { timeout: 15000 });
                submissionSuccessful = true;
            } catch (_) {
                if (page.url().includes('applNoRedirect.do') ||
                    await page.locator('text=/Application No/i').first().isVisible().catch(() => false)) {
                    submissionSuccessful = true;
                } else {
                    console.log("[DLRenewal] Submission did not redirect. Retrying captcha...");
                    await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                    await page.waitForTimeout(1500);
                }
            }
        }

        page.off('dialog', submitDialogHandler);

        if (!submissionSuccessful) {
            throw new Error("DL Renewal submission failed after multiple captcha attempts.");
        }

        // ── Extract Application Details ─────────────────────────────────────────
        console.log("🎉 [DLRenewal] Successfully submitted! Extracting acknowledgment details...");
        const bodyText = await page.innerText('body').catch(() => '');
        const appNoMatch = bodyText.match(/Application No\s*:\s*(\d+)/i);
        const nameMatch  = bodyText.match(/Name\s*:\s*([A-Za-z\s]+)/i);
        const appNo = appNoMatch ? appNoMatch[1] : 'Unknown';
        const name  = nameMatch  ? nameMatch[1].trim() : 'Unknown';
        console.log(`[DLRenewal] Extracted: Application No: ${appNo}, Name: ${name}`);

        // ── Capture Acknowledgment Slip Screenshot (Targeting specific panel) ───
        if (!fs.existsSync(CONFIG.TEMP.DIR)) {
            fs.mkdirSync(CONFIG.TEMP.DIR, { recursive: true });
        }
        const screenshotPath = path.join(CONFIG.TEMP.DIR, `DLRenewal_Ack_${Date.now()}.png`);
        console.log(`[DLRenewal] Saving acknowledgment slip screenshot to: ${screenshotPath}`);
        
        let screenshotTaken = false;
        try {
            // Target the specific white bordered acknowledgment panel
            const panelLocator = page.locator('.panel-body.NALOC').first();
            if (await panelLocator.isVisible()) {
                console.log("[DLRenewal] Found .panel-body.NALOC element, taking targeted screenshot...");
                await panelLocator.screenshot({ path: screenshotPath });
                screenshotTaken = true;
            } else {
                const fallbackLocator = page.locator('.panel-body').first();
                if (await fallbackLocator.isVisible()) {
                    console.log("[DLRenewal] Found .panel-body element, taking targeted screenshot...");
                    await fallbackLocator.screenshot({ path: screenshotPath });
                    screenshotTaken = true;
                }
            }
        } catch (err) {
            console.error("[DLRenewal] Element-specific screenshot failed:", err);
        }

        if (!screenshotTaken) {
            console.log("[DLRenewal] Falling back to full-page screenshot...");
            await page.screenshot({ path: screenshotPath, fullPage: true }).catch(err => {
                console.error("[DLRenewal] Failed to take fallback acknowledgment screenshot:", err);
            });
        }

        return fs.existsSync(screenshotPath) ? screenshotPath : `Application No: ${appNo}, Name: ${name}`;

    } catch (error) {
        console.error("❌ Error in submitDLRenewalOTP:", error);
        throw error;
    } finally {
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        } else {
            console.log("⚠️ Headless mode is disabled; keeping browser open for inspection.");
        }
    }
}

module.exports = {
    startDLRenewalFlow,
    submitDLRenewalOTP
};
