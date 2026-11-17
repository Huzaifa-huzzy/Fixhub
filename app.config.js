const appJson = require('./app.json');

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const iosUrlScheme = iosClientId
    ? `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`
    : null;
  const plugins = (config.plugins ?? []).filter((plugin) => (
    ![
      '@react-native-google-signin/google-signin',
      'react-native-maps',
    ].includes(Array.isArray(plugin) ? plugin[0] : plugin)
  ));

  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-video')) {
    plugins.push('expo-video');
  }

  if (googleMapsApiKey) {
    plugins.push([
      'react-native-maps',
      { androidGoogleMapsApiKey: googleMapsApiKey },
    ]);
  }

  if (iosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme },
    ]);
  }

  return {
    ...config,
    ...appJson.expo,
    plugins,
  };
};
