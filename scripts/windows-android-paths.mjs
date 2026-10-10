import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";

const BUILD_DRIVES = "OPQRSTUVWXYZ".split("").map((letter) => `${letter}:`);
const ANDROID_ARCHITECTURES = new Set([
  "arm64-v8a",
  "armeabi-v7a",
  "x86",
  "x86_64",
]);

function normalizeComparablePath(value) {
  return win32
    .normalize(value)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function defaultListDirectoryNames(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function resolveWindowsAndroidToolchain({
  environment = process.env,
  listDirectoryNames = defaultListDirectoryNames,
  localAppData = environment.LOCALAPPDATA,
  pathExists = existsSync,
  programFiles = environment.ProgramFiles || "C:\\Program Files",
  userProfile,
}) {
  const sdkCandidates = [
    environment.ANDROID_HOME,
    environment.ANDROID_SDK_ROOT,
    localAppData && win32.join(localAppData, "Android", "Sdk"),
  ].filter(Boolean);
  const androidSdkRoot = sdkCandidates.find(
    (candidate) =>
      pathExists(win32.join(candidate, "platform-tools", "adb.exe")) &&
      pathExists(win32.join(candidate, "platforms")),
  );
  if (!androidSdkRoot) {
    throw new Error(
      "Android SDK not found. Install it with Android Studio or set ANDROID_HOME.",
    );
  }

  const directoryCandidates = (directory) =>
    listDirectoryNames(directory).map((name) => win32.join(directory, name));
  const javaCandidates = [
    environment.JAVA_HOME,
    win32.join(programFiles, "Android", "Android Studio", "jbr"),
    ...(userProfile
      ? directoryCandidates(win32.join(userProfile, ".gradle", "jdks"))
      : []),
    ...directoryCandidates(win32.join(programFiles, "Eclipse Adoptium")),
    ...directoryCandidates(win32.join(programFiles, "Microsoft")),
  ].filter(Boolean);
  const javaHome = javaCandidates.find(
    (candidate) =>
      pathExists(win32.join(candidate, "bin", "java.exe")) &&
      pathExists(win32.join(candidate, "lib", "jvm.cfg")),
  );
  if (!javaHome) {
    throw new Error(
      "Working Java 17 runtime not found. Install Android Studio or set JAVA_HOME.",
    );
  }

  return {
    ANDROID_HOME: win32.normalize(androidSdkRoot),
    ANDROID_SDK_ROOT: win32.normalize(androidSdkRoot),
    JAVA_HOME: win32.normalize(javaHome),
  };
}

export function corepackEntrypointFromShim(shimPath) {
  return win32.join(
    win32.dirname(shimPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
}

export function formatWindowsBatchCommand(batchFile, arguments_) {
  if (
    !/^[A-Za-z]:\\(?:[A-Za-z0-9_.-]+\\)*[A-Za-z0-9_.-]+\.bat$/.test(batchFile)
  ) {
    throw new Error(`Unsafe batch file path: ${batchFile}`);
  }
  const unsafeArgument = arguments_.find(
    (argument) => !/^[A-Za-z0-9_.:=\-\[\]]+$/.test(argument),
  );
  if (unsafeArgument) {
    throw new Error(`Unsafe batch argument: ${unsafeArgument}`);
  }
  return `${batchFile} ${arguments_.join(" ")}`;
}

export function parseSubstMappings(output) {
  const mappings = new Map();

  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Za-z]):\\: => (.+)$/.exec(line.trim());
    if (!match) continue;
    mappings.set(`${match[1].toUpperCase()}:`, win32.normalize(match[2]));
  }

  return mappings;
}

export function createWindowsAndroidPlan({
  repositoryRoot,
  userProfile,
  substOutput = "",
  driveExists = existsSync,
}) {
  const normalizedRepositoryRoot = win32.normalize(repositoryRoot);
  const repositoryKey = normalizeComparablePath(normalizedRepositoryRoot);
  const mappings = parseSubstMappings(substOutput);

  let drive = [...mappings].find(
    ([, target]) => normalizeComparablePath(target) === repositoryKey,
  )?.[0];
  let needsSubst = false;

  if (!drive) {
    drive = BUILD_DRIVES.find(
      (candidate) => !mappings.has(candidate) && !driveExists(`${candidate}\\`),
    );
    needsSubst = true;
  }

  if (!drive) {
    throw new Error(
      "No free drive letter is available for the short Android build path",
    );
  }

  const aliasRoot = `${drive}\\`;
  return {
    aliasRoot,
    drive,
    gradleDirectory: win32.join(aliasRoot, "apps", "mobile", "android"),
    needsSubst,
    repositoryRoot: normalizedRepositoryRoot,
    virtualStoreDirectory: win32.join(userProfile, ".osp"),
  };
}

export function createGradleInvocation(mode, architecture) {
  if (!ANDROID_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported Android architecture: ${architecture}`);
  }

  const tasks = {
    build: "app:assembleDebug",
    "build-release": "app:assembleRelease",
    install: "app:installDebug",
    "install-release": "app:installRelease",
  };
  const task = tasks[mode];
  if (!task) {
    throw new Error(`Unsupported Android build mode: ${mode}`);
  }

  const arguments_ = [
    task,
    `-PreactNativeArchitectures=${architecture}`,
    "-Pkotlin.incremental=false",
  ];
  if (mode.endsWith("-release")) {
    // Release APK compression needs more heap than the default 2 GB. Bound
    // workers so packaging does not compete with every available CPU core.
    // https://docs.gradle.org/current/userguide/build_environment.html
    arguments_.push(
      "-Pstoma3d.disableHermesSourceMaps=true",
      "-Dorg.gradle.jvmargs=-Xmx4096m",
      "--max-workers=2",
    );
  }
  arguments_.push("--stacktrace");

  return {
    arguments: arguments_,
    executable: "gradlew.bat",
  };
}

export function nodeEnvironmentForWindowsAndroidMode(mode, currentValue) {
  if (mode === "build-release" || mode === "install-release") {
    return "production";
  }
  return currentValue || "development";
}

export function createGradleBuildSteps({ architecture, mode, plan }) {
  const invocation = createGradleInvocation(mode, architecture);
  return [
    {
      arguments: invocation.arguments,
      directory: plan.gradleDirectory,
      executable: win32.join(plan.gradleDirectory, invocation.executable),
    },
  ];
}

export function parseWindowsAndroidArguments(
  arguments_,
  defaultArchitecture = "x86_64",
) {
  const [command = "doctor", ...rawArguments] = arguments_;
  const rest = rawArguments.filter((argument) => argument !== "--");
  let architecture = defaultArchitecture;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--arch" || !rest[index + 1]) {
      throw new Error(`Unknown argument: ${rest[index]}`);
    }
    architecture = rest[index + 1];
    index += 1;
  }

  return { architecture, command };
}
