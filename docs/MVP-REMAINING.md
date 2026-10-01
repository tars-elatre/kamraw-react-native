# Remaining MVP work

This is a working gap list against the supplied PRD, not a claim of complete coverage. The deployed product is an explicit demo. Keep the goal active while implementable gaps remain.

## Implementable product gaps

- Complete English/Tamil UI copy beyond the current translated labels, help articles and notification templates.
- Self-service tier/date alternatives during a dispatch delay. Waiting/full refund is implemented; other changes currently direct customers to support.
- Media gallery selection downloads, video player/streaming, richer album layouts and print-defect photo attachments. Owner ZIP downloads, individual files, share APIs and basic album proof/fulfilment flows are implemented.
- Broader creator onboarding inputs, operational reporting, and a friendlier configuration editor.
- Verify trip/completion, uploads, QC, gallery, prints, recovery and wallet flows in the deployed UI. Current API tests cover these services; public browser verification covers creator acceptance, booking/reschedule/payment history and phone sign-in with session restoration.

## Launch dependencies and infrastructure work

- Real SMS verification, staff MFA provisioning, payment, KYC, maps/traffic, messaging/masked calls and print-provider accounts. User explicitly requested demo credentials; these services must stay labeled as simulations until connected.
- Legal billing identity, approved rates/tax/policies, GST invoices/credit notes, and a commercial credit expiry policy. Current PDFs are clearly labeled demo statements.
- Independent durable media storage and restore checks. Demo uploads use two same-host copies, are capped at 50 MB per card and never authorize memory-card erasure.
- Native device QA, release signing and store delivery. Android/iOS/web JavaScript bundles and an internal ARM64 Android APK build successfully. The APK uses a debug certificate; native interaction remains unverified because Android Studio controls did not respond. Full Xcode and release-signing accounts are not available.
- Operational staffing, monitoring response, recovery drills and production backup retention. The current AWS Free Plan permits only one-day RDS backups; a paid plan is needed for the proposed seven-day retention.
