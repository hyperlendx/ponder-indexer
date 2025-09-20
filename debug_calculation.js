// Debug calculation with the actual liquidity index from logs

const RAY = 1000000000000000000000000000n; // 1e27

function rayDiv(a, b) {
    return (a * RAY + b / 2n) / b;
}

function rayMul(a, b) {
    return (a * b + RAY / 2n) / RAY;
}

// Values from your logs and API response
const depositAmount = 1000000000000000000n; // 1 HYPE token deposited
const liquidityIndexFromLogs = 1008240402930560993071945133n; // From the logs
const totalDeposits = 1000000000000000000n; // From API response
const actualBalance = 991826946324894975n; // From API response
const scaledBalance = 991826946324894975n; // From API response

console.log("=== Analysis with Actual Liquidity Index ===");
console.log("Deposit amount:", depositAmount.toString());
console.log("Liquidity index from logs:", liquidityIndexFromLogs.toString());
console.log("RAY:", RAY.toString());
console.log("Liquidity index vs RAY:", (Number(liquidityIndexFromLogs - RAY) / Number(RAY) * 100).toFixed(6), "% higher");

// Calculate what the scaled balance should be with the correct liquidity index
const correctScaledBalance = rayDiv(depositAmount, liquidityIndexFromLogs);
console.log("\n=== Correct Calculations ===");
console.log("Correct scaled balance should be:", correctScaledBalance.toString());

// Calculate what the actual balance should be with this scaled balance
const correctActualBalance = rayMul(correctScaledBalance, liquidityIndexFromLogs);
console.log("Correct actual balance should be:", correctActualBalance.toString());

// Calculate the correct yield
const correctYield = correctActualBalance - totalDeposits;
console.log("Correct yield should be:", correctYield.toString());

console.log("\n=== Current API Response Analysis ===");
console.log("API actual balance:", actualBalance.toString());
console.log("API scaled balance:", scaledBalance.toString());
console.log("API total deposits:", totalDeposits.toString());

// Current yield calculation
const currentYield = actualBalance - totalDeposits;
console.log("Current yield (negative):", currentYield.toString());

console.log("\n=== The Problem ===");
console.log("The scaled balance in the database is still wrong!");
console.log("Expected scaled balance:", correctScaledBalance.toString());
console.log("Actual scaled balance in DB:", scaledBalance.toString());
console.log("Difference:", (scaledBalance - correctScaledBalance).toString());

// Check if the current scaled balance was calculated with RAY instead of correct index
const scaledWithRAY = rayDiv(depositAmount, RAY);
console.log("\nScaled balance if calculated with RAY:", scaledWithRAY.toString());
console.log("Does this match API scaled balance?", scaledWithRAY === scaledBalance);

console.log("\n=== Solution ===");
console.log("The database still contains the old incorrect scaled balance.");
console.log("You need to either:");
console.log("1. Reindex from an earlier block, or");
console.log("2. Make another transaction to trigger recalculation, or");
console.log("3. Manually fix the database record");
