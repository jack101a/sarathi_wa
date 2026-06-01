async function handleReasonSelection(page, serviceType) {
    if (serviceType === 'REPLACEMENT OF DL') {
        return await fillReason(page, 'REPLACEMENT OF DL', '#replreasoncd, #replacementreasoncd', '#replreasondesc, #replacementreasondesc', '#replconfirm, #replacementconfirm');
    }
    if (serviceType === 'ISSUE OF DUPLICATE DL') {
        return await fillReason(page, 'ISSUE OF DUPLICATE DL', '#dupreasoncd', '#dupreasondesc', '#dupconfirm');
    }
    if (serviceType === 'DL EXTRACT') {
        return await fillReason(page, 'DL EXTRACT', '#dlextractreasoncd', null, '#dlextconfirm');
    }
    // Other services (like RENEWAL OF DL) do not require a reason selection page
}

async function fillReason(page, logName, selectLocator, descLocator, confirmLocator) {
    console.log(`[DLReason] ${logName} flow: checking for Reason Selection...`);
    try {
        const reasonSelect = page.locator(selectLocator);
        // Smart wait: don't crash if it never appears, just catch the timeout
        await reasonSelect.waitFor({ state: 'visible', timeout: 5000 });
        
        if (await reasonSelect.isVisible()) {
            console.log(`[DLReason] Selecting 'Miscellaneous' or index 1 as reason...`);
            
            // Try Miscellaneous first, fallback to index 1
            const options = await reasonSelect.locator('option').evaluateAll(opts => opts.map(o => o.text));
            const hasMisc = options.some(o => o.toLowerCase().includes('misc'));
            if (hasMisc) {
                await reasonSelect.selectOption({ label: 'Miscellaneous' }).catch(() => reasonSelect.selectOption({ index: 1 }));
            } else {
                await reasonSelect.selectOption({ index: 1 });
            }
            await page.waitForTimeout(1000);
            
            if (descLocator) {
                const descTextarea = page.locator(descLocator);
                if (await descTextarea.isVisible()) {
                    console.log(`[DLReason] Entering description...`);
                    await descTextarea.fill('misc reason');
                    await page.waitForTimeout(1000);
                }
            }

            console.log(`[DLReason] Clicking Confirm on Reason selection...`);
            const confirmBtn = page.locator(confirmLocator);
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
                await page.waitForTimeout(2000);
            }

            // Click the main Submit button at the bottom of the page if it exists
            const mainSubmitBtn = page.locator('input[type="submit"][value="Submit"], button[type="submit"]', { hasText: 'Submit' }).first();
            if (await mainSubmitBtn.isVisible()) {
                await mainSubmitBtn.click();
                await page.waitForTimeout(3000);
            }
        }
    } catch (err) {
        console.log(`[DLReason] ℹ️ Smart Skip: ${logName} reason selection flow elements not found or timed out.`);
    }
}

module.exports = {
    handleReasonSelection
};
