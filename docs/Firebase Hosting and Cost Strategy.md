# Firebase Hosting and Cost Strategy

> **Classification: Supporting option and cost analysis; not an accepted technology selection.** This appendix preserves research conducted on 16 July 2026. Stage 6 deliberately selected no hosting platform, identity provider, database, storage model or deployment topology. Any future use of Firebase requires a separate governed technology-selection and implementation decision.

## Executive Appendix A

**Pricing reviewed:** 16 July 2026  
**Audience:** CEO, Operations Director, Finance, Marketing and Senior Management

This appendix explains why Firebase was evaluated as a possible hosting platform for FIKA OS and what that option could cost at FIKA's assumed scale.

No selection is authorised by this document. FIKA's business knowledge remains FIKA's own, independent of any technology supplier. The analysis indicates that Firebase could provide a comparatively low-overhead option if later governance selects it after requirements and alternatives are assessed.

## 1. Why Firebase?

FIKA OS is intended to improve operations, not create a new burden of server management. Firebase brings several of the services needed for a secure internal platform together under one managed service.

### Secure managed hosting

Firebase Hosting provides managed web hosting, secure connections and automatic security certificates. FIKA does not need to buy, configure or maintain its own web servers. Firebase also keeps previous website releases available for controlled rollback. [Firebase describes Hosting as production-grade hosting with built-in secure connections and managed certificates.](https://firebase.google.com/docs/hosting)

### Managed authentication

Firebase Authentication could provide a managed service for identifying and signing in authorised Legends. It handles the underlying sign-in service and established identity standards, potentially reducing the need for FIKA to build and maintain its own identity system. FIKA would remain responsible for deciding who should have access and what each role is allowed to do. [Firebase Authentication provides managed sign-in services and supports common identity providers.](https://firebase.google.com/docs/auth)

### Managed database

Firebase includes Cloud Firestore, a managed service for storing and retrieving operational information. Google manages the underlying infrastructure and capacity. FIKA remains responsible for the quality of its information, access rules, retention decisions and efficient use.

### Automatic scaling

The service can increase or reduce capacity as demand changes. FIKA does not need to purchase server capacity in advance or maintain spare infrastructure for occasional busy periods. This is particularly suitable for an internal platform whose use rises during business hours and falls outside them. [Google describes Firestore as a managed, serverless service designed to scale without customer-managed servers.](https://cloud.google.com/products/firestore)

### Managed backups and infrastructure

Cloud Firestore supports managed daily or weekly backup schedules with controlled retention. FIKA must deliberately enable these backups and agree the retention and recovery policy; backups are not a substitute for governance. The feature requires the Blaze plan and is charged according to the amount retained. [Firebase's backup service supports scheduled backups and states that backup storage and restores are chargeable.](https://firebase.google.com/docs/firestore/backups)

Google maintains the underlying hosting and data infrastructure. This removes routine server patching, hardware management and capacity planning from FIKA's operational workload.

### The business benefit

If selected later, Firebase could allow FIKA to focus more time on improving how Legends work rather than maintaining servers. That potential aligns with Positivity, Wellbeing and Cohesion, but this option analysis does not establish that Firebase is the only or preferred way to achieve those outcomes.

## 2. Expected FIKA Usage

The initial FIKA OS usage profile is expected to be:

- approximately **100 Legends** with access;
- approximately **50 daily active users**;
- usage concentrated almost entirely within normal business hours;
- an internal operational platform rather than a public consumer service;
- relatively small operational datasets;
- no large-scale public traffic;
- no video streaming;
- no artificial-intelligence workloads hosted by Firebase;
- low storage growth;
- moderate document reads and writes; and
- infrequent reporting rather than continuous large-scale analysis.

This represents a comparatively light Firebase workload.

Fifty daily users are unlikely to create sustained demand. Most activity will consist of Legends opening operational views, finding current information, recording changes and completing normal business tasks. Traffic should reduce significantly overnight and at weekends.

For cost-planning purposes, a reasonable working illustration is:

- each active Legend causes up to **300 information reads per working day**;
- each active Legend causes up to **50 information writes per working day**;
- 50 active Legends therefore cause approximately **15,000 reads and 2,500 writes per working day**; and
- a typical month contains approximately **22 working days**.

These figures are planning assumptions, not usage targets. Actual usage must be measured. They deliberately allow more activity than many Legends are likely to generate while remaining well below Firebase's published daily free allowances.

## 3. Estimated Costs

Firebase offers two pricing plans.

### Spark Plan

Spark is the no-cost plan. It requires no payment details and includes free allowances for Hosting and Cloud Firestore. It is well suited to early development, demonstrations and low-risk testing.

Spark has an important operational limitation: when a paid service reaches its no-cost allowance, that service can be stopped until the allowance resets or the project is moved to Blaze. Spark also does not provide access to every paid capability. Cloud Storage for Firebase now requires Blaze, even though some storage usage may still be free once Blaze is enabled. [Firebase explains the Spark limits and the risk of service shut-off after an allowance is exceeded](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), and [its current Storage policy requires the Blaze plan](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

Spark could be useful for controlled non-production evaluation, but this document does not authorise its use or determine the long-term production plan.

### Blaze Plan

Blaze is the pay-as-you-go plan. It has no fixed Firebase subscription fee. It retains Firebase's relevant no-cost allowances and charges only for eligible usage above them. It also enables managed backups, Cloud Storage and other services that may be required for a dependable production platform. [Firebase's official plan comparison confirms that Blaze retains no-cost quotas and charges for additional usage.](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

If Firebase were selected, Blaze would be the stronger production-plan candidate because it provides continuity if usage exceeds a free allowance. This is a conditional cost-analysis conclusion, not production-plan authority. Cost would depend on actual usage and would require active budget and usage governance.

### Expected monthly position

| Service | Current published allowance or price | Expected FIKA position |
|---|---|---|
| Firebase Hosting storage | 10 GB at no cost; then US$0.026 per additional GB | Expected to remain within the allowance. |
| Firebase Hosting data transfer | 10 GB per month at no cost; then US$0.15 per additional GB | Expected to remain within the allowance for a lightweight internal platform. |
| Standard authentication | Most common sign-in options are available at no cost; an upgraded service allows up to 50,000 monthly active users before charges for standard providers | Approximately 100 Legends is far below the published allowance. Phone text-message sign-in is excluded from this estimate. |
| Cloud Firestore reads | 50,000 reads per day at no cost | Planning assumption: approximately 15,000 reads per working day. Expected to remain within the allowance. |
| Cloud Firestore writes | 20,000 writes per day at no cost | Planning assumption: approximately 2,500 writes per working day. Expected to remain within the allowance. |
| Cloud Firestore deletes | 20,000 deletes per day at no cost | Expected to be very low. |
| Cloud Firestore data | 1 GiB stored at no cost for one database | Expected to remain within the allowance initially; growth must be monitored. |
| Managed backups | No free allowance; charged by retained backup size and restores | Expected to be a small charge for a small operational dataset, but it must be budgeted. |
| File storage | Blaze required; charges and free allowances depend on storage location and bucket type | Expected to be low, but documents and generated files must be monitored separately. |

The Hosting figures are published in the [Firebase Hosting pricing guidance](https://firebase.google.com/docs/hosting/usage-quotas-pricing). The database allowances are published in the [Cloud Firestore billing guidance](https://firebase.google.com/docs/firestore/pricing). Authentication allowances are published in the [Firebase Authentication guidance](https://firebase.google.com/docs/auth).

### Cost estimate for FIKA

Based on the stated usage profile:

- **Hosting:** expected to be **US$0 per month** within the free allowance.
- **Authentication:** expected to be **US$0 per month**, assuming standard sign-in and no phone text-message charges.
- **Routine database use:** expected to be **US$0 per month** within the daily free allowances.
- **Database overage:** even a material increase above the planning assumption should normally remain measured in cents or low single-digit dollars at this scale. Published starting prices are approximately US$0.03 per 100,000 reads, US$0.09 per 100,000 writes and US$0.01 per 100,000 deletes beyond the free allowance, although the selected data location affects the exact rate. [Google Cloud publishes the location-specific Firestore prices.](https://cloud.google.com/firestore/pricing)
- **Backups and file storage:** expected to range from cents to a few dollars per month while datasets remain small. The exact amount will depend on data location, volume and retention policy.

The expected normal Firebase cost is therefore approximately **US$0–5 per month** during the initial operating period.

For financial planning, FIKA should allow a more conservative **US$10–25 per month**. This is not the expected bill. It is a prudent operating allowance for backups, file storage, occasional overages, regional price differences, currency conversion and usage variation.

If FIKA later introduces public traffic, heavy reporting, large file libraries, phone text-message authentication, extensive automated processing or materially larger datasets, the estimate must be reviewed.

All published prices are subject to change. Firebase charges in the billing account's applicable currency, and taxes or exchange rates may affect the final amount. Exact costs depend on future usage patterns and the services, data location and retention policies ultimately approved.

## 4. Cost Controls

Low expected cost does not remove the need for financial control. The following governance should apply from the beginning.

### Budget alerts

Create monthly billing alerts at deliberately low levels so Finance and the platform owner receive early warning of unexpected growth. Budget alerts notify FIKA; they do not automatically cap charges. Firebase explicitly recommends alerts for Blaze projects. [Firebase's billing guidance explains this limitation.](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

### Usage monitoring

Review Hosting, authentication, database, backup and file-storage usage regularly. Early reviews should be monthly until a stable baseline is established. Significant changes should be explained by genuine business activity or investigated.

### Quota monitoring

Monitor reads, writes, storage, data transfer and any automated processing against their allowances. The purpose is not simply to stay free; it is to identify inefficient or unexpected behaviour before it becomes an operational or financial problem.

### Environment separation

Keep development, testing and production activity separate. This makes costs easier to understand, protects live information and prevents testing from creating misleading production usage.

### Production-only scaling

Only the live environment should be allowed to scale in response to genuine operational demand. Test environments should remain deliberately small and controlled.

### No unnecessary Cloud Functions

Do not introduce automated background processing merely because it is available. Every automated function should have a confirmed business purpose, clear ownership and monitored usage. Avoiding unnecessary processing reduces cost and operational complexity.

### Minimise document reads

Operational views should retrieve only the information a Legend needs for the task. Repeatedly reloading unchanged information, retrieving large lists or running unnecessary live updates creates avoidable cost and can reduce performance.

### Efficient data modelling

FIKA's information should be organised so that common tasks are simple and direct. Efficient design reduces repeated reads, duplicated storage and unnecessary processing while making the platform easier for Legends to trust.

Together, these controls keep cost visible and proportionate. They also reinforce Positivity, Wellbeing and Cohesion by preventing hidden waste, protecting dependable operations and ensuring that FIKA's investment remains focused on value for Legends and the business.

## 5. Executive Conclusion

FIKA OS is intentionally designed as a lightweight internal operational platform.

With approximately 100 Legends, around 50 daily active users, business-hours usage, small datasets and no consumer-scale media or artificial-intelligence workload, Firebase usage should be comparatively light.

Within the Firebase option, the Blaze pay-as-you-go plan appears more suitable for production evaluation than Spark because it retains relevant free allowances, reduces free-limit interruption risk and provides access to managed backups and file storage. No Firebase plan is selected or authorised here.

Based on the current assumptions, normal Firebase infrastructure costs are expected to be approximately **US$0–5 per month**, with a prudent planning allowance of **US$10–25 per month**. This should remain comfortably within FIKA's financial capability, provided usage is governed and monitored.

The objective is not simply to minimise the bill. It is to build a platform whose operational value significantly exceeds its hosting cost: less repeated administration, clearer shared information, more dependable operations and more time for Legends to focus on brilliant work.

Exact costs would depend on future usage, data location, retention and service choices. If Firebase is later selected, the estimate should be refreshed before approval and reviewed against actual billing data after launch.
