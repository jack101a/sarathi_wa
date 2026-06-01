async function handleForm1Popup(context, page) {
    console.log("[DLForm1] Checking for Form 1 / Medical Declaration...");
    const form1Btn = page.getByRole('button', { name: 'Self Declaration (Form1)' });

    // Try waiting a bit for it to become visible
    try {
        await form1Btn.waitFor({ state: 'visible', timeout: 5000 });
    } catch (_) {}

    if (await form1Btn.isVisible()) {
        console.log("[DLForm1] Found Form 1 button. Interacting...");
        const [popupPage] = await Promise.all([
            context.waitForEvent('page', { timeout: 15000 }),
            form1Btn.click()
        ]);
        
        await popupPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        console.log("[DLForm1] Form 1 popup loaded. Filling checkboxes...");
        
        // Fill out Form 1
        await popupPage.locator('#medicalyesno1_1').check().catch(() => {});
        await popupPage.locator('#medicalyesno2_0').check().catch(() => {});
        await popupPage.locator('#medicalyesno3_1').check().catch(() => {});
        await popupPage.locator('#medicalyesno4_1').check().catch(() => {});
        await popupPage.locator('#medicalyesno5_1').check().catch(() => {});
        await popupPage.locator('#medicalyesno6_1').check().catch(() => {});
        await popupPage.locator('#checkMedicaldec').check().catch(() => {});
        await popupPage.waitForTimeout(500);
        
        console.log("[DLForm1] Submitting Form 1...");
        await popupPage.getByRole('button', { name: 'Submit' }).click().catch(() => {});
        
        // Wait on MAIN page context, NOT the volatile popup context
        await page.waitForTimeout(1000); 

        // Handle the "Are you sure to submit" alert inside popup if it triggers
        try {
            if (!popupPage.isClosed()) {
                const okayBtn = popupPage.getByRole('button', { name: 'Okay' }).first();
                await okayBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                if (await okayBtn.isVisible()) {
                    await okayBtn.click().catch(() => {});
                }
            }
        } catch(e) {}
        
        await page.waitForTimeout(1000); 
        
        try {
            // DOM-Aware check: only attempt close if the portal hasn't done it automatically
            if (!popupPage.isClosed()) {
                await popupPage.close();
            }
        } catch (err) {
            console.log("[DLForm1] Popup already closed safely:", err.message);
        }
        console.log("[DLForm1] Form 1 popup completed.");
    } else {
        console.log("[DLForm1] ℹ️ Smart Skip: Form 1 button not present or not required.");
    }
}

module.exports = {
    handleForm1Popup
};
