const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_CONFIG = `
        release {
            def questKeystorePath = System.getenv("QUEST_ANDROID_KEYSTORE_PATH")
            if (questKeystorePath) {
                storeFile file(questKeystorePath)
                storePassword System.getenv("QUEST_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("QUEST_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("QUEST_ANDROID_KEY_PASSWORD")
            }
        }`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "groovy") {
      throw new Error("Quest Admin release signing currently supports Groovy Gradle files only.");
    }

    let contents = nextConfig.modResults.contents;
    if (!contents.includes("QUEST_ANDROID_KEYSTORE_PATH")) {
      contents = contents.replace(
        /signingConfigs\s*\{\s*debug\s*\{/,
        (match) => `signingConfigs {${SIGNING_CONFIG}\n        debug {`
      );
      const buildTypesStart = contents.indexOf("buildTypes {");
      const releaseStart = contents.indexOf("release {", buildTypesStart);
      if (buildTypesStart === -1 || releaseStart === -1) {
        throw new Error("Could not locate the Android release build type.");
      }
      const beforeRelease = contents.slice(0, releaseStart);
      const releaseBlock = contents
        .slice(releaseStart)
        .replace("signingConfig signingConfigs.debug", "signingConfig signingConfigs.release");
      contents = beforeRelease + releaseBlock;
    }
    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};
