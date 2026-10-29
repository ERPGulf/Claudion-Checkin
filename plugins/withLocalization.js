const { withAndroidManifest } = require('expo/config-plugins');

/** Android is generated: retain explicit manifest support whenever prebuild runs. */
module.exports = function withLocalization(config) {
  return withAndroidManifest(config, next => {
    const application = next.modResults.manifest.application?.[0];
    if (application) application.$['android:supportsRtl'] = 'true';
    return next;
  });
};
