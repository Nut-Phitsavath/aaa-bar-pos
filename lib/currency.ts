// Currency utility for Laos Kips (LAK)
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('lo-LA', {
        style: 'currency',
        currency: 'LAK',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount)
}

export function formatNumber(amount: number): string {
    return new Intl.NumberFormat('lo-LA', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount)
}

// Simple format without currency symbol
export function formatLAK(amount: number): string {
    return `${formatNumber(amount)} ₭`
}

export const LAK_DENOMINATIONS = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export function calculateChange(total: number, cashReceived: number) {
    let change = cashReceived - total;
    const denominations: { denom: number; count: number }[] = [];

    for (const denom of LAK_DENOMINATIONS) {
        const count = Math.floor(change / denom);
        if (count > 0) {
            denominations.push({ denom, count });
            change -= denom * count;
        }
    }

    return {
        totalChange: cashReceived - total,
        denominations
    };
}

export function calculateTax(amount: number, rate: number = 10): number {
    return Math.round(amount * (rate / 100));
}

export function calculateInclusiveTax(total: number, rate: number = 10): number {
    if (rate <= 0) return 0;
    const net = total / (1 + rate / 100);
    return Math.round(total - net);
}