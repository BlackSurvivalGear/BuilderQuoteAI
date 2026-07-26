import os
from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.on("console", lambda msg: print(f"CONSOLE: [{msg.type}] {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

    # Go to the local development server
    page.goto("http://localhost:3000/")
    page.wait_for_timeout(1000)

    # Transition to AI Workspace
    page.locator("#nav-workspace-btn").click()
    page.wait_for_timeout(1000)

    # Click "Load Sample Project Description"
    page.locator("text=Load Sample Project Description").click()
    page.wait_for_timeout(1000)

    # Click "Generate Professional Quote"
    page.locator("#generate-quote-btn").click()
    page.wait_for_timeout(1000)

    # Wait for the pipeline run to finish (14 stages * 400ms delay + buffer = ~7 seconds)
    page.wait_for_timeout(7000)

    # Scroll the specific QS Engine Debug Panel into view
    debug_panel = page.locator("#qs-engine-debug-panel")
    debug_panel.wait_for(state="visible", timeout=5000)
    debug_panel.scroll_into_view_if_needed()
    page.wait_for_timeout(1000)

    # Ensure directories exist
    os.makedirs("/app/verification/screenshots", exist_ok=True)

    # Take screenshot of the newly implemented QS Engine Debug Panel
    page.screenshot(path="/app/verification/screenshots/verification.png")
    page.wait_for_timeout(1000)  # Hold final state for the video

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        os.makedirs("/app/verification/videos", exist_ok=True)
        context = browser.new_context(
            record_video_dir="/app/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()  # MUST close context to save the video
            browser.close()
