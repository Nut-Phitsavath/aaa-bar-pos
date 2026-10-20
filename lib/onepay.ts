/**
 * Onepay API Utility (BCEL)
 * Implements EMVco QR standard for Dynamic QR generation
 */

interface QROptions {
    merchantId?: string;
    amount: number;
    uuid: string;      // Globally unique ID (e.g. Prisma Order ID)
    invoiceid: string; // Human readable (e.g. Order Number)
    terminalId?: string;
    description?: string;
    currency?: string; // Default 418 (LAK)
}

const BCEL_BASE_URL = 'https://bcel.la:8093/onepayservice';

let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Whether this server holds a BCEL OnePay account at all. Settings only offers
 * OnePay for bills when it does, and Print Bill only calls the bank when it is
 * both chosen and set up - before this, every bill tried, failed, and told
 * staff the bank was "not responding" when it had never been connected.
 */
export function onepayConfigured(): boolean {
    return Boolean(process.env.ONEPAY_USERNAME && process.env.ONEPAY_PASSWORD)
}

async function authenticateOnepay(): Promise<{ jwt: string; mcid: string }> {
    // Check cache
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return { jwt: cachedToken, mcid: process.env.ONEPAY_MCID || '' };
    }

    const username = process.env.ONEPAY_USERNAME;
    const password = process.env.ONEPAY_PASSWORD;

    if (!username || !password) {
        throw new Error('ONEPAY_USERNAME or ONEPAY_PASSWORD not set in environment');
    }

    const response = await fetch(`${BCEL_BASE_URL}/authen`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok || !data.jwt) {
        throw new Error(`Onepay Auth Failed: ${data.message || response.statusText}`);
    }

    cachedToken = data.jwt;
    // Set expiry to 23 hours (JWT typically lasts 24h)
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;

    return { jwt: data.jwt, mcid: data.user?.MCID };
}

export async function generateOnepayQR(options: QROptions): Promise<string> {
    const {
        amount,
        uuid,
        invoiceid,
        terminalId = 'POS-01',
        description = 'Cafe Order'
    } = options;

    try {
        const { jwt } = await authenticateOnepay();

        const response = await fetch(`${BCEL_BASE_URL}/genonepayqr`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({
                amount: amount,
                uuid: uuid, // Use globally unique ID
                invoiceid: invoiceid.substring(0, 15),
                desc: description.substring(0, 25),
                terminalid: terminalId.substring(0, 15),
                shopcode: process.env.ONEPAY_SHOPCODE || 'CC005'
            })
        });

        const data = await response.json();

        if (data.result !== 0) {
            console.error('Onepay QR Generation failed:', data.message);
            // Fallback to offline QR if API fails? 
            // For now, let's just throw.
            throw new Error(`Onepay QR Error: ${data.message}`);
        }

        return data.data.qrc;
    } catch (error) {
        console.error('Onepay API Error:', error);
        throw error;
    }
}

export async function checkOnepayStatus(uuid: string) {
    try {
        const { jwt } = await authenticateOnepay();

        const response = await fetch(`${BCEL_BASE_URL}/checkonepayqr`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({
                uuid: uuid,
                shopcode: process.env.ONEPAY_SHOPCODE || 'CC005'
            })
        });

        const data = await response.json();
        return data; // Return full response for handling in the route
    } catch (error) {
        console.error('Onepay Status Check Error:', error);
        return null;
    }
}
