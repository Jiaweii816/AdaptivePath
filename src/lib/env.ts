import * as nextEnvModule from "@next/env";

const nextEnv =
  (nextEnvModule as { default?: typeof nextEnvModule }).default ??
  nextEnvModule;

let loaded = false;

export function loadLocalEnv() {
  if (loaded) {
    return;
  }

  nextEnv.loadEnvConfig(process.cwd());
  loaded = true;
}
