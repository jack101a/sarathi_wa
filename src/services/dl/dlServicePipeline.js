const dlAuthManager = require('./managers/dlAuthManager');
const dlServiceManager = require('./managers/dlServiceManager');
const dlReasonManager = require('./managers/dlReasonManager');
const dlAddressManager = require('./managers/dlAddressManager');
const dlForm1Manager = require('./managers/dlForm1Manager');
const dlSubmitManager = require('./managers/dlSubmitManager');
const { captureFailureDiagnostics } = require('../../utils/failureLogger');

async function runDLPipeline(dlNo, dob, rtoCode, mobile, serviceType, targetAppNo = null) {
    console.log(`[DLPipeline] Starting flow for ${serviceType} (DL: ${dlNo})`);
    
    let browser, context, page;
    try {
        // 1. Auth & Initial Navigation
        // Wait, dlAuthManager.js currently only has loginAndFetchDetails and generateAadhaarOTP.
        // Let's assume loginAndFetchDetails returns the browser context, wait, we need to launch the browser first!
        const { chromium } = require('playwright');
        const CONFIG = require('../../config/config');
        const headless = CONFIG.PUPPETEER?.HEADLESS === 'new' || CONFIG.PUPPETEER?.HEADLESS === true;
        
        browser = await chromium.launch({ headless: false }); // headless is set to false as per user request in testing phase
        context = await browser.newContext();
        page = await context.newPage();
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        // 1. Login to Sarathi
        await dlAuthManager.loginAndFetchDetails(page, dlNo, dob);
        
        // 2. Initial RTO and Blood group Injection & Proceed
        const rtoSelect = page.locator('#rtoCodeDLTr');
        if (await rtoSelect.isVisible().catch(() => false)) {
            const options = await rtoSelect.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.textContent })));
            const match = options.find(o => o.text.toLowerCase().includes(rtoCode.toLowerCase()) || o.value.includes(rtoCode));
            if (match) {
                console.log(`[DLPipeline] Selecting RTO: ${match.text}`);
                await rtoSelect.selectOption(match.value);
            } else {
                await rtoSelect.selectOption({ index: 1 }); 
            }
        }
        
        await page.evaluate(() => {
            const bgSelect = document.getElementById('bloodGroup');
            if (bgSelect) { bgSelect.value = 'U'; bgSelect.dispatchEvent(new Event('change')); }
            const catSelect = document.getElementById('applEmpCatg');
            if (catSelect) { catSelect.value = '0'; catSelect.dispatchEvent(new Event('change')); }
        }).catch(() => {});
        
        await page.getByRole('button', { name: 'Proceed' }).click();

        // 3. Address and Details Page (Confirm button)
        const confirmBtn = page.getByRole('button', { name: 'Confirm' }).first();
        try {
            await confirmBtn.waitFor({ state: 'visible', timeout: 15000 });
            await dlAddressManager.handleAddressAndDetails(page, targetAppNo, dob);
            await confirmBtn.click();
        } catch (e) {
            console.log("[DLPipeline] Confirm button not visible or timed out, skipping confirm step:", e.message);
        }

        // 4. Aadhaar / Generate OTP
        await page.waitForTimeout(3000);
        await page.locator('#aadhaarHoldingType0').check().catch(() => {});
        const authSubmitBtn = page.getByRole('button', { name: 'Submit' }).first();
        if (await authSubmitBtn.isVisible().catch(() => false)) {
            await authSubmitBtn.click();
        }
        await dlAuthManager.generateAadhaarOTP(page);

        // 5. Here the human types the OTP...
        console.log("=========================================");
        console.log("Waiting for user to enter OTP on screen...");
        console.log("Script paused. Please type OTP and click Submit OTP manually.");
        console.log("=========================================");
        
        // Wait until we reach the Service Selection page
        const firstServiceSelector = `input[type="checkbox"][name="dlc"]`;
        await page.locator(firstServiceSelector).first().waitFor({ state: 'visible', timeout: 300000 }); // Wait up to 5 minutes

        // 6. Service Selection
        await dlServiceManager.handleServiceSelection(page, serviceType);

        // 7. Reason Selection (if applicable)
        await dlReasonManager.handleReasonSelection(page, serviceType);

        // 8. Form 1 (Self Declaration)
        await dlForm1Manager.handleForm1Popup(context, page);

        // 9. Submit (Declarations, Captcha, Check)
        const result = await dlSubmitManager.submitFinalForm(page);

        return result;
    } catch (error) {
        console.error(`[DLPipeline] Fatal Error:`, error.message);
        if (page) {
            await captureFailureDiagnostics(page, error, { serviceType, dlNo }).catch(() => {});
        }
        throw error;
    } finally {
        if (browser) {
            console.log("[DLPipeline] Flow finished. Keeping browser open for test inspection.");
        }
    }
}

async function startDLRenewalFlow(dlNo, dob, rtoCode, mobile, serviceType = 'RENEWAL OF DL') {
    return await runDLPipeline(dlNo, dob, rtoCode, mobile, serviceType);
}

module.exports = {
    runDLPipeline,
    startDLRenewalFlow
};
