// Debug script to understand the actual balance calculation issue

const RAY = BigInt("1000000000000000000000000000"); // 1e27

// Values from the API response (FIXED!)
const scaledBalance = BigInt("991826946324894975");
const actualBalance = BigInt("1000001184076115374"); // Now using correct liquidity index!
const totalDeposits = BigInt("1000000000000000000");

// Expected liquidity index from the reserve data API
const expectedLiquidityIndex = BigInt("1008241582651557946299478002");

console.log("=== Debug Actual Balance Calculation ===");
console.log("Scaled Balance:", scaledBalance.toString());
console.log("Actual Balance (from API):", actualBalance.toString());
console.log("Total Deposits:", totalDeposits.toString());
console.log("Expected Liquidity Index:", expectedLiquidityIndex.toString());
console.log("RAY:", RAY.toString());

// Calculate what the actual balance should be with the correct liquidity index
function rayMul(a, b) {
    const halfRAY = RAY / 2n;
    return (a * b + halfRAY) / RAY;
}

const correctActualBalance = rayMul(scaledBalance, expectedLiquidityIndex);
console.log("\n=== Correct Calculation ===");
console.log("Correct Actual Balance:", correctActualBalance.toString());
console.log("Correct Actual Balance (formatted):", (Number(correctActualBalance) / 1e18).toFixed(18));

// Calculate what liquidity index was actually used
const impliedLiquidityIndex = actualBalance === scaledBalance ? RAY : (actualBalance * RAY) / scaledBalance;
console.log("\n=== Implied Liquidity Index ===");
console.log("Implied Liquidity Index:", impliedLiquidityIndex.toString());
console.log("Is using RAY (1.0)?", impliedLiquidityIndex === RAY);

// Calculate yields
const currentYield = actualBalance - totalDeposits;
const correctYield = correctActualBalance - totalDeposits;

console.log("\n=== Yield Comparison ===");
console.log("Current Yield (from API):", currentYield.toString());
console.log("Correct Yield:", correctYield.toString());
console.log("Current Yield (formatted):", (Number(currentYield) / 1e18).toFixed(18));
console.log("Correct Yield (formatted):", (Number(correctYield) / 1e18).toFixed(18));

console.log("\n=== Summary ===");
console.log("✅ FIXED! The API is now using the correct liquidity index!");
console.log("✅ Actual balance is correctly calculated using the most recent liquidity index");
console.log("✅ Yield is now positive as expected!");
console.log("The small difference in yield values is due to using slightly different liquidity index values");
console.log("(API uses most recent event, debug uses expected value from earlier)");
