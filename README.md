# Kamraw

Chennai photography and filmmaking booking platform. TypeScript monorepo with an Expo React Native customer/creator app, an Express API using TypeORM and PostgreSQL, and an operations, uploader and guest-gallery web application.

This deployment uses **demo accounts, illustrative pricing and simulated provider services**, as requested. No real payment, identity verification, emergency dispatch, SMS or printing transaction is performed. Use sample data only. Live mode requires verified provider integrations; unconfigured critical operations fail closed.

## Run locally

Use Node 22, npm and Docker. Install with `npm ci`.

For the packaged API and command centre, run `docker compose up --build`. PostgreSQL migrations and demo seed run before the API starts. Open `http://localhost:4000` for operations and `/app` for the browser version of the mobile app. The named database and media volumes persist across restarts. Local database credentials in Compose are disposable development values.

For development, copy each app's `.env.example` to `.env`, set its local API URL, start PostgreSQL, then run:

```sh
npm run build -w @kamraw/domain
npm run migrate -w @kamraw/api
npm run seed -w @kamraw/api
npm run dev:api
npm run dev:web
npm run start -w @kamraw/mobile
```

Run the worker separately with `npm run worker -w @kamraw/api`. For Expo's browser preview, use `npx expo start --web` from `apps/mobile`. Physical devices need the computer's LAN address in `EXPO_PUBLIC_API_URL`. Sign in with your phone using the displayed demo verification code, or open a sample customer/creator workspace. Kamraw manages its own sessions; no Auth0 tenant or native Auth0 module is required.

## Demo workspaces

The welcome screens select the sample accounts; no external credentials are required. API test identities use `Authorization: Bearer demo:<handle>` only when `APP_MODE=demo`.

| Handle | Role |
|---|---|
| customer | Customer |
| creator, creator2, creator3 | Verified sample creators |
| ops | Operations administrator |
| finance | Payout maker |
| approver | Separate finance approver |

Pricing and zone configuration are versioned. The maker cannot approve their own changes or payouts. Demo file verification maintains two local copies and **never grants permission to erase original camera cards**.

## Verification

```sh
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/kamraw_test npm test
npm run build
npm run export -w @kamraw/mobile
docker build -t kamraw-demo:local .
cfn-lint -t infra/demo.yaml -r ap-south-1
cfn-guard validate -d infra/demo.yaml -r infra/security.guard
```

Integration tests create and remove uniquely named databases, so the test database user needs `CREATEDB`. Without `TEST_DATABASE_URL`, the PostgreSQL integration suite is skipped; CI always supplies it. iOS/Android exports validate bundles, not signed native binaries or device behavior.

### Internal Android test APK

With Android Studio's JDK, Android SDK 36 and NDK 28.2.13676358 installed, set `JAVA_HOME` and `ANDROID_HOME` to those installations, then run from the repository root:

```sh
export EXPO_PUBLIC_API_URL=https://demo.kamraw.com
export EXPO_PUBLIC_APP_MODE=demo
cd apps/mobile
npx expo prebuild --platform android --no-install --skip-dependency-update react,react-native
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a \
  '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g' \
  --no-daemon --max-workers=2 --console=plain
```

The output is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. This ARM64 demo build uses the generated Android debug signing key and is for internal testing only. It includes its JavaScript bundle and connects to the deployed HTTPS demo without Metro. Store distribution requires a controlled release signing key. The build, native lint and APK signature verification passed on 1 October 2026; emulator/device behavior is still unverified.

## Deployment

`infra/demo.yaml` defines the AWS demo in Mumbai: one ARM application server, encrypted private PostgreSQL, ECR, a private build-artifact bucket, Secrets Manager, CloudWatch and GitHub OIDC. Caddy provides automatic HTTPS on a dedicated Route 53 subdomain. There is no SSH, NAT gateway or load balancer. The API database user is restricted to application tables; migrations run as a separate one-shot task.

The connected AWS Free Plan rejected seven-day backup retention; this demo uses one day and a single availability zone. Production requires a paid-plan configuration with at least seven-day backups, tested restore procedures, independent media redundancy and availability appropriate to the service commitments. Billing eligibility and credits depend on the account; this architecture is not a promise of zero cost.

The verification workflow gates the deployment workflow. Deployment builds an immutable commit-tagged ARM image, applies migrations over SSM, verifies local readiness and checks public HTTPS. Failed application readiness restores the previous image when available. Migrations must remain backward compatible; database rollback requires a tested snapshot restore.

`infra/deployment.json` is written only after AWS returns actual deployed resource references. See `docs/BUILD-STATUS.md` for verified results and remaining work.
