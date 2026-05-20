const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha, BASE_URL } = require('./sarathiCommon');

async function startSlotBookingFlow(appNo, dob) {
    console.log(`🚀 [SlotBooking] Starting flow for App No: ${appNo}, DOB: ${dob}`);

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

        console.log("[SlotBooking] Navigating to DL Test Slot Booking...");
        await page.getByRole('link', { name: 'Appointments', exact: true }).click();
        await page.getByRole('link', { name: 'DL Test Slot Booking' }).click();

        await page.getByRole('radio', { name: 'Application Number' }).check();
        await page.getByRole('textbox', { name: 'Application Number' }).fill(appNo);
        await page.getByRole('textbox', { name: 'Date Of Birth' }).fill(dob);

        let loggedIn = false;
        let attempts = 0;

        while (!loggedIn && attempts < 5) {
            attempts++;
            await smartSolveCaptcha(page, `Appointment Login Attempt ${attempts}`, 'SlotBooking');
            await page.getByRole('button', { name: 'SUBMIT' }).click();
            await page.waitForTimeout(3000);

            // Check if we reached the COV selection page
            if (await page.locator('[id="1"]').isVisible().catch(() => false) || await page.locator('[id="2"]').isVisible().catch(() => false)) {
                loggedIn = true;
            } else {
                console.log("[SlotBooking] Login captcha failed, retrying...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!loggedIn) {
            throw new Error("Failed to pass slot booking login. Check Application Number or DOB.");
        }

        console.log("[SlotBooking] Selecting all class of vehicles...");
        await page.locator('[id="1"]').check().catch(() => {});
        await page.locator('[id="2"]').check().catch(() => {});
        await page.getByRole('button', { name: 'PROCEED TO BOOK' }).click();
        await page.waitForTimeout(4000);

        console.log("[SlotBooking] Capturing calendar slots screenshot...");
        const calendarScreenshotPath = path.join(process.cwd(), `Calendar_${appNo}.png`);
        await page.screenshot({ path: calendarScreenshotPath, fullPage: true });

        return { browser, context, page, calendarScreenshotPath };

    } catch (error) {
        console.error("❌ Error in startSlotBookingFlow:", error);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        throw error;
    }
}

async function bookPreferredSlot(context, page, dateString, timeString) {
    console.log(`[SlotBooking] Booking slot: ${dateString || 'Auto-first-available'}`);
    try {
        if (dateString) {
            // Find specific date cell or link (e.g. "29")
            const linkLoc = page.getByRole('link', { name: dateString, exact: true });
            const cellLoc = page.getByRole('cell', { name: dateString });
            
            if (await linkLoc.isVisible()) {
                await linkLoc.click();
            } else if (await cellLoc.isVisible()) {
                await cellLoc.click();
            } else {
                console.log(`[SlotBooking] Warning: date ${dateString} not found, clicking first available green date.`);
                await page.locator("td.available, td a, a.green, a.blue").first().click().catch(() => {});
            }
        } else {
            // Click first green/available link on calendar
            console.log("[SlotBooking] Auto-selecting first available green calendar date...");
            const greenDay = page.locator("a[style*='color:green'], a[style*='color: green'], td a").first();
            await greenDay.click();
        }
        await page.waitForTimeout(2000);

        console.log("[SlotBooking] Selecting slot time radio button...");
        // Check slot radio button
        const slotRadio = page.locator("input[type='radio']").first();
        await slotRadio.waitFor({ state: 'visible', timeout: 10000 });
        await slotRadio.check();

        console.log("[SlotBooking] Clicking Book Slot...");
        await page.getByRole('button', { name: 'BOOK SLOT' }).click();
        await page.waitForTimeout(3000);

    } catch (error) {
        console.error("❌ Error in bookPreferredSlot:", error);
        throw error;
    }
}

async function confirmSlotBookingOTP(browser, context, page, otpCode) {
    console.log("[SlotBooking] Confirming Slot Booking OTP...");
    try {
        await page.locator('#smsCode').fill(otpCode);
        await page.getByRole('button', { name: 'CONFIRM TO SLOTBOOK' }).click();
        await page.waitForTimeout(3000);

        console.log("[SlotBooking] Downloading Slot Confirmation PDF...");
        const page1Promise = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'PRINT' }).click();
        const page1 = await page1Promise;
        
        await page1.waitForLoadState('domcontentloaded');
        const printBtn = page1.locator('button:has-text("Print"), input[value="Print"]').first();
        
        let outputPath = path.join(process.cwd(), `Slot_Confirmation_${Date.now()}.pdf`);
        const downloadPromise = page1.waitForEvent('download', { timeout: 15000 }).catch(() => null);

        if (await printBtn.isVisible().catch(() => false)) {
            await printBtn.click().catch(() => {});
        } else {
            // Try inside any frame
            const frames = page1.frames();
            for (const frame of frames) {
                const btn = frame.locator('button:has-text("Print"), input[value="Print"]').first();
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click().catch(() => {});
                    break;
                }
            }
        }

        const download = await downloadPromise;
        if (download) {
            await download.saveAs(outputPath);
            console.log(`🎉 [SlotBooking] Saved PDF slot confirmation to: ${outputPath}`);
            await page1.close().catch(() => {});
            return outputPath;
        } else {
            const screenshotPath = path.join(process.cwd(), `Slot_Success_${Date.now()}.png`);
            await page1.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`🎉 [SlotBooking] Saved slot confirmation screenshot: ${screenshotPath}`);
            await page1.close().catch(() => {});
            return screenshotPath;
        }

    } catch (error) {
        console.error("❌ Error in confirmSlotBookingOTP:", error);
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

module.exports = {
    startSlotBookingFlow,
    bookPreferredSlot,
    confirmSlotBookingOTP
};
