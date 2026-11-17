# Fixhub

A mobile-first marketplace MVP for finding local service professionals and businesses. The app supports demo browsing without backend credentials; authentication and persistent listings require a Supabase project.

## Run locally

1. Install Node.js 20 or newer.
2. Install project dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set your Supabase project URL and **anon/publishable** key. Never put a Supabase service-role key in the app.
4. Apply the SQL migrations in `supabase/migrations/` in filename order in the Supabase SQL Editor. They create the app schema, sync verified Auth phones (optional), add provider contact phone numbers for direct dialer calls, create the nearby-provider map query, and enable offline provider status synchronization with presence/location timestamps.
5. To enable Google sign-in, create an OAuth 2.0 Web client in Google Cloud Console. Add `https://eedveikxslkulkhoatyt.supabase.co/auth/v1/callback` as an authorized redirect URI. This is Google's callback to Supabase; Supabase then redirects to the app URL passed as `redirectTo` in `src/screens/AuthScreen.tsx`. In Supabase **Authentication → Providers → Google**, enable Google and enter the Google client ID and client secret.
6. In Supabase **Authentication → URL Configuration**, allow `http://localhost:8081/auth` for Expo web development, `serviceconnect://auth` for development/production native builds, and `exp://**/--/auth` when testing in Expo Go. Set your deployed web app's `/auth` URL as an additional exact redirect URL for OAuth and password recovery links.
7. For native Google sign-in, add the Google Web OAuth client ID to `.env.local` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, and an iOS OAuth client ID as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. For Android, register an Android OAuth client in Google Cloud with package `com.serviceconnect.app` and the SHA-1 fingerprint for each build signing key. Add the iOS OAuth client in Google Cloud for the app's bundle identifier. These OAuth client IDs are public identifiers, not client secrets.
8. For Android maps, enable **Maps SDK for Android** in Google Cloud, create an API key restricted to Android app `com.serviceconnect.app` and your signing certificate SHA-1, and set it as `GOOGLE_MAPS_API_KEY` in `.env.local` or EAS environment variables. Do not commit the key. Expo injects it into the native manifest through `app.config.js`.
9. Rebuild and reinstall a development/production app after installing native modules, changing OAuth client IDs or the Maps API key, or changing native app configuration; restarting Metro does not update an installed app. This includes the location permission text and Android keyboard-resize behavior configured in `app.json`. Report video previews use `expo-video`, so install a new Fixhub build to preview videos. `@react-native-google-signin/google-signin` does not work in Expo Go. Run `npm run android` to start Metro for an installed Android development build, or `npx expo run:ios` with an iOS development build; `npm run web` continues to use Supabase browser OAuth.

Provider availability changes are persisted on-device and synchronized automatically when internet access returns or the provider app is reopened. The map shows server-synchronized service availability separately from connectivity; a provider is considered online only while a server heartbeat is less than three minutes old. Existing providers without a recorded location timestamp are shown with an unavailable timestamp rather than a guessed update time.

Users register with a unique sign-in name, password, and required recovery email. Sign-in uses the name; password reset uses the account email address. For development/testing, turn off **Authentication → Sign In / Providers → Email → Confirm email**; registration then creates an authenticated session without sending a confirmation email. Password recovery sends a reset link to the email address; opening a valid link in the app lets the user choose a new password. Configure custom SMTP before relying on password recovery or launching to production. Re-enable email confirmation for production once email delivery is configured. Allow the app callback URLs listed above. Apply pending SQL migrations in filename order, including `202611050004_username_password_auth.sql`, `202611060001_username_registration_rate_limit.sql`, and `202611060002_username_auth_rate_limits.sql`. Deploy the public sign-up, login, and password-reset functions with JWT verification disabled; leave JWT verification enabled for the authenticated email-update function:

```sh
supabase functions deploy register-username --no-verify-jwt
supabase functions deploy username-login --no-verify-jwt
supabase functions deploy request-username-password-reset --no-verify-jwt
supabase functions deploy update-recovery-email
```

Supabase supplies the server-side service-role key and anon key to Edge Functions; never add the service-role key to the app or expose it. Registration is limited to five attempts per IP per hour; username login and email-based password recovery also have per-IP/account limits. Login names are unique, 2–50 characters, and cannot be changed. New accounts then choose a service-taker or provider role; their login name is prefilled and locked in profile setup. Earlier username/password accounts use non-deliverable `.invalid` addresses; while signed in, add and verify a recovery email in Profile before relying on password reset. Google accounts remain accessible with Google. Profile's Saved accounts section lets users add accounts and switch between saved accounts without signing in again. Account refresh tokens use AsyncStorage on native devices and browser storage on web. Providers can separately enter up to two public contact numbers in Profile; when they enable direct calls, customers' Call buttons open the device dialer with those numbers. These contact numbers are not used for authentication.

