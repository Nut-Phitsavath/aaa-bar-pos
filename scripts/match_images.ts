
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');


// Levenshtein distance implementation
const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }

    return matrix[b.length][a.length];
};

const calculateScore = (target: string, candidate: string): number => {
    const targetTokens = target.split(/\s+/).filter(t => t.length > 0);
    const candidateTokens = candidate.split(/\s+/).filter(t => t.length > 0);

    if (targetTokens.length === 0 || candidateTokens.length === 0) return 0;

    let matches = 0;
    const usedCandidateIndices = new Set<number>();

    for (const tToken of targetTokens) {
        let bestTokenMatch = 0;
        let bestTokenIdx = -1;

        for (let i = 0; i < candidateTokens.length; i++) {
            if (usedCandidateIndices.has(i)) continue;

            const cToken = candidateTokens[i];

            // Exact match
            if (cToken === tToken) {
                bestTokenMatch = 1;
                bestTokenIdx = i;
                break; // Optimized finding exact match first
            }

            // Fuzzy match (allow slight variations based on length)
            const dist = levenshtein(tToken, cToken);
            const maxLength = Math.max(tToken.length, cToken.length);

            // Allow 1 edit for short words, 2 for longer (>5 chars)
            const allowedEdits = maxLength > 5 ? 2 : 1;

            if (dist <= allowedEdits) {
                // But don't match very short words fuzzily (e.g. 'on' vs 'in') unless longer
                if (maxLength > 3 || dist === 0) {
                    bestTokenMatch = 1;
                    bestTokenIdx = i;
                }
            }
        }

        if (bestTokenIdx !== -1) {
            matches += bestTokenMatch;
            usedCandidateIndices.add(bestTokenIdx);
        }
    }

    return matches / Math.max(targetTokens.length, candidateTokens.length);
};


// Helper to normalize strings for comparison
const normalize = (str: string) => {
    return str.toLowerCase()
        .replace(/\.[^/.]+$/, "") // Remove extension
        .replace(/^\d+-/, "")     // Remove timestamp prefix 
        .replace(/[-_]/g, " ")    // Replace separators with spaces
        .replace(/\s+/g, " ")     // Collapse multiple spaces
        .trim();
};

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = !args.includes('--execute');

    console.log(isDryRun ? "Starting DRY RUN..." : "Starting EXECUTION...");

    // 1. Get all files in uploads
    const files = fs.readdirSync(UPLOADS_DIR);
    console.log(`Found ${files.length} files in ${UPLOADS_DIR}`);

    // Create a map of normalized filename -> original filename
    const fileList = files.map(file => ({
        original: file,
        normalized: normalize(file)
    }));

    // 2. Get all menus
    const menus = await prisma.menu.findMany({
        include: { category: true }
    });
    console.log(`Found ${menus.length} menus in database.`);

    let matchesFound = 0;
    let updates = [];

    for (const menu of menus) {
        const menuName = menu.name;
        let targetName = normalize(menuName);
        let isPremium = false;

        // Premium Logic: Strip "Premium" from the start for fallback content matching
        if (menu.category.name === 'Premium' || targetName.startsWith('premium ')) {
            isPremium = true;
            // Keep potential "Premium" part for exact match first attempts
            // But we will also try without "Premium"
        }

        let bestMatch = null;
        let bestScore = 0;
        let matchType = '';

        // First Pass: Try matching full name against files
        for (const file of fileList) {
            const score = calculateScore(targetName, file.normalized);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = file.original;
                matchType = 'Direct Fuzzy';
            }
        }

        // Second Pass: If Premium and score is low, try stripping "Premium"
        if (isPremium && bestScore < 0.8) {
            const baseTarget = targetName.replace(/^premium\s+/, '');
            for (const file of fileList) {
                const score = calculateScore(baseTarget, file.normalized);
                // We prioritize direct matches, but if we found a better match here...
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = file.original;
                    matchType = 'Premium Fallback';
                }
            }
        }

        // Threshold for acceptance
        if (bestScore >= 0.6) {
            matchesFound++;
            const newImagePath = `/uploads/${bestMatch}`;

            if (menu.image !== newImagePath) {
                updates.push({
                    id: menu.id,
                    name: menu.name,
                    currentImage: menu.image,
                    newImage: newImagePath,
                    matchType,
                    score: bestScore.toFixed(2)
                });
            }
        } else {
            // console.log(`No good match for: ${menu.name} (Best score: ${bestScore} with ${bestMatch})`);
        }
    }

    console.log(`\nFound matches for ${matchesFound} / ${menus.length} menus.`);
    console.log(`Pending updates: ${updates.length}`);

    if (updates.length > 0) {
        console.log("\nProposed Changes:");
        updates.forEach(u => {
            console.log(`[${u.matchType} - ${u.score}] ${u.name}`);
            console.log(`   Old: ${u.currentImage}`);
            console.log(`   New: ${u.newImage}`);
        });

        if (!isDryRun) {
            console.log("\nApplying updates...");
            for (const u of updates) {
                await prisma.menu.update({
                    where: { id: u.id },
                    data: { image: u.newImage }
                });
            }
            console.log("Updates complete.");
        } else {
            console.log("\nRun with --execute to apply these changes.");
        }
    } else {
        console.log("No updates needed.");
    }

}


main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
