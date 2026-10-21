# POS System Production Setup Guide

This guide explains how to set up the POS system for production on the bar's Windows machine. The till runs on the bar's own network only: other devices reach it over the LAN, and nothing is published to the internet.

## 1. Prerequisites
- **Node.js**: Installed on the POS machine.
- **Git**: (Optional) to pull updates.
- **`SESSION_SECRET` in `.env`**: signs the staff login cookie. `FIRST-TIME-SETUP.bat` in the package writes the till's `.env` with a fresh random one; if you set the till up by hand, generate one as shown in `.env.example`. Without it nobody can sign in, and the PIN screen says so.

## 1b. Installing from the package (recommended)
`build-deploy.ps1` on the developer's machine makes `..\deploy-bar-pos`, which holds the app and none of the till's data (no database, no photos, no `.env`).

- **New till:** copy `deploy-bar-pos` to where the POS will live (e.g. `C:\pos`) and run `FIRST-TIME-SETUP.bat` there. It builds an empty database and asks for the Owner PIN (4-8 digits, typed twice). Sign in as Owner, then set up Settings, staff, the menu and the floor. On a till that already has sales it changes nothing.
- **Daily:** `START-POS.bat` (or the `run-pos.bat` shortcut below) backs up the database, brings it up to date with `prisma migrate deploy`, and starts the server. If the database update fails, the till does not open.
- **Update:** copy the new package onto the till anywhere except the POS folder, and drag the POS folder onto the package's `UPDATE-POS.bat`. It backs up, stops the server, copies the new version over without deleting anything, checks the database was not touched, and starts the POS, which applies any new migrations.

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
