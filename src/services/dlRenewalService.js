const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha, BASE_URL } = require('./sarathiCommon');
const { captureFailureDiagnostics } = require('../utils/failureLogger');

// Helper to find option using prioritized keys
function findOptionBySearchKeys(options, searchKeys) {
    const validOptions = options.filter(o => o.value !== '-1' && o.value !== '' && o.text.toLowerCase() !== 'select');
    if (validOptions.length === 0) return null;

    for (const key of searchKeys) {
        if (!key) continue;
        const cleanKey = key.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
        if (!cleanKey) continue;

        const matches = validOptions.filter(opt => {
            const cleanOpt = opt.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
            if (!cleanOpt) return false;
            return cleanKey.includes(cleanOpt);
        });

        if (matches.length > 0) {
            // Prefer the longest (most specific) match
            matches.sort((a, b) => b.text.length - a.text.length);
            return matches[0];
        }
    }
    return null;
}

async function fillAddressDropdowns(page) {
    // Check if the address dropdowns are actually visible on the page
    const prmDistVisible = await page.locator('#prmDist').isVisible().catch(() => false);
    const prmMandalVisible = await page.locator('#prmMandal').isVisible().catch(() => false);
    if (!prmDistVisible && !prmMandalVisible) {
        console.log("[DLRenewal] Address dropdowns (#prmDist / #prmMandal) are not visible on this page. Skipping address dropdown filling.");
        const sameAs = page.locator('#sameasperm');
        if (await sameAs.count() > 0 && await sameAs.isVisible() && !(await sameAs.isChecked())) {
            await sameAs.check().catch(() => {});
        }
        return;
    }

    // 1. Extract read-only old address details from the page
    try {
        await page.waitForFunction(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            return inputs.some(input => !input.id && !input.name && input.value && input.value.trim().length > 0);
        }, { timeout: 10000 });
    } catch (err) {
        console.log("[DLRenewal] Warning: Timed out waiting for read-only address values to load.");
    }

    const oldAddressLines = await page.locator('input[type="text"]')
        .evaluateAll(inputs => inputs
            .filter(input => !input.id && !input.name && input.value && input.value.trim())
            .map(input => input.value.trim())
        );
    
    console.log("[DLRenewal] Extracted original address lines:", oldAddressLines);
    if (oldAddressLines.length === 0) {
        throw new Error("Govt Portal: Could not find original DL address elements to match.");
    }
    
    const addr1 = oldAddressLines[0] || '';
    const addr2 = oldAddressLines[1] || '';
    const addr3 = oldAddressLines[2] || '';
    const addr1And2 = `${addr1} ${addr2}`;

    let selectedDistrictText = '';

    const dropdowns = [
        { id: 'prmDist', label: 'District', waitMs: 2000, keys: [addr3] },
        { id: 'prmMandal', label: 'Taluka', waitMs: 2000, getKeys: () => [selectedDistrictText, addr3, addr1And2] }
    ];

    for (const step of dropdowns) {
        const { id, label, waitMs } = step;
        const sel = page.locator(`#${id}`);
        if (await sel.count() === 0 || !(await sel.isVisible())) continue;
        if (await sel.inputValue() !== '-1') {
            if (id === 'prmDist') {
                selectedDistrictText = await sel.locator('option:checked').textContent().catch(() => '');
            }
            continue;
        }

        // Wait for dropdown options to load dynamically
        try {
            await page.waitForFunction(elId => {
                const el = document.getElementById(elId);
                return el && Array.from(el.options).some(o => o.value !== '-1' && o.value !== '');
            }, id, { timeout: 5000 });
        } catch (_) {}

        const options = await sel.locator('option').evaluateAll(os =>
            os.map(o => ({ value: o.value, text: o.textContent }))
        );

        const validOptions = options.filter(o => o.value !== '-1' && o.value !== '' && o.text.toLowerCase() !== 'select');
        if (validOptions.length === 0) {
            console.log(`[DLRenewal] Dropdown for ${label} (#${id}) has no valid options. Skipping.`);
            continue;
        }

        const keys = step.keys || step.getKeys();
        const matchedOption = findOptionBySearchKeys(options, keys);

        if (!matchedOption) {
            throw new Error(`Govt Portal: Address verification failed. Could not determine matching option for ${label} in dropdown options: [${validOptions.map(o => o.text).join(", ")}]`);
        }

        console.log(`[DLRenewal] Selecting ${label}: "${matchedOption.text}" (value: ${matchedOption.value})`);
        await sel.selectOption(matchedOption.value);
        if (id === 'prmDist') {
            selectedDistrictText = matchedOption.text;
        }
        await page.waitForTimeout(waitMs);
    }

    // Check sameasperm checkbox
    const sameAs = page.locator('#sameasperm');
    if (await sameAs.count() > 0 && await sameAs.isVisible() && !(await sameAs.isChecked())) {
        await sameAs.check().catch(() => {});
    }
}

