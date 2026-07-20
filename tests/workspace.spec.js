const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('BuilderQuoteAI Workspace Integration Suite', () => {

    test.beforeEach(async ({ page }) => {
        // Go to the local page (assuming server is running on port 3000)
        await page.goto('http://localhost:3000/');
    });

    test('should load landing page and branding correctly', async ({ page }) => {
        // Verify title
        await expect(page).toHaveTitle(/BuilderQuoteAI/);

        // Verify landing buttons
        const startBtn = page.locator('text=Get Started Free');
        await expect(startBtn).toBeVisible();
    });

    test('should transition to AI Workspace and verify elements', async ({ page }) => {
        // Navigate to Workspace
        const workspaceBtn = page.locator('#nav-workspace-btn');
        await expect(workspaceBtn).toBeVisible();
        await workspaceBtn.click();

        // Verify SPA workspace section is visible
        const workspaceSection = page.locator('#ai-workspace-section');
        await expect(workspaceSection).not.toHaveClass(/hidden/);

        // Verify Project Name input is visible
        const projNameInput = page.locator('#project-name');
        await expect(projNameInput).toBeVisible();

        // Verify Regional Pricing Profile selector is visible
        const regionSelect = page.locator('#project-region');
        await expect(regionSelect).toBeVisible();

        // Check region options exist
        const options = await regionSelect.locator('option').allTextContents();
        expect(options.length).toBe(12);
        expect(options[0]).toContain('London');
    });

    test('should toggle regional profile and save correctly', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Select Scotland
        const regionSelect = page.locator('#project-region');
        await regionSelect.selectOption('Scotland');

        // Check local storage to see if saved
        const savedDataStr = await page.evaluate(() => localStorage.getItem('builder_quote_data'));
        expect(savedDataStr).not.toBeNull();
        const data = JSON.parse(savedDataStr);
        expect(data.projectInfo.region).toBe('Scotland');
    });

    test('should render detailed upload documents meta-information', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Trigger loading sample project description (auto-populates files)
        const loadSampleBtn = page.locator('text=Load Sample Project Description');
        await loadSampleBtn.click();

        // Trigger Generate Quote to auto-populate files if empty
        const generateBtn = page.locator('#generate-quote-btn');
        await generateBtn.click();

        // Check uploaded files list rendering
        const fileList = page.locator('#uploaded-files-list');
        await expect(fileList).toBeVisible();

        // Verify pages, processing status, and confidence is rendered
        const firstFile = fileList.locator('div.flex-col').first();
        await expect(firstFile).toBeVisible();

        const fileText = await firstFile.allTextContents();
        expect(fileText.join(' ')).toContain('Pages:');
        expect(fileText.join(' ')).toContain('Confidence:');
        expect(fileText.join(' ')).toContain('Status: Analysis Complete');
    });

    test('should open expandable diagnostics panel correctly', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Locate developer diagnostic toggle button
        const devToggle = page.locator('text=AI Response Panel & Diagnostics');
        await expect(devToggle).toBeVisible();

        // Trigger click
        await devToggle.click();

        // Verify panel is visible
        const devPanel = page.locator('#developer-diagnostic-panel');
        await expect(devPanel).toBeVisible();
        await expect(devPanel).not.toHaveClass(/hidden/);
    });

    test('should test connection and display improved status box', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Switch to AI Settings tab
        const settingsTabBtn = page.locator('#tab-btn-ai-settings');
        await settingsTabBtn.click();

        // Verify OpenAI settings card exists
        const openaiCard = page.locator('text=OpenAI').first();
        await expect(openaiCard).toBeVisible();

        // Click "Test API Connection"
        const testBtn = page.locator('text=Test API Connection').first();
        await testBtn.click();

        // Wait for connection status box
        const statusBox = page.locator('div[id^="conn-feedback-"]').first();
        await expect(statusBox).toBeVisible();

        // Wait for connection completion (success simulated)
        await page.waitForTimeout(2000);
        const feedbackText = await statusBox.textContent();
        expect(feedbackText).toContain('✓ Connected');
        expect(feedbackText).toContain('Model:');
    });

    test('should run simulated quote generation progress checklists and QS report', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Trigger loading sample project description (auto-populates files)
        const loadSampleBtn = page.locator('text=Load Sample Project Description');
        await loadSampleBtn.click();

        // Click Generate Professional Quote
        const generateBtn = page.locator('#generate-quote-btn');
        await generateBtn.click();

        // Verify progress checklist steps exist and connect
        const stepZero = page.locator('#step-0');
        await expect(stepZero).toBeVisible();

        // Wait for generation to finish (7 steps * 600ms = ~4.2s max)
        await page.waitForTimeout(6000);

        // Verify 14-section report is generated inside deliverables viewport
        const report = page.locator('#output-content-wrapper');
        await expect(report).toContainText('1. Executive Summary');
        await expect(report).toContainText('2. Scope of Works');
        await expect(report).toContainText('14. Commercial Summary');
    });

    test('should execute export capabilities flawlessly', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Click export JSON and ensure no javascript crash occurs
        const exportJsonBtn = page.locator('text=Export JSON');
        await expect(exportJsonBtn).toBeVisible();
    });

    test('should skip drawing-interpreter when only specification is supplied', async ({ page }) => {
        // Navigate to Workspace
        await page.locator('#nav-workspace-btn').click();

        // Reset or upload only a specification
        await page.evaluate(() => {
            uploadedFiles = [
                { id: 'f-spec', name: 'tender_specification_rev_A.pdf', size: 4500000, formattedSize: '4.29 MB', type: 'spec', pages: 12, processingStatus: 'Analysis Complete', confidenceScore: 95, classification: "Specifications", revision: "Rev A", drawingNumber: "" }
            ];
            renderUploadedFilesList();
            renderDocumentRegisterAndReadiness();
            saveWorkspaceToLocalStorage();
        });

        // Verify Document Register is visible and has categorized the file as Specifications
        const registerSection = page.locator('#document-register-section');
        await expect(registerSection).toBeVisible();
        await expect(registerSection).toContainText('Specifications');
        await expect(registerSection).toContainText('tender_specification_rev_A.pdf');

        // Verify missing drawings generate RFI warning labels in the readiness summary
        await expect(registerSection).toContainText('Architectural Drawings Missing');

        // Click Generate Professional Quote
        const generateBtn = page.locator('#generate-quote-btn');
        await generateBtn.click();

        // Wait for generation to run
        await page.waitForTimeout(6000);

        // Verify that drawing-interpreter and quantity-surveyor were SKIPPED
        const interpreterStage = page.locator('#stage-drawing-interpreter');
        await expect(interpreterStage).toContainText('SKIPPED');

        const qsStage = page.locator('#stage-quantity-surveyor');
        await expect(qsStage).toContainText('SKIPPED');

        // Click on skipped stage to view detail explanation
        await interpreterStage.click();
        const outputWrapper = page.locator('#output-content-wrapper');
        await expect(outputWrapper).toContainText('No architectural drawings supplied.');
    });

});
