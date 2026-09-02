# POS System Production Setup Guide

This guide explains how to set up the POS system for production on a Windows machine with Cloudflare Tunneling.

## 1. Prerequisites
- **Node.js**: Installed on the POS machine.
- **cloudflared**: Download the Windows binary from [Cloudflare's website](https://github.com/cloudflare/cloudflared/releases) and add it to your System PATH.
- **Git**: (Optional) to pull updates.

## 2. Fresh Cloudflare Tunnel Setup (New)
Since you want to start new, follow these steps **on the POS machine**:

1. **Login to Cloudflare**:
   ```bash
   cloudflared tunnel login
   ```
   (Verify the link in your browser and authorize).

2. **Create a New Tunnel**:
   ```bash
   cloudflared tunnel create pos-tunnel
   ```
   *Copy the Tunnel ID (e.g., `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)*.

3. **Update `.cloudflared/config.yml`**:
   - Change `tunnel:` to your **New Tunnel ID**.
   - Change `credentials-file:` to the path of the new JSON file (usually `C:\Users\<YourUser>\.cloudflared\<TunnelID>.json`).

4. **Route the Subdomains**:
   Run these commands to link your subdomains to the new tunnel:
   ```bash
   cloudflared tunnel route dns pos-tunnel monitor.sattavath.store
   cloudflared tunnel route dns pos-tunnel webhook.sattavath.store
   ```

   > [!IMPORTANT]
   > If you get **"host already exists" (Code 1003)**:
   > 1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
   > 2. Navigate to **DNS > Records**.
   > 3. Delete the existing **CNAME** records for `monitor` and `webhook`.
   > 4. Run the `route dns` commands again.

5. **Test the Tunnel**:
   ```bash
   cloudflared tunnel run --config .cloudflared\config.yml
   ```

## 3. Production Build
Before running the server for the first time or after any code updates, run the build script:
1. Open the project folder.
2. Double-click `scripts/build.bat`.
3. Wait for it to finish (it creates the optimized `.next` folder).

## 4. Automation (Start on Boot)
To make the POS system start automatically when Windows boots:

1. Find the `run-pos.bat` file in the project root.
2. **Right-click** it and select **Create Shortcut**.
3. Press `Win + R` on your keyboard, type `shell:startup`, and press Enter.
4. Move the **Shortcut** you just created into this folder.
5. (Optional but Recommended) Set Windows to **Auto-Login** so it reaches the desktop without a password.

## 5. Daily Operation
- Once set up, just turn on the computer. 
- Two terminal windows will open automatically: one for the **POS Server** and one for the **Cloudflare Tunnel**.
- You can access the POS locally at `http://localhost:3000`.
- The owner can view it remotely at `https://monitor.sattavath.store`.

---
*Note: BCEL OnePay callback will hit `https://webhook.sattavath.store` as configured in your Cloudflare tunnel.*
