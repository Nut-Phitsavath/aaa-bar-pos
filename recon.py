from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        page.goto('http://localhost:3000/pos')
        page.wait_for_load_state('networkidle')
        
        # Take a screenshot to see current state
        page.screenshot(path='pos_screenshot.png')
        print("Recon: POS Page loaded and screenshot taken.")
        
        # Discover some products
        # Look for product cards
        products = page.locator('button') # Cards usually are clickable
        print(f"Discovered {products.count()} buttons.")
        
    except Exception as e:
        print(f"Error during recon: {e}")
    finally:
        browser.close()
