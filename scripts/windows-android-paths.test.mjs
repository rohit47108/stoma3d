import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  corepackEntrypointFromShim,
  createGradleBuildSteps,
  createGradleInvocation,
  createWindowsAndroidPlan,
  formatWindowsBatchCommand,
  nodeEnvironmentForWindowsAndroidMode,
  parseWindowsAndroidArguments,
  parseSubstMappings,
  resolveWindowsAndroidToolchain,
} from "./windows-android-paths.mjs";

test("uses production mode for embedded release bundles", () => {
  assert.equal(
    nodeEnvironmentForWindowsAndroidMode("install-release", "development"),
    "production",
  );
  assert.equal(nodeEnvironmentForWindowsAndroidMode("install", "test"), "test");
});

test("discovers the installed Android SDK and a working Gradle JDK", () => {
  const existing = new Set(
    [
      "C:\\Users\\student\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
      "C:\\Users\\student\\AppData\\Local\\Android\\Sdk\\platforms",
      "C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe",
      "C:\\Users\\student\\.gradle\\jdks\\temurin-17\\bin\\java.exe",
      "C:\\Users\\student\\.gradle\\jdks\\temurin-17\\lib\\jvm.cfg",
    ].map((value) => value.toLowerCase()),
  );

  assert.deepEqual(
    resolveWindowsAndroidToolchain({
      environment: {},
      listDirectoryNames: (directory) =>
        directory.toLowerCase() ===
        "c:\\users\\student\\.gradle\\jdks".toLowerCase()
          ? ["temurin-17"]
          : [],
      localAppData: "C:\\Users\\student\\AppData\\Local",
      pathExists: (path) => existing.has(path.toLowerCase()),
      programFiles: "C:\\Program Files",
      userProfile: "C:\\Users\\student",
    }),
    {
      ANDROID_HOME: "C:\\Users\\student\\AppData\\Local\\Android\\Sdk",
      ANDROID_SDK_ROOT: "C:\\Users\\student\\AppData\\Local\\Android\\Sdk",
      JAVA_HOME: "C:\\Users\\student\\.gradle\\jdks\\temurin-17",
    },
  );
});

test("parses the drive aliases produced by Windows subst", () => {
  assert.deepEqual(
    parseSubstMappings(
      "O:\\: => C:\\Users\\student\\Projects\\stoma3d\r\nP:\\: => C:\\other\r\n",
    ),
    new Map([
      ["O:", "C:\\Users\\student\\Projects\\stoma3d"],
      ["P:", "C:\\other"],
    ]),
  );
});

test("reuses an existing short alias for the same repository", () => {
  const plan = createWindowsAndroidPlan({
    repositoryRoot: "C:\\Users\\student\\Projects\\stoma3d",
    userProfile: "C:\\Users\\student",
    substOutput: "O:\\: => C:\\Users\\student\\Projects\\stoma3d\r\n",
    driveExists: () => true,
  });

  assert.deepEqual(plan, {
    aliasRoot: "O:\\",
    drive: "O:",
    gradleDirectory: "O:\\apps\\mobile\\android",
    needsSubst: false,
    repositoryRoot: "C:\\Users\\student\\Projects\\stoma3d",
    virtualStoreDirectory: "C:\\Users\\student\\.osp",
  });
});

test("does not take a drive that already belongs to another path", () => {
  const plan = createWindowsAndroidPlan({
    repositoryRoot: "C:\\Users\\student\\Projects\\stoma3d",
    userProfile: "C:\\Users\\student",
    substOutput: "O:\\: => C:\\other\r\n",
    driveExists: (path) => path === "O:\\",
  });

  assert.equal(plan.drive, "P:");
  assert.equal(plan.needsSubst, true);
  assert.equal(plan.gradleDirectory, "P:\\apps\\mobile\\android");
});

