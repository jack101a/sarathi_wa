const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha, BASE_URL } = require('./sarathiCommon');

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

        console.log("[ApplyDL] Entering Learning Licence number & DOB...");
        await page.locator('#learningLicence').fill(llNo);
        await page.locator('#DOB').fill(dob);

        let detailsLoaded = false;
        let attempts = 0;

        while (!detailsLoaded && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Initial LL Login Attempt ${attempts}`, 'ApplyDL');
            await page.getByRole('button', { name: 'OK' }).click();
            await page.waitForTimeout(2000);

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

        console.log("[ApplyDL] Generating OTP...");
        let otpSent = false;
        attempts = 0;

        while (!otpSent && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `OTP Generation Attempt ${attempts}`, 'ApplyDL');
            await page.getByRole('button', { name: 'Generate OTP' }).click();
            await page.waitForTimeout(2000);

            if (await page.locator('#otpNumberSarathi').isVisible()) {
                otpSent = true;
            } else {
                console.log("[ApplyDL] Failed to generate OTP, retrying...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!otpSent) {
            throw new Error("Failed to trigger SMS OTP for DL application.");
        }

        return { browser, context, page };

    } catch (error) {
        console.error("❌ Error in startApplyDLFlow:", error);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
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
        await page1.close().catch(() => {});

        console.log("[ApplyDL] Back to main page. Submitting form...");
        await page.waitForTimeout(2000);

        let submissionSuccessful = false;
        let submitAttempts = 0;

        while (!submissionSuccessful && submitAttempts < 5) {
            submitAttempts++;
            await smartSolveCaptcha(page, `Final Submission Attempt ${submitAttempts}`, 'ApplyDL');
            
            page.once('dialog', dialog => {
                console.log(`[ApplyDL - Submit] Dialog: ${dialog.message()}`);
                dialog.accept().catch(() => {});
            });

            await page.getByRole('button', { name: 'Submit' }).click();
            await page.waitForTimeout(5000);

            // Check if we are redirected or if application number is visible
            if (page.url().includes('applNoRedirect.do') || await page.locator('text=/Application No/i').first().isVisible().catch(() => false)) {
                submissionSuccessful = true;
            } else {
                console.log("[ApplyDL] Captcha mismatch or validation failed on submit, retrying...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1500);
            }
        }

        if (!submissionSuccessful) {
            throw new Error("Application submission failed due to persistent captcha issues or portal timeouts.");
        }

        console.log("[ApplyDL] Successfully submitted! Extracting details...");
        const slipTextLocator = page.locator('text=/Application No :|Application Reference Slip/i').first();
        let extractedText = "Submitted successfully. Page redirected.";

        if (await slipTextLocator.isVisible()) {
            const bodyText = await page.innerText('body');
            const match = bodyText.match(/Application No\s*:\s*(\d+)/i);
            const nameMatch = bodyText.match(/Name\s*:\s*([A-Za-z\s]+)/i);
            
            const appNo = match ? match[1] : "Unknown";
            const name = nameMatch ? nameMatch[1].trim() : "Unknown";
            extractedText = `Application No: ${appNo}, Name: ${name}`;
            console.log(`🎉 [ApplyDL] Extracted: ${extractedText}`);
        }

        return {
            success: true,
            extractedText
        };

    } catch (error) {
        console.error("❌ Error in submitApplyDLOTP:", error);
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

module.exports = {
    startApplyDLFlow,
    submitApplyDLOTP
};
