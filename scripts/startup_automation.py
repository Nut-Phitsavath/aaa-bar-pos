import time
import subprocess
import webbrowser
import pygetwindow as gw
import pyautogui
from screeninfo import get_monitors
import sys
import os
import shutil
import tempfile


def prepare_profile(name):
    """Return a persistent Chrome user-data-dir whose HTTP cache is cleared on
    each boot. Clearing only the cache (not the whole profile) drops any stale
    or half-written chunk left over from a previous deploy -- the cause of the
    kiosk blank-screen / ChunkLoadError -- while keeping the POS login cookie.
    Each window gets its own dir so the two kiosks run as separate instances."""
    base = os.path.join(
        os.environ.get("LOCALAPPDATA", tempfile.gettempdir()),
        "pos-kiosk-profiles",
        name,
    )
    os.makedirs(base, exist_ok=True)
    for sub in ("Default/Cache", "Default/Code Cache", "Default/GPUCache",
                "ShaderCache", "GrShaderCache"):
        path = os.path.join(base, *sub.split("/"))
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
    return base

def get_new_window(existing_window_ids, timeout=15):
    """Wait for a new window to appear and return it."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        current_windows = gw.getAllWindows()
        for win in current_windows:
            if win._hWnd not in existing_window_ids:
                # Basic check to avoid background system windows
                if win.title.strip() != "":
                    return win
        time.sleep(0.5)
    return None

def main():
    # URLs
    pos_url = "http://localhost:3000/pos"
    customer_url = "http://localhost:3000/customer-view"

    print("\n" + "="*40)
    print("--- POS STARTUP (SEQUENTIAL MODE) ---")
    print("="*40)
    
    # 0. Get monitor info
    monitors = get_monitors()
    print(f"\n[1/4] DETECTED {len(monitors)} MONITORS:")
    for i, m in enumerate(monitors):
        print(f"  Monitor {i}: {m.width}x{m.height} at ({m.x}, {m.y})")

    # 1. Handle Customer View Window
    print(f"\n[2/4] STEP 1: Launching Customer View Window...")
    existing_ids = [w._hWnd for w in gw.getAllWindows()]
    
    try:
        customer_profile = prepare_profile("customer")
        subprocess.Popen(['start', 'chrome', '--new-window', f'--user-data-dir={customer_profile}', '--kiosk-printing', customer_url], shell=True)
    except Exception as e:
        print(f"  Error launching: {e}. Using fallback.")
        webbrowser.open(customer_url, new=1)
    
    customer_window = get_new_window(existing_ids)
    if customer_window:
        print(f"  Found NEW Window: '{customer_window.title}'")
        try:
            # Determine target monitor
            if len(monitors) > 1:
                target = monitors[1]
                print(f"  Moving Customer View to Monitor 1 ({target.x}, {target.y})")
            else:
                target = monitors[0]
                print(f"  Only 1 monitor. Moving to primary ({target.x}, {target.y})")

            if customer_window.isMinimized: customer_window.restore()
            customer_window.activate()
            # Move significantly inside
            customer_window.moveTo(target.x + 200, target.y + 200)
            customer_window.maximize()
            
            print("  Waiting 2s before F11...")
            time.sleep(2)
            pyautogui.press('f11')
            print(f"  SUCCESS: Customer View positioned and F11 pressed.")
        except Exception as e:
            print(f"  FAILED to move Customer View: {e}")
    else:
        print("  FAILED: Could not identify the new Customer View window.")

    # 2. Handle POS Window
    print(f"\n[3/4] STEP 2: Launching POS Window...")
    # Refresh existing list to include the Customer View window we just found
    existing_ids = [w._hWnd for w in gw.getAllWindows()]
    
    try:
        pos_profile = prepare_profile("pos")
        subprocess.Popen(['start', 'chrome', '--new-window', f'--user-data-dir={pos_profile}', '--kiosk-printing', pos_url], shell=True)
    except Exception as e:
        print(f"  Error launching: {e}. Using fallback.")
        webbrowser.open(pos_url, new=1)

    pos_window = get_new_window(existing_ids)
    if pos_window:
        print(f"  Found NEW Window: '{pos_window.title}'")
        try:
            target = monitors[0]
            print(f"  Moving POS to Monitor 0 ({target.x}, {target.y})")
            if pos_window.isMinimized: pos_window.restore()
            pos_window.activate()
            # Move slightly inside targeted monitor
            pos_window.moveTo(target.x + 50, target.y + 50)
            print(f"  SUCCESS: POS positioned.")
        except Exception as e:
            print(f"  FAILED to move POS: {e}")
    else:
        print("  FAILED: Could not identify the new POS window.")

    print("\n" + "="*40)
    print("--- STARTUP COMPLETE ---")
    print("="*40)

if __name__ == "__main__":
    main()
