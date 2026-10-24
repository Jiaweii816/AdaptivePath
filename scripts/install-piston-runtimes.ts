import { PistonClient } from "../src/server/tools/code-runner/piston-client";

const requiredRuntimes = ["python", "gcc"] as const;

async function main() {
  const client = new PistonClient();
  const packages = await client.listPackages();

  for (const language of requiredRuntimes) {
    const installed = packages.some(
      (pistonPackage) =>
        pistonPackage.language === language && pistonPackage.installed,
    );

    if (installed) {
      console.log(`${language} runtime already installed`);
      continue;
    }

    console.log(`Installing ${language} runtime in Piston...`);
    await client.installPackage(language, "*");
    console.log(`${language} runtime installed`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