The tab header includes an English/Urdu language toggle. The selected language is saved on the device.

Authentication and live listings require `.env.local` to be configured with a Supabase project. Google sign-in is available after its Google Cloud and Supabase provider configuration is complete.
The browser version uses a provider list in place of the native map; the interactive map is available on iOS and Android.

## Included MVP flows

- Recovery-email account registration with name/password sign-in, Google sign-in, password recovery, and saved-account switching
- First-login choice between service taker and provider; providers complete their category, bio, experience, and service radius before entering the app, while takers go straight to Search
- Provider category, bio, availability, profile photo, and task-wise pricing management
- Provider search by category/text, availability, rating, price and distance filters, a mobile map, and provider detail/contact actions
- Direct calls only for providers who explicitly enable public calling in their database profile
- Direct phone calls to providers who enable public calling
- Two-way reviews after a completed job, with profile rating summaries
- Business listing creation and owner-controlled visibility
- RLS-protected profiles, provider listings, services, businesses, reviews, reports, and media buckets
- Manual provider CNIC and selfie review with private documents, verified-only discovery/availability, and role-aware notifications
- A visible direct-payment disclaimer; the app does not process payments or take commissions

## Backend notes

- The migration seeds the starter service categories and creates the `public_profiles` view, chat helper functions, storage buckets, policies, and Realtime publication entry.
- Public provider discovery exposes profile name/avatar and service information, but never exposes account phone numbers through table reads. Phone access is available only through the opt-in `get_public_provider_phone` function.
- To bootstrap the first admin, set an existing user's `profiles.role` to `admin` from the Supabase SQL Editor. Admin status changes are not available in the client.
- For CNIC verification, apply `202611100001_provider_cnic_verification.sql`, `202611100002_provider_cnic_selfie.sql`, `202611100003_verified_inactive_provider_directory.sql`, `202611100004_nearby_providers_rpc.sql`, and `202611100005_map_providers_viewport_rpc.sql` after the existing migrations. These migrations create the private `cnic-documents` bucket and role-checked RPCs. Providers submit both CNIC sides and a selfie; the documents are visible only to their owner and admins, with admins using short-lived signed URLs. Existing submissions must be resubmitted with a selfie before review. Providers must be approved before appearing in taker search or enabling availability. The map uses `map_providers` to return active, verified providers in the current viewport without a distance cutoff. Never make the CNIC bucket public.
- Apply `202611150001_realtime_notifications.sql` for persistent, role-scoped notifications, read state, preferences, event triggers, and Realtime publication, followed by `202611160001_reload_notification_schema.sql`. If the app reports that `public.notifications` is missing from the schema cache, apply the notifications migration if it has not been applied yet; if it is already applied, run `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor and reopen Notifications. The triggers currently cover new chat messages, submitted reports and report status changes, provider registration, and provider CNIC/selfie submission and review decisions. The app does not currently have a booking table or booking workflow, so booking notifications must be connected when those workflows are introduced.
- Deploy the push sender and set a private webhook secret. Use the same randomly generated value for the Edge Function secret and the Database Webhook Authorization header:

  ```sh
  supabase secrets set NOTIFICATION_WEBHOOK_SECRET=<random-secret>
  supabase functions deploy send-notification-push --no-verify-jwt
  ```

  In Supabase **Database → Webhooks**, create an `INSERT` webhook for `public.notifications` targeting `https://<project-ref>.supabase.co/functions/v1/send-notification-push`. Add `Content-Type: application/json` and `Authorization: Bearer <random-secret>` headers. The function checks this secret, claims each notification once before sending, honors the recipient's push preference, and removes tokens Expo reports as unregistered. Database notifications remain available in-app if push is disabled or fails; Supabase Realtime updates the bell count and notification list as events arrive.
- Push requires Expo/EAS Android FCM and iOS APNs credentials for the build, and a new native build after native notification configuration changes. Users can enable or disable push per account and register each device from Notifications. Android remote push requires a development or production build (not Expo Go); Expo Go on iOS is not a substitute for testing the signed app's APNs setup. Optionally set the `EXPO_ACCESS_TOKEN` Edge Function secret if your Expo project requires authenticated push requests.
- Android map builds require a Google Maps API key configured via `GOOGLE_MAPS_API_KEY`. Restrict it to the app package and signing certificate SHA-1, and do not commit it.
- Report moderation, automatic inactivity, provider portfolio management, business-provider linking, and full Urdu/English localization remain follow-up work.

## Validation

- `npm run typecheck`
- `npx expo lint`
- `npx expo-doctor`
