# Manual Deployment Guide (If Scripts Fail)

If the automated `build-deploy.ps1` script fails, follow these manual steps to perfectly package your POS for another machine.

## 1. Build the App
Run this in your source project folder:
```bash
npm run build
```

## 2. Prepare the `deploy-pos` folder
Create a new empty folder named `deploy-pos`. This is what you will zip and move.

## 3. Copy the Core Build (Standalone)
Next.js creates a "standalone" server.
- Go to: `.next/standalone/Documents/pos-system-for-cafes/` (or search for `server.js` inside `.next/standalone`)
- Copy **everything** inside that folder into your `deploy-pos` folder.
- This includes: `server.js`, `.next`, `node_modules`, `package.json`, and `.env` (if it grabbed it).

## 4. Copy Assets (CRITICAL)
Next.js *does not* include assets in the standalone folder by default. You must copy them manually:
- Copy the `public/` folder from your project root to `deploy-pos/public/`.
- Copy the `.next/static/` folder from your project root to `deploy-pos/.next/static/`.

> [!IMPORTANT]
> **Persistent Storage**: The `public/uploads/` folder is where menu images are stored at runtime. When updating the app, always make sure to back up or merge this folder so you don't lose the images uploaded by the user.

## 5. Copy Database & Config
- Copy `dev.db` to `deploy-pos/`.
- Copy `.env` to `deploy-pos/` (if not already there).
- Copy the `prisma/` folder to `deploy-pos/prisma/`.
- Copy the `scripts/` folder to `deploy-pos/scripts/`.

## 6. Run on target machine
- Use `node server.js` or the `START-POS.bat` to run.
- Ensure the target machine has **Node.js** installed.
- No Cloudflare tunnel: that was the cafe's. The bar's till stays on its own LAN.
