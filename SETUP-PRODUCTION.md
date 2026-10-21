# POS System Production Setup Guide

This guide explains how to set up the POS system for production on the bar's Windows machine. The till runs on the bar's own network only: other devices reach it over the LAN, and nothing is published to the internet.

## 1. Prerequisites
- **Node.js**: Installed on the POS machine.
- **Git**: (Optional) to pull updates.

## 2. Production Build
Before running the server for the first time or after any code updates, run the build script:
1. Open the project folder.
2. Double-click `scripts/build.bat`.
3. Wait for it to finish (it creates the optimized `.next` folder).

## 3. Automation (Start on Boot)
To make the POS system start automatically when Windows boots:

1. Find the `run-pos.bat` file in the project root.
2. **Right-click** it and select **Create Shortcut**.
3. Press `Win + R` on your keyboard, type `shell:startup`, and press Enter.
4. Move the **Shortcut** you just created into this folder.
5. (Optional but Recommended) Set Windows to **Auto-Login** so it reaches the desktop without a password.

## 4. Daily Operation
- Once set up, just turn on the computer.
- A terminal window opens automatically for the **POS Server**.
- You can access the POS locally at `http://localhost:3000`.

---
*Note: the old Cloudflare tunnel (`monitor.` / `webhook.sattavath.store`) belonged to the cafe this system grew out of. It is not part of the bar's setup. BCEL OnePay's callback will need a public address of its own when OnePay goes live - decide that then, rather than publishing the whole till.*
