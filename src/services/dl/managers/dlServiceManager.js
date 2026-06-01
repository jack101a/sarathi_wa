async function checkServiceCheckboxes(page, targetServiceType) {
    console.log(`[DLService] Selecting required service: ${targetServiceType}`);
    
    // Wait for the checkboxes container to appear
    await page.locator('#leftpane').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);

    const dlcCheckboxes = page.locator('input[type="checkbox"][name="dlc"]');
    const count = await dlcCheckboxes.count();
    let serviceFound = false;

    for (let i = 0; i < count; i++) {
        const checkbox = dlcCheckboxes.nth(i);
        const value = await checkbox.getAttribute('value');
        const text = await checkbox.evaluate(el => el.parentElement.textContent.trim());

        if (text === targetServiceType) {
            console.log(`[DLService] Found exact match: ${text}`);
            if (!(await checkbox.isChecked())) {
                await checkbox.check();
                await page.waitForTimeout(500);
            }
            serviceFound = true;
        } else if (text !== 'CHANGE OF ADDRESS IN DL') {
            // Uncheck other extraneous services if possible
            if (await checkbox.isChecked()) {
                console.log(`[DLService] Unchecking extra service: ${text}`);
                await checkbox.uncheck().catch(() => {});
                await page.waitForTimeout(200);
            }
        }
    }

    if (!serviceFound) {
        throw new Error(`Govt Portal: Required service "${targetServiceType}" is not available for this DL.`);
    }

    // Uncheck "Add or Delete COA" if present
    const addOrDelcoa = page.locator('#addOrDelcoa');
    if (await addOrDelcoa.count() > 0 && await addOrDelcoa.isVisible()) {
        if (await addOrDelcoa.isChecked()) {
            await addOrDelcoa.uncheck().catch(() => {});
        }
    }
}

async function cleanupLeftPane(page) {
    // Sometimes the portal forces extra services on the left pane. Let's delete them.
    const leftPaneDeletes = page.locator('#leftpane i.fa-trash, #leftpane button[title*="Delete"]');
    let deleteCount = await leftPaneDeletes.count();
    if (deleteCount > 0) {
        console.log(`[DLService] Cleaning up ${deleteCount} forced services from left pane...`);
        for (let i = deleteCount - 1; i >= 0; i--) {
            try {
                await leftPaneDeletes.nth(i).click({ timeout: 2000 });
                await page.waitForTimeout(1000);
            } catch (err) {
                // ignore
            }
        }
    }
}

async function proceedFromServiceSelection(page) {
    console.log("[DLService] Proceeding past Service Selection...");
    const proceedBtn = page.getByRole('button', { name: 'Proceed' });
    await proceedBtn.waitFor({ state: 'visible', timeout: 5000 });
    await proceedBtn.click();
    await page.waitForTimeout(2000);
}

module.exports = {
    checkServiceCheckboxes,
    cleanupLeftPane,
    proceedFromServiceSelection
};
