import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// Hex helper
function decimalToHex32(decStr) {
  const hex = BigInt(decStr).toString(16);
  return hex.padStart(64, "0");
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("Starting PrivatePay ZK Stellar Testnet Deployment...");

  // 1. Convert vk JSON to Soroban format
  console.log("Reading withdraw verification key...");
  const vkPath = "circuits/artifacts/withdraw/withdraw_verification_key.json";
  if (!existsSync(vkPath)) {
    console.error(`Error: ${vkPath} not found! Run the circuit build first.`);
    process.exit(1);
  }

  const vkRaw = JSON.parse(readFileSync(vkPath, "utf8"));
  
  // Notice: keys are alphabetically sorted: alpha_g1, beta_g2, delta_g2, gamma_g2, ic
  const vkArgs = {
    alpha_g1: {
      x: decimalToHex32(vkRaw.vk_alpha_1[0]),
      y: decimalToHex32(vkRaw.vk_alpha_1[1])
    },
    beta_g2: {
      // Swap c0 and c1: snarkjs is [c0, c1]; Soroban expects [c1, c0]
      x: [decimalToHex32(vkRaw.vk_beta_2[0][1]), decimalToHex32(vkRaw.vk_beta_2[0][0])],
      y: [decimalToHex32(vkRaw.vk_beta_2[1][1]), decimalToHex32(vkRaw.vk_beta_2[1][0])]
    },
    delta_g2: {
      x: [decimalToHex32(vkRaw.vk_delta_2[0][1]), decimalToHex32(vkRaw.vk_delta_2[0][0])],
      y: [decimalToHex32(vkRaw.vk_delta_2[1][1]), decimalToHex32(vkRaw.vk_delta_2[1][0])]
    },
    gamma_g2: {
      x: [decimalToHex32(vkRaw.vk_gamma_2[0][1]), decimalToHex32(vkRaw.vk_gamma_2[0][0])],
      y: [decimalToHex32(vkRaw.vk_gamma_2[1][1]), decimalToHex32(vkRaw.vk_gamma_2[1][0])]
    },
    ic: vkRaw.IC.map(pt => ({
      x: decimalToHex32(pt[0]),
      y: decimalToHex32(pt[1])
    }))
  };

  if (!existsSync("scripts")) {
    mkdirSync("scripts");
  }
  writeFileSync("scripts/vk_args.json", JSON.stringify(vkArgs, null, 2));
  console.log("Converted Groth16 verification key exported to scripts/vk_args.json");

  // 2. Deploy verifier contract
  console.log("Deploying verifier contract to Testnet...");
  const verifierWasm = "contracts/target/wasm32v1-none/release/privatepay_verifier.wasm";
  const verifierId = execSync(`stellar contract deploy --wasm ${verifierWasm} --source deployer --network testnet`, { encoding: "utf8" }).trim();
  console.log(`Verifier Contract Deployed. ID: ${verifierId}`);

  console.log("Waiting 15 seconds for propagation...");
  await sleep(15000);

  // 3. Initialize verifier contract
  console.log("Initializing verifier contract...");
  execSync(`stellar contract invoke --id ${verifierId} --source deployer --network testnet -- initialize --vk-file-path scripts/vk_args.json`, { stdio: "inherit" });
  console.log("Verifier contract initialized successfully.");

  // 4. Get or deploy native asset contract (XLM SAC)
  let assetId;
  try {
    console.log("Deploying/retrieving native asset contract (XLM)...");
    assetId = execSync(`stellar contract asset deploy --asset native --source deployer --network testnet`, { encoding: "utf8" }).trim();
  } catch (err) {
    console.log("Native asset contract already exists, using canonical Testnet XLM SAC ID.");
    assetId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  }
  console.log(`Native Asset Contract ID: ${assetId}`);

  // 5. Deploy pool contract
  console.log("Deploying pool contract to Testnet...");
  const poolWasm = "contracts/target/wasm32v1-none/release/privatepay_pool.wasm";
  const poolId = execSync(`stellar contract deploy --wasm ${poolWasm} --source deployer --network testnet`, { encoding: "utf8" }).trim();
  console.log(`Pool Contract Deployed. ID: ${poolId}`);

  console.log("Waiting 15 seconds for propagation...");
  await sleep(15000);

  // 6. Initialize pool contract
  console.log("Initializing pool contract...");
  const adminAddress = execSync(`stellar keys address deployer`, { encoding: "utf8" }).trim();
  execSync(`stellar contract invoke --id ${poolId} --source deployer --network testnet -- initialize --admin ${adminAddress} --token_address ${assetId} --verifier_address ${verifierId}`, { stdio: "inherit" });
  console.log("Pool contract initialized successfully.");

  // 7. Write environment file
  console.log("Writing frontend configuration...");
  const envContent = `# PrivatePay ZK Deployed Contract IDs on Testnet
NEXT_PUBLIC_VERIFIER_CONTRACT_ID=${verifierId}
NEXT_PUBLIC_POOL_CONTRACT_ID=${poolId}
NEXT_PUBLIC_TOKEN_CONTRACT_ID=${assetId}
`;
  writeFileSync("frontend/.env.local", envContent);
  console.log("Wrote frontend/.env.local successfully!");
  console.log("Deployment Complete!");
}

main().catch(err => {
  console.error("Deployment failed:", err);
  process.exit(1);
});

