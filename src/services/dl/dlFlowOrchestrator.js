const { chromium } = require('playwright');
const CONFIG = require('../../config/config');
const { captureFailureDiagnostics } = require('../../utils/failureLogger');

const authManager = require('./managers/dlAuthManager');
const addressManager = require('./managers/dlAddressManager');
const serviceManager = require('./managers/dlServiceManager');
const reasonManager = require('./managers/dlReasonManager');
const form1Manager = require('./managers/dlForm1Manager');
const submitManager = require('./managers/dlSubmitManager');

async function startDLRenewalFlow(dlNo, dob, rtoCode, mobile, headless = true, serviceType = 'RENEWAL OF DL') {
    console.log(`🚀 [DLOrchestrator] Starting flow for DL: ${dlNo}, DOB: ${dob}, Service: ${serviceType}`);

    const actualHeadless = CONFIG.PUPPETEER?.HEADLESS === 'new' || CONFIG.PUPPETEER?.HEADLESS === true || headless;
    const browser = await chromium.launch({ headless: actualHeadless });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        acceptDownloads: true
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    let existingApplicationError = null;

    try {
        const dialogHandler = async dialog => {
            const msg = dialog.message();
            console.log(`💬 [DLOrchestrator Dialog] ${dialog.type()}: ${msg}`);
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
                    console.log(`[DLOrchestrator] Existing application dialog detected. Rejecting: "${formattedMessage}"`);
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

        // 1. Auth & Initial Details
        await authManager.loginAndFetchDetails(page, dlNo, dob);
        if (existingApplicationError) throw new Error(existingApplicationError);

        // 2. Select RTO
        await addressManager.selectRTO(page, rtoCode);
        
        // 3. Inject Dropdowns (Blood Group, Category)
        const injectionResult = await addressManager.injectDirectDropdowns(page);
        if (injectionResult.bgInjected || injectionResult.catInjected) {
            console.log(`[DLOrchestrator] Injected BG: ${injectionResult.bgInjected}, Cat: ${injectionResult.catInjected}`);
            await page.waitForTimeout(1000);
        }

        // Proceed to next section
        const proceedBtn = page.getByRole('button', { name: 'Proceed' });
        await proceedBtn.waitFor({ state: 'visible', timeout: 5000 });
        await proceedBtn.click();
        await page.waitForTimeout(2000);

        if (existingApplicationError) throw new Error(existingApplicationError);

        // 4. Fill Address Dropdowns safely
        await addressManager.fillAddressDropdowns(page);

        // Confirm
        const confBtn = page.getByRole('button', { name: 'Confirm' });
        await confBtn.waitFor({ state: 'visible', timeout: 5000 });
        await confBtn.click();
        await page.waitForTimeout(2000);

        // 5. Trigger Aadhaar OTP
        await authManager.generateAadhaarOTP(page);

        console.log(`[DLOrchestrator] Phase 1 completed successfully.`);
        return { browser, context, page };
    } catch (error) {
        console.error("❌ Error in startDLRenewalFlow:", error);
        await captureFailureDiagnostics(page, error, { serviceType, dlNo: 'startPhase' }).catch(() => {});
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        }
        throw error;
    }
}

async function submitDLRenewalOTP(browser, context, page, otpCode, serviceType = 'RENEWAL OF DL') {
    const headless = CONFIG.PUPPETEER?.HEADLESS === 'new' || CONFIG.PUPPETEER?.HEADLESS === true;
    console.log(`[DLOrchestrator] Starting submit OTP phase with OTP: ${otpCode} for ${serviceType}`);

    try {
        // Enter OTP
        const otpInput = page.locator('#otpNumberSarathi');
        await otpInput.fill('');
        await otpInput.pressSequentially(otpCode, { delay: 100 });
        
        const authBtn = page.getByRole('button', { name: 'Authenticate with Sarathi' });
        await authBtn.click();

        console.log("[DLOrchestrator] Waiting for authentication success...");
        await page.waitForFunction(() => {
            const el = document.querySelector('#leftpane');
            const err = document.querySelector('.errorMessage');
            return (el && el.offsetHeight > 0) || (err && err.offsetHeight > 0);
        }, { timeout: 15000 });

        const errEl = page.locator('.errorMessage').first();
        if (await errEl.isVisible().catch(() => false)) {
            const txt = await errEl.innerText();
            if (txt.includes('OTP')) throw new Error(`OTP Error: ${txt}`);
        }

        console.log("[DLOrchestrator] Checking checkboxes...");
        await serviceManager.checkServiceCheckboxes(page, serviceType);
        await serviceManager.cleanupLeftPane(page);
        await serviceManager.proceedFromServiceSelection(page);

        // Service Specific Reason Selection
        await reasonManager.handleReasonSelection(page, serviceType);

        // Form 1 Popup
        await form1Manager.handleForm1Popup(context, page);

        // Final Submission
        const { appNumber, screenshotPath } = await submitManager.submitFinalForm(page);
        
        return fs.existsSync(screenshotPath) ? screenshotPath : `Application No: ${appNumber}`;
    } catch (error) {
        console.error("❌ Error in submitDLRenewalOTP:", error);
        await captureFailureDiagnostics(page, error, { serviceType, dlNo: 'submitOTPPhase' }).catch(() => {});
        throw error;
    } finally {
        if (headless) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        }
    }
}

module.exports = {
    startDLRenewalFlow,
    submitDLRenewalOTP
};
