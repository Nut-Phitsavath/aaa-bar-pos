# Manual Deployment Guide (If Scripts Fail)

If the automated `build-deploy.ps1` script fails, follow these manual steps to perfectly package your POS for another machine.

## 1. Build the App
Run this in your source project folder:
```bash
npm run build
```

## 2. Prepare the `deploy-bar-pos` folder
Create a new empty folder named `deploy-bar-pos`. This is what you will zip and move.

## 3. Copy the Core Build (Standalone)
Next.js creates a "standalone" server.
- Go to: `.next/standalone/Documents/pos-system-for-cafes/` (or search for `server.js` inside `.next/standalone`)
- Copy **everything** inside that folder into your `deploy-bar-pos` folder.
- This includes: `server.js`, `.next`, `node_modules`, `package.json`, and `.env` (if it grabbed it).

## 4. Copy Assets (CRITICAL)
Next.js *does not* include assets in the standalone folder by default. You must copy them manually:
- Copy the `public/` folder from your project root to `deploy-bar-pos/public/`.
- Copy the `.next/static/` folder from your project root to `deploy-bar-pos/.next/static/`.

> [!IMPORTANT]
> **Persistent Storage**: The `public/uploads/` folder is where menu images are stored at runtime. Leave it out of the package (step 5), so an update cannot overwrite the images uploaded on the till.

## 5. Copy Config - and no data
- Copy `prisma/schema.prisma`, `prisma/migrations/` and `prisma/setupFirstInstall.js` to `deploy-bar-pos/prisma/`.
- Copy the `scripts/` folder to `deploy-bar-pos/scripts/`.
- Do **not** copy `dev.db`, `.env` or `public/uploads/` into the package, and delete them if the standalone output brought them. They belong to the till: on an update the package is copied over the till's folder, and anything in it would land on the bar's own sales, secrets and photos. On a new till they are created there: write `.env` from `.env.example`, then `node node_modules\prisma\build\index.js migrate deploy` and `node prisma\setupFirstInstall.js`.

## 6. Run on target machine
- Use `node server.js` or the `START-POS.bat` to run.
- Ensure the target machine has **Node.js** installed.
- No Cloudflare tunnel: that was the cafe's. The bar's till stays on its own LAN.
