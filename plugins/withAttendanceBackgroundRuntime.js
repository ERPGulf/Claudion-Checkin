const fs = require("node:fs");
const path = require("node:path");
const {
  withAppDelegate,
  withDangerousMod,
  withXcodeProject,
  withInfoPlist,
  IOSConfig,
} = require("@expo/config-plugins");

const FILE_NAME = "AttendanceBackgroundRuntime.swift";
const SETUP = "    AttendanceBackgroundRuntime.shared.configure(factory: factory, launchOptions: launchOptions)\n\n";
const EXPO_SCENE = "EXExpoAppSceneDelegate";
const ATTENDANCE_SCENE = "ClaudionAttendanceSceneDelegate";

function getOwnedScene(manifest) {
  const scenes = manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  if (manifest?.UIApplicationSupportsMultipleScenes !== false || scenes?.length !== 1 ||
      scenes[0].UISceneConfigurationName !== "Default Configuration") {
    throw new Error("Review the custom scene manifest before applying attendance root reuse.");
  }
  return scenes[0];
}

// Runs before Expo's scene mod so it sees its own manifest on reapplication.
function normalizeSceneManifest(manifest) {
  if (manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0]?.UISceneDelegateClassName === ATTENDANCE_SCENE) {
    getOwnedScene(manifest).UISceneDelegateClassName = EXPO_SCENE;
  }
  return manifest;
}

function selectAttendanceScene(manifest) {
  const scene = getOwnedScene(manifest);
  if (![EXPO_SCENE, ATTENDANCE_SCENE].includes(scene.UISceneDelegateClassName)) {
    throw new Error("Review the custom scene delegate before applying attendance root reuse.");
  }
  scene.UISceneDelegateClassName = ATTENDANCE_SCENE;
  return manifest;
}

function updateAppDelegate(contents) {
  if (!contents.includes("ExpoReactNativeFactoryProvider")) {
    throw new Error("Attendance background startup requires Expo's supported scene lifecycle opt-in.");
  }
  // Remove only this plugin's earlier generated callback; the manifest selects
  // the class for both restored and newly created scene sessions.
  contents = contents.replace(/  \/\/ @generated begin claudion-attendance-scene-configuration[\s\S]*?  \/\/ @generated end claudion-attendance-scene-configuration\n\n/, "");
  if (contents.includes("configurationForConnecting")) {
    throw new Error("Review the existing AppDelegate scene configuration before adding attendance root reuse.");
  }
  if (!contents.includes("AttendanceBackgroundRuntime.shared.configure(")) {
    const launchReturn = "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
    if (!contents.includes(launchReturn)) {
      throw new Error("Review custom AppDelegate launch forwarding before adding attendance startup.");
    }
    contents = contents.replace(launchReturn, SETUP + launchReturn);
  }
  return contents;
}

function withAttendanceBackgroundRuntime(config, options = {}) {
  if (options.normalizeManifestOnly) {
    return withInfoPlist(config, (mod) => {
      normalizeSceneManifest(mod.modResults.UIApplicationSceneManifest);
      return mod;
    });
  }
  config = withInfoPlist(config, (mod) => {
    selectAttendanceScene(mod.modResults.UIApplicationSceneManifest);
    return mod;
  });
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("Attendance background startup requires the reviewed Swift AppDelegate.");
    }
    mod.modResults.contents = updateAppDelegate(mod.modResults.contents);
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    const name = mod.modRequest.projectName;
    const filepath = `${name}/${FILE_NAME}`;
    if (!mod.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath, groupName: name, project: mod.modResults,
      });
    }
    return mod;
  });
  return withDangerousMod(config, ["ios", async (mod) => {
    const source = path.join(mod.modRequest.projectRoot, "native/ios", FILE_NAME);
    const target = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName, FILE_NAME);
    await fs.promises.copyFile(source, target);
    return mod;
  }]);
}

module.exports = withAttendanceBackgroundRuntime;
module.exports.updateAppDelegate = updateAppDelegate;
module.exports.normalizeSceneManifest = normalizeSceneManifest;
module.exports.selectAttendanceScene = selectAttendanceScene;
