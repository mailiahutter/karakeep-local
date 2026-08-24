module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      // Doit rester en dernier.
      "react-native-worklets/plugin",
    ],
  };
};
