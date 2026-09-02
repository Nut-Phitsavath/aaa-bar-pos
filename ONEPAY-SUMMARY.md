# OnePay BCEL API Integration Summary

I have reviewed the technical documentation (Version 2026-02-05) and successfully implemented the integration. Here is a summary of the technical setup:

## 1. Credentials Setup
You must configure these in your `.env` file:
- **`ONEPAY_USERNAME`**: Used to get the JWT token.
- **`ONEPAY_PASSWORD`**: Used to get the JWT token.
- **`ONEPAY_MCID`**: Your Merchant ID.
- **`ONEPAY_SHOPCODE`**: Defaults to `CC005` if not provided.

## 2. API Endpoints
All calls are made to the BCEL production environment:
- **Authentication**: `https://bcel.la:8093/onepayservice/authen`
- **QR Generation**: `https://bcel.la:8093/onepayservice/genonepayqr`
- **Status Inquiry**: `https://bcel.la:8093/onepayservice/checkonepayqr`

## 3. Implementation Details
- **Token Management**: The system automatically logs in and caches the JWT for 23 hours to maintain performance.
- **Global Uniqueness (`uuid`)**: We use the database-level **`order.id`** (UUID) as the `uuid` for the bank. This is globally unique and never repeats, even if your machine reboots or you start a new day.
- **Human Readable (`invoiceid`)**: We use your **`orderNumber`** (e.g., `No. 01`) as the `invoiceid` for bank statements and owner views.
- **Safety Limits**: 
  - `invoiceid` is limited to 15 characters.
  - `description` is limited to 25 characters.
  - `terminalid` is limited to 15 characters.

## 4. Webhook Tunneling
The bank will send the payment confirmation to your tunnel:
- **URL**: `https://webhook.sattavath.store/api/webhooks/onepay`
- **Logic**: When a successful payment is received, the order status is automatically changed to `PAID` in the database, and the bank's reference number is saved.

## 5. Security & Key Exchange (For Voids/Refunds)
If you need to perform **Refunds** or **Voids** (canceling a payment) directly from the POS:
1. **Generate RSA Keys**: Use the OpenSSL commands mentioned in Section 6.1 of the PDF.
2. **Submit Public Key**: You must send your `public.pem` file to BCEL so they can verify your digital signatures.
3. **Signature Logic**: The system will then use your `MCID` and the transaction `uuid` to create a secure signature for BCEL to process the refund.

## 6. Callback Security (Active Verification)
To ensure maximum security and prevent "fake" payment notifications:
1. **Direct Bank Inquiry**: The system no longer relies on a static secret token. Instead, every time a webhook is received, the POS system automatically calls BCEL's **Status Inquiry API** to verify the payment directly with their servers.
2. **Double Confirmation**: The order is only marked as `PAID` if BCEL's API explicitly confirms the transaction.
3. **Subdomain Isolation**: BCEL calls `webhook.sattavath.store`, keeping payment traffic isolated from your main application traffic.

---
**Status**: Payment, Security, and Callback logic implemented. Ready for bank registration.
