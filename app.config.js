module.exports = ({ config }) => {
  const apsEnvironment =
    process.env.IOS_APS_ENVIRONMENT ||
    (process.env.EAS_BUILD_PROFILE === "production"
      ? "production"
      : "development");

  return {
    ...config,
    ios: {
      ...config.ios,
      entitlements: {
        ...(config.ios?.entitlements ?? {}),
        "aps-environment": apsEnvironment,
      },
    },
  };
};
