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

        console.log("[DLRenewal] Entering DL Number & DOB...");
        await page.getByRole('textbox', { name: 'DL number' }).fill(dlNo);
        await page.getByRole('textbox', { name: 'DD-MM-YYYY' }).fill(dob);

        let otpTriggered = false;
        let attempts = 0;

        while (!otpTriggered && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Initial Login Attempt ${attempts}`, 'DLRenewal');
            await page.locator('#PrivacyPolicyTermsofService').check().catch(() => {});
            
            const getDetailsBtn = page.getByRole('button', { name: 'Get DL Details' });
            await getDetailsBtn.click();
            await page.waitForTimeout(2000);

            if (await page.locator('#dispDLDet').isVisible()) {
                otpTriggered = true;
            } else {
                console.log("[DLRenewal] Failed to load DL Details, refreshing captcha...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!otpTriggered) {
            throw new Error("Failed to pass initial DL login screen. Check DL number or DOB.");
        }

        console.log("[DLRenewal] Setting display details to YES and selecting RTO...");
        await page.locator('#dispDLDet').selectOption('YES');
        
        // Handle selecting RTO. If RTO Code is passed, select it, otherwise fall back to matching option
        const rtoSelect = page.locator('#rtoCodeDLTr');
        if (rtoCode) {
            const options = await rtoSelect.locator('option').evaluateAll(opts => opts.map(o => ({ value: o.value, text: o.textContent })));
            const match = options.find(o => o.text.toLowerCase().includes(rtoCode.toLowerCase()) || o.value.includes(rtoCode));
            if (match) {
                await rtoSelect.selectOption(match.value);
            } else {
                await rtoSelect.selectOption({ index: 1 }); // Default fallback to first valid option
            }
        } else {
            await rtoSelect.selectOption({ index: 1 });
        }

        await page.getByRole('button', { name: 'Proceed' }).click();

        page.once('dialog', dialog => {
            console.log(`[DLRenewal] Dialog: ${dialog.message()}`);
            dialog.dismiss().catch(() => {});
        });
        await page.getByRole('button', { name: 'Confirm' }).click();

        await page.locator('#aadhaarHoldingType0').check().catch(() => {});
        await page.getByRole('button', { name: 'Submit' }).click();

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

        // Return context, page, and browser to pause
        return { browser, context, page };

    } catch (error) {
        console.error("❌ Error in startDLRenewalFlow:", error);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        throw error;
    }
}

async function submitDLRenewalOTP(browser, context, page, otpCode) {
    console.log("[DLRenewal] Submitting OTP...");
    try {
        await page.locator('#otpNumberSarathi').fill(otpCode);
        await smartSolveCaptcha(page, "OTP Submission", 'DLRenewal');
        await page.locator('#otpCheckbox').check().catch(() => {});
        await page.getByRole('button', { name: 'Submit OTP' }).click();
        await page.waitForTimeout(3000);

        console.log("[DLRenewal] Confirming transactions...");
        await page.locator('div:nth-child(3) > div:nth-child(2) > #trsaction_dlc').check().catch(() => {});
        await page.getByRole('button', { name: 'Proceed' }).click();
        await page.waitForTimeout(2000);

        await page.locator('#addcovdet').check().catch(() => {});
        await page.getByRole('button', { name: 'Confirm' }).click();
        await page.waitForTimeout(3000);

        // --- Handle Self-Declaration Form 1 Popup ---
        console.log("[DLRenewal] Clicking Self-Declaration Form...");
        const page1Promise = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'Click here for Self-' }).click();
        const page1 = await page1Promise;

        console.log("[DLRenewal] Answering Form 1 questionnaire in popup...");
        await page1.waitForLoadState('domcontentloaded');
        await page1.getByText('NO').first().click().catch(() => {});
        await page1.locator('#scopeaN').check().catch(() => {});
        await page1.locator('#scopebY').check().catch(() => {});
        await page1.locator('#scopecN').check().catch(() => {});
        await page1.locator('#scopeeN').check().catch(() => {});
        await page1.locator('#scopefN').check().catch(() => {});
        await page1.locator('#scopegN').check().catch(() => {});
        await page1.locator('#declaringcheck').check().catch(() => {});

        page1.once('dialog', dialog => {
            console.log(`[DLRenewal - Form 1] Dialog: ${dialog.message()}`);
            dialog.accept().catch(() => {});
        });
        await page1.getByRole('button', { name: 'Submit' }).click();
        await page1.getByRole('button', { name: 'Okay' }).click().catch(() => {});
        await page1.close().catch(() => {});

        console.log("[DLRenewal] Back to main page. Checking final declarations...");
        await page.locator('#Declaration1').check().catch(() => {});
        await page.locator('#Declaration2').check().catch(() => {});
        await page.locator('#Declaration3').check().catch(() => {});
        await page.locator('#disclaimer').check().catch(() => {});

        await smartSolveCaptcha(page, "Final Submit", 'DLRenewal');
        
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
        
        page.once('dialog', dialog => {
            console.log(`[DLRenewal - Final] Dialog: ${dialog.message()}`);
            dialog.accept().catch(() => {});
        });
        await page.getByRole('button', { name: 'Submit' }).click();
        await page.waitForTimeout(5000);

        let outputPath = path.join(process.cwd(), `DL_Renewal_${Date.now()}.pdf`);
        const download = await downloadPromise;
        if (download) {
            await download.saveAs(outputPath);
            console.log(`🎉 [DLRenewal] Application reference slip saved to: ${outputPath}`);
            return outputPath;
        } else {
            // Save a screenshot instead
            const screenshotPath = path.join(process.cwd(), `DL_Renewal_Success_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`🎉 [DLRenewal] Saved confirmation screenshot: ${screenshotPath}`);
            return screenshotPath;
        }

    } catch (error) {
        console.error("❌ Error in submitDLRenewalOTP:", error);
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

module.exports = {
    startDLRenewalFlow,
    submitDLRenewalOTP
};