test("builds the install command for a supported Android architecture", () => {
  assert.deepEqual(createGradleInvocation("install", "x86_64"), {
    arguments: [
      "app:installDebug",
      "-PreactNativeArchitectures=x86_64",
      "-Pkotlin.incremental=false",
      "--stacktrace",
    ],
    executable: "gradlew.bat",
  });
});

test("builds an installable release with the JavaScript bundle embedded", () => {
  assert.deepEqual(createGradleInvocation("install-release", "arm64-v8a"), {
    arguments: [
      "app:installRelease",
      "-PreactNativeArchitectures=arm64-v8a",
      "-Pkotlin.incremental=false",
      "-Pstoma3d.disableHermesSourceMaps=true",
      "-Dorg.gradle.jvmargs=-Xmx4096m",
      "--max-workers=2",
      "--stacktrace",
    ],
    executable: "gradlew.bat",
  });
});

test("runs release bundling and native compilation in one short-path build", () => {
  assert.deepEqual(
    createGradleBuildSteps({
      architecture: "x86_64",
      mode: "install-release",
      plan: {
        gradleDirectory: "O:\\apps\\mobile\\android",
        repositoryRoot: "C:\\Users\\student\\Projects\\stoma3d",
      },
    }),
    [
      {
        arguments: [
          "app:installRelease",
          "-PreactNativeArchitectures=x86_64",
          "-Pkotlin.incremental=false",
          "-Pstoma3d.disableHermesSourceMaps=true",
          "-Dorg.gradle.jvmargs=-Xmx4096m",
          "--max-workers=2",
          "--stacktrace",
        ],
        directory: "O:\\apps\\mobile\\android",
        executable: "O:\\apps\\mobile\\android\\gradlew.bat",
      },
    ],
  );
});

test("rejects an Android architecture that could inject Gradle arguments", () => {
  assert.throws(
    () => createGradleInvocation("build", "x86_64 --offline"),
    /Unsupported Android architecture/,
  );
});

test("bounds release packaging memory without overriding debug builds", () => {
  for (const mode of ["build-release", "install-release"]) {
    const invocation = createGradleInvocation(mode, "arm64-v8a");
    assert.ok(invocation.arguments.includes("-Dorg.gradle.jvmargs=-Xmx4096m"));
    assert.ok(invocation.arguments.includes("--max-workers=2"));
    assert.doesNotThrow(() =>
      formatWindowsBatchCommand(
        "O:\\apps\\mobile\\android\\gradlew.bat",
        invocation.arguments,
      ),
    );
  }
  assert.ok(
    !createGradleInvocation("build", "x86_64").arguments.some((argument) =>
      argument.startsWith("-Dorg.gradle.jvmargs="),
    ),
  );
});

test("the Windows Android helper exposes its runnable commands", () => {
  const scriptPath = fileURLToPath(
    new URL("./windows-android.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /setup\s+Install dependencies in the short store/,
  );
  assert.match(result.stdout, /install\s+Build and install the debug app/);
  assert.match(
    result.stdout,
    /install-release\s+Build and install the release app/,
  );
});

test("accepts pnpm's forwarded argument separator", () => {
  assert.deepEqual(
    parseWindowsAndroidArguments(
      ["install", "--", "--arch", "arm64-v8a"],
      "x86_64",
    ),
    { architecture: "arm64-v8a", command: "install" },
  );
});

test("resolves Corepack's JavaScript entrypoint without spawning a cmd shim", () => {
  assert.equal(
    corepackEntrypointFromShim("C:\\Program Files\\nodejs\\corepack.cmd"),
    "C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js",
  );
});

test("formats the safe drive-alias Gradle command for cmd.exe", () => {
  assert.equal(
    formatWindowsBatchCommand("O:\\apps\\mobile\\android\\gradlew.bat", [
      "app:installDebug",
      "-PreactNativeArchitectures=x86_64",
      "-Pkotlin.incremental=false",
      "--stacktrace",
    ]),
    "O:\\apps\\mobile\\android\\gradlew.bat app:installDebug -PreactNativeArchitectures=x86_64 -Pkotlin.incremental=false --stacktrace",
  );
});
