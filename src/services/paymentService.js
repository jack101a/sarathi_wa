const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { smartSolveCaptcha } = require('./sarathiCommon');

const BASE_URL = "https://sarathi.parivahan.gov.in/paymentscov";

async function startPaymentFlow(appNo, dob) {
    console.log(`🚀 [Payment] Starting flow for Application No: ${appNo}, DOB: ${dob}`);

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
        await page.goto(`${BASE_URL}/`);
        await page.getByRole('button', { name: 'Proceed' }).click();

        await page.locator('#applNo').fill(appNo);
        await page.getByRole('textbox', { name: 'DD-MM-YYYY' }).fill(dob);

        console.log("[Payment] Calculating fee...");
        await page.getByRole('button', { name: ' Click Here To Calculate Fee' }).click();
        await page.waitForTimeout(2000);

        console.log("[Payment] Selecting Common PGI bank list...");
        await page.locator('#bankslist').selectOption('commonPGI');

        let detailsCalculated = false;
        let attempts = 0;

        while (!detailsCalculated && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Calculate Fee Attempt ${attempts}`, 'Payment');
            await page.getByRole('button', { name: 'Proceed' }).click();
            await page.waitForTimeout(2000);

            if (await page.locator('#chkTermsandCond').isVisible().catch(() => false)) {
                detailsCalculated = true;
            } else {
                console.log("[Payment] Retrying fee calculation captcha...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!detailsCalculated) {
            throw new Error("Failed to load fee calculation details. Please check the Application Number.");
        }

        console.log("[Payment] Proceeding to payment gateway...");
        await page.locator('#chkTermsandCond').check();
        await page.getByRole('button', { name: 'Pay Now' }).click();
        await page.waitForTimeout(3000);

        console.log("[Payment] Selecting Operator SBIe on gateway...");
        // Handle Vahan redirect or operator page
        await page.locator('#dropOperator').selectOption('SBIe');
        await page.locator('#checkme').check();
        await page.getByRole('button', { name: 'Submit' }).click();
        await page.waitForTimeout(3000);

        console.log("[Payment] Selecting UPI QR Payment option...");
        await page.getByRole('link', { name: 'hUPI UPI' }).click();
        await page.getByRole('radio', { name: 'UPI QR' }).check();
        await page.getByRole('button', { name: 'Pay Now' }).click();
        await page.waitForTimeout(3000);

        console.log("[Payment] Capturing UPI QR code screenshot...");
        const qrImageElement = page.getByRole('img').nth(1);
        await qrImageElement.waitFor({ state: 'visible', timeout: 15000 });
        
        const qrImagePath = path.join(process.cwd(), `UPI_QR_${appNo}.png`);
        await qrImageElement.screenshot({ path: qrImagePath });
        console.log(`[Payment] Saved QR image to: ${qrImagePath}`);

        return { browser, context, page, qrImagePath };

    } catch (error) {
        console.error("❌ Error in startPaymentFlow:", error);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        throw error;
    }
}

async function confirmPayment(browser, context, page, appNo) {
    console.log("[Payment] Confirming payment and waiting for redirect...");
    try {
        // Wait up to 3 minutes for page to redirect from the payment gateway back to Sarathi CommonPGI
        await page.waitForURL(/CommonPGI\.jsp/i, { timeout: 180000 });
        console.log("[Payment] Successfully redirected! Clicking print receipt...");

        await page.getByRole('button', { name: 'Click Here for Print Receipt' }).click();
        await page.waitForTimeout(3000);

        let detailsRetrieved = false;
        let attempts = 0;

        while (!detailsRetrieved && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Print Receipt Login Attempt ${attempts}`, 'Payment');
            await page.getByRole('button', { name: 'GET DETAILS' }).click();
            await page.waitForTimeout(3000);

            if (await page.locator('#visitNo').isVisible().catch(() => false)) {
                detailsRetrieved = true;
            } else {
                console.log("[Payment] Retrying print receipt login captcha...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!detailsRetrieved) {
            throw new Error("Failed to get receipt details. Captcha issues or redirect failure.");
        }

        console.log("[Payment] Selecting receipt and printing...");
        await page.locator('#visitNo').check();
        
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
        
        let printSuccess = false;
        attempts = 0;

        while (!printSuccess && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Final Receipt Download Attempt ${attempts}`, 'Payment');
            await page.getByRole('button', { name: 'Print Receipt' }).click();
            await page.waitForTimeout(3000);

            // If download was triggered, break
            // (Playwright will handle download event in background)
            printSuccess = true;
        }

        const download = await downloadPromise.catch(() => null);
        let outputPath = path.join(process.cwd(), `Receipt_${appNo}.pdf`);

        if (download) {
            await download.saveAs(outputPath);
            console.log(`🎉 [Payment] PDF Receipt saved to: ${outputPath}`);
            return outputPath;
        } else {
            // Screen capture as backup
            const screenshotPath = path.join(process.cwd(), `Receipt_Success_${appNo}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`🎉 [Payment] Saved confirmation receipt screenshot: ${screenshotPath}`);
            return screenshotPath;
        }

    } catch (error) {
        console.error("❌ Error in confirmPayment:", error);
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

async function printExistingReceipt(appNo, dob) {
    console.log(`🚀 [Payment] Starting print receipt flow for Application No: ${appNo}, DOB: ${dob}`);

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
        console.log("[Payment] Navigating to paymentscov home...");
        await page.goto(`${BASE_URL}/`);

        console.log("[Payment] Clicking 'Proceed'...");
        await page.getByRole('button', { name: 'Proceed' }).click();
        await page.waitForTimeout(2000);

        console.log("[Payment] Clicking 'PRINT RECEIPT' link via DOM click...");
        await page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(el => {
                return (el.innerText || '').toLowerCase().includes('print receipt');
            });
            if (link) {
                link.click();
            } else {
                throw new Error("PRINT RECEIPT link not found in DOM");
            }
        });
        await page.waitForTimeout(3000);

        console.log("[Payment] Filling application details...");
        const applNoLocator = page.locator('#applno').or(page.locator('#applNo'));
        await applNoLocator.waitFor({ state: 'visible', timeout: 15000 });
        await applNoLocator.fill(appNo);

        const dobLocator = page.locator('#dob');
        await dobLocator.waitFor({ state: 'visible', timeout: 5000 });
        await dobLocator.fill(dob);
        await page.keyboard.press('Escape'); // Dismiss any datepicker popups intercepting pointer events
        await page.waitForTimeout(500);

        let detailsRetrieved = false;
        let attempts = 0;

        while (!detailsRetrieved && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Print Receipt Login Attempt ${attempts}`, 'Payment');
            await page.getByRole('button', { name: 'GET DETAILS' }).click();
            await page.waitForTimeout(3000);

            if (await page.locator('#visitNo').isVisible().catch(() => false)) {
                detailsRetrieved = true;
            } else {
                console.log("[Payment] Retrying print receipt login captcha...");
                const captchaImg = page.locator('#captchaImg').or(page.locator("img[src*='captchaimage.jsp']"));
                if (await page.locator('#abc').isVisible().catch(() => false)) {
                    await page.locator('#abc').click();
                } else if (await captchaImg.first().isVisible().catch(() => false)) {
                    await captchaImg.first().click();
                }
                await page.waitForTimeout(1000);
            }
        }

        if (!detailsRetrieved) {
            throw new Error("Failed to retrieve receipt details. Verify Application No & DOB, or retry.");
        }

        console.log("[Payment] Selecting receipt and printing...");
        await page.locator('#visitNo').check();

        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

        let printSuccess = false;
        attempts = 0;

        while (!printSuccess && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Final Receipt Download Attempt ${attempts}`, 'Payment');
            await page.getByRole('button', { name: 'Print Receipt' }).click();
            await page.waitForTimeout(3000);

            printSuccess = true;
        }

        const download = await downloadPromise.catch(() => null);
        let outputPath = path.join(process.cwd(), `Receipt_${appNo}.pdf`);

        if (download) {
            await download.saveAs(outputPath);
            console.log(`🎉 [Payment] PDF Receipt saved to: ${outputPath}`);
            return outputPath;
        } else {
            // Screen capture as backup
            const screenshotPath = path.join(process.cwd(), `Receipt_Success_${appNo}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`🎉 [Payment] Saved confirmation receipt screenshot: ${screenshotPath}`);
            return screenshotPath;
        }

    } catch (error) {
        console.error("❌ Error in printExistingReceipt:", error);
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

module.exports = {
    startPaymentFlow,
    confirmPayment,
    printExistingReceipt
};
