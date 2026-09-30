# Architecture and operational boundaries

Requests flow through routes, controllers, services and repositories to TypeORM/PostgreSQL. The shared domain package owns validation, pricing, scheduling, geographic checks, lifecycle rules and matching scores. Authentication and permission middleware enforce ownership and staff permissions before protected services run.

PostgreSQL supplies row locks for first-accept dispatch, exclusion constraints for overlapping creator assignments, immutable audit and ledger triggers, deferred balance validation, unique webhook IDs and replay-safe device events. Quotes expire after ten minutes and retain their pricing version. Payment confirmation revalidates the minimum scheduling lead time.

Demo provider settlement consumes an outbox transactionally. Financial transactions are explicitly marked simulated. Uploads use opaque filesystem keys, monotonic chunk offsets and a full SHA-256 verification before a second copy is checked. Two copies on one server do not satisfy the PRD's separate-zone guarantee. Production object storage remains a required integration.

Gallery file tickets are scoped to one asset, expire in five minutes and are checked against current share revocation and gallery retention on every fetch. The signing key rotates on process restart; clients refresh tickets after restart. A single API process is used for this demo. Multiple instances require a shared rotating signing key and durable object storage.

AWS secrets are resolved inside the runtime, never baked into images or fetched into this repository. Application logs do not include authorization headers, personal payloads or database errors. The EC2 instance profile can access its two database secrets for the deployment bootstrap; stronger production isolation should separate the migration execution role from the application role. The application connects as the restricted database role.

Operations and demo customer accounts are deliberately public sandbox identities. Do not store actual client galleries, contact details or financial records in this demo. Live mode requires Auth0, staff MFA claims and real provider configuration.
