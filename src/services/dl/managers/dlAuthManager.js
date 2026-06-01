const { navigateToSarathiHome, smartSolveCaptcha } = require('../../sarathiCommon');

async function loginAndFetchDetails(page, dlNo, dob) {
    await navigateToSarathiHome(page, 'MH');

    console.log("[DLAuth] Clicking DL Services link...");
    await page.getByRole('link', { name: 'Apply for Driving Licence Apply for DL Renewal' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    let otpTriggered = false;
    let attempts = 0;

    while (!otpTriggered && attempts < 5) {
        attempts++;
        console.log(`[DLAuth] Attempt ${attempts}: Entering DL and DOB...`);

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

        await smartSolveCaptcha(page, `Initial Login Attempt ${attempts}`, 'DLAuth');
        await page.locator('#PrivacyPolicyTermsofService').check().catch(() => {});
        
        const getDetailsBtn = page.getByRole('button', { name: 'Get DL Details' });
        await getDetailsBtn.click();
        
        console.log("[DLAuth] Waiting for DL details or error...");
        try {
            await Promise.race([
                page.locator('#dispDLDet').waitFor({ state: 'visible', timeout: 10000 }),
                page.locator('.errorMessage').first().waitFor({ state: 'visible', timeout: 10000 })
            ]);

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
                throw e; 
            }
            console.log("[DLAuth] Failed to load DL Details, refreshing captcha...");
            await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
            await page.waitForTimeout(1000);
        }
    }

    if (!otpTriggered) {
        throw new Error("Failed to pass initial DL login screen. Check DL number or DOB.");
    }
}

async function generateAadhaarOTP(page) {
    console.log("[DLAuth] Generating OTP...");
    let otpSent = false;
    let attempts = 0;

    while (!otpSent && attempts < 5) {
        attempts++;
        await smartSolveCaptcha(page, `OTP Request Attempt ${attempts}`, 'DLAuth');
        await page.getByRole('button', { name: 'Generate OTP' }).click();
        await page.waitForTimeout(2000);

        if (await page.locator('#otpNumberSarathi').isVisible()) {
            otpSent = true;
        } else {
            console.log("[DLAuth] Failed to generate OTP, retrying...");
            await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
            await page.waitForTimeout(1000);
        }
    }

    if (!otpSent) {
        throw new Error("Failed to trigger SMS OTP.");
    }
}

module.exports = {
    loginAndFetchDetails,
    generateAadhaarOTP
};
