const tokenDecimalsMap: any = {
    '0x5555555555555555555555555555555555555555': 18,
    '0x94e8396e0869c9f2200760af0621afd240e1cf38': 18,
    '0x9fdbda0a5e284c32744d2f17ee5c74b284993463': 8,
    '0xbe6727b535545c67d5caa73dea54865b92cf7907': 18,
    '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 18,
    '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2': 18,
    '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 6,
    '0x1359b05241ca5076c9f59605214f4f84114c0de8': 6,
    '0xb50a96253abdf803d85efcdce07ad8becbc52bd5': 6,
    '0xfd739d4e423301ce9385c1fb8850539d657c296d': 18,
    '0x0ad339d66bf4aed5ce31c64bc37b3244b6394a77': 18,
    '0x311db0fde558689550c68355783c95efdfe25329': 18,
    '0xb7379d395f3c83952ad794896205f7e33e358735': 18,
    '0x068f321fa8fb9f0d135f290ef6a3e2813e1c8a29': 9,
    '0xd8fc8f0b03eba61f64d08b0bef69d80916e5dda9': 18,
    '0xb88339cb7199b77e23db6e890353e22632ba630f': 6,
    '0x111111a1a0667d36bd57c0a9f569b98057111111': 6,
    '0xea84ca9849d9e76a78b91f221f84e9ca065fc9f5': 18,
};

/**
 * Get token decimals from hardcoded map with caching
 *
 * @param context - Ponder context (not used, kept for API compatibility)
 * @param reserve - Token address
 * @returns Token decimals (number), or undefined if not found
 */
export async function getDecimals(context: any, reserve: string): Promise<number | undefined> {
    const normalizedAddress = reserve.toLowerCase();
    return tokenDecimalsMap[normalizedAddress];
}