async function startDLRenewalFlow(dlNo, dob, rtoCode, mobile, serviceType = 'RENEWAL OF DL') {
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
        let existingApplicationError = null;

        const dialogHandler = async dialog => {
            const msg = dialog.message();
            lastDialogMessage = msg;
            console.log(`💬 [DLRenewal Dialog] ${dialog.type()}: ${msg}`);
            const msgLower = msg.toLowerCase();

            if (msgLower.includes('application already exists') || msgLower.includes('application already exist')) {
                if (serviceType !== 'DL EXTRACT') {
                    let formattedMessage = msg;
                    const detailsMatch = msg.match(/(?:existing Application\.|Application\.|exists)\s*-\s*(.+)/i);
                    if (detailsMatch) {
                        formattedMessage = `Application already exist - ${detailsMatch[1].trim()}`;
                    } else {
                        const numMatch = msg.match(/\d{8,}/);
                        if (numMatch) {
                            formattedMessage = `Application already exist - ${numMatch[0]}`;
                        } else {
                            formattedMessage = `Application already exist - ${msg}`;
                        }
                    }
                    existingApplicationError = formattedMessage;
                    console.log(`[DLRenewal] Existing application dialog detected. Service is ${serviceType} (not DL EXTRACT). Rejecting: "${formattedMessage}"`);
                    await dialog.dismiss().catch(() => {});
                    return;
                }
            }

            if (dialog.type() === 'confirm' || msgLower.includes('confirm') || msgLower.includes('sure') || msgLower.includes('submit') || msgLower.includes('want to') || msgLower.includes('correct') || msgLower.includes('proceed') || msgLower.includes('would you like to') || msgLower.includes('change')) {
                await dialog.accept().catch(() => {});
            } else {
                await dialog.dismiss().catch(() => {});
            }
        };
        page.on('dialog', dialogHandler);

        const checkExistingApplicationError = () => {
            if (existingApplicationError) {
                throw new Error(existingApplicationError);
            }
        };

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
            
            console.log("[DLRenewal] Waiting for DL details or error...");
            try {
                await Promise.race([
                    page.locator('#dispDLDet').waitFor({ state: 'visible', timeout: 10000 }),
                    page.locator('.errorMessage').first().waitFor({ state: 'visible', timeout: 10000 })
                ]);

                // Check if a portal error message is visible
                const errorEl = page.locator('.errorMessage').first();
                if (await errorEl.isVisible().catch(() => false)) {
                    const errorText = await errorEl.innerText().catch(() => '');
                    if (errorText) {
                        throw new Error(`Govt Portal: ${errorText.trim()}`);
                    }
                }

                otpTriggered = true;
            } catch (e) {
                if (e.message.startsWith('Govt Portal:')) {
                    throw e; // Propagate fatal portal error immediately
                }
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

        checkExistingApplicationError();

        // Inject early if present
        console.log("[DLRenewal] Injecting dropdown values early (pre-Proceed)...");
        await injectDirectDropdowns();

        checkExistingApplicationError();

        await page.getByRole('button', { name: 'Proceed' }).click();

        // Wait for Address/Details page (Confirm button)
        const confirmBtn = page.getByRole('button', { name: 'Confirm' }).first();
        try {
            await page.waitForTimeout(1000);
            checkExistingApplicationError();
            await confirmBtn.waitFor({ state: 'visible', timeout: 15000 });
            checkExistingApplicationError();
            await fillAddressDropdowns(page);
            checkExistingApplicationError();
            await injectDirectDropdowns();
            await confirmBtn.click();
        } catch (e) {
            checkExistingApplicationError();
            if (e.message.startsWith('Govt Portal:')) {
                throw e; // Propagate fatal address matching error
            }
            console.log("[DLRenewal] Confirm button not visible or timed out, skipping confirm step:", e.message);
        }

        // Wait for Aadhaar/Submit page
        await page.waitForTimeout(3000);
        await injectDirectDropdowns();
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
        const diag = await captureFailureDiagnostics(page, error, { serviceType: 'startDLRenewalFlow', dlNo }).catch(() => null);
        if (diag && diag.screenshotPath) {
            error.screenshotPath = diag.screenshotPath;
        }
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

        console.log(`[DLRenewal] Ensuring ONLY required DL service is selected: ${serviceType}...`);
        const allCheckboxes = await page.locator('input[type="checkbox"][name="dlc"]').all();
        let foundRequired = false;
        for (const cb of allCheckboxes) {
            const val = await cb.getAttribute('value').catch(() => '');
            if (val === serviceType) {
                foundRequired = true;
                const isChecked = await cb.isChecked().catch(() => false);
                if (!isChecked) {
                    await cb.check().catch(() => {});
                    console.log(`[DLRenewal] ✅ Checked required service: ${val}`);
                } else {
                    console.log(`[DLRenewal] ℹ️ Already checked: ${val}`);
                }
            } else if (val) {
                const isChecked = await cb.isChecked().catch(() => false);
                if (isChecked) {
                    await cb.uncheck().catch(() => {});
                    console.log(`[DLRenewal] ⚠️ Unchecked unintended service: ${val}`);
                }
            }
        }
        if (!foundRequired) {
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

        // Delete any unwanted services from the left pane (if portal forced them)
        console.log("[DLRenewal] Checking for unwanted services in the Data Entry pane...");
        try {
            const serviceItems = await page.locator('.menu-list + ul > li').all();
            for (const item of serviceItems) {
                const serviceNameEl = item.locator('span').first();
                if (await serviceNameEl.isVisible().catch(() => false)) {
                    const name = await serviceNameEl.innerText().catch(() => '');
                    if (name && name.trim().toUpperCase() !== serviceType.toUpperCase()) {
                        console.log(`[DLRenewal] ⚠️ Found unwanted service in pane: ${name}. Attempting to delete...`);
                        const delBtn = item.locator('img[src*="dltransdelete.png"]').first();
                        if (await delBtn.isVisible().catch(() => false)) {
                            page.once('dialog', async dialog => {
                                console.log(`[DLRenewal - Delete Dialog] ${dialog.message()}`);
                                await dialog.accept().catch(() => {});
                            });
                            await delBtn.click().catch(() => {});
                            await page.waitForTimeout(2000); // Wait for page refresh
                        }
                    }
                }
            }
        } catch (err) {
            console.log("[DLRenewal] Error checking/deleting left pane services:", err.message);
        }

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
            const okayBtn = popupPage.getByRole('button', { name: 'Okay' }).first();
            await okayBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            await okayBtn.click().catch(() => {});
            await popupPage.waitForTimeout(1500);
            await popupPage.close().catch(() => {});
            console.log("[DLRenewal] Form 1 popup completed.");
            await page.waitForTimeout(2000);
        }

        // ── Final Submission with CAPTCHA ───────────────────────────────────────
        const submitDialogHandler = async dialog => {
            const msg = dialog.message().toLowerCase();
            console.log(`[DLRenewal - Submit Dialog] ${dialog.type()}: ${dialog.message()}`);
            
            // Accept standard confirmations for saving data or smart card printing
            if (dialog.type() === 'confirm' || msg.includes('sure') || msg.includes('save') || msg.includes('printed') || msg.includes('submit')) {
                await dialog.accept().catch(() => {});
            } else if (msg.includes('address') || msg.includes('change')) {
                await dialog.dismiss().catch(() => {});
            } else {
                await dialog.accept().catch(() => {});
            }
        };
        page.on('dialog', submitDialogHandler);

        let submissionSuccessful = false;
        let submitAttempts = 0;

        while (!submissionSuccessful && submitAttempts < 5) {
            submitAttempts++;
            console.log(`[DLRenewal] Final submission attempt ${submitAttempts}...`);

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
                                console.log(`[DLRenewal] Skipping dangerous checkbox: id="${id}" (Change of Address)`);
                                continue;
                            }
                            if (!isChecked) {
                                console.log(`[DLRenewal] Clicking unchecked checkbox: id="${id}", name="${name}"`);
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
                console.error("[DLRenewal] Error checking submission page checkboxes:", err);
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
                console.error("[DLRenewal] Error in DOM force-enable fail-safe:", err);
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
                    await page.locator("#capimgatsubmit, #capimg, img[src*='captchaimage.jsp']").first().click().catch(() => {});
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
        await captureFailureDiagnostics(page, error, { serviceType, dlNo: 'submitOTPPhase' }).catch(() => {});
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
