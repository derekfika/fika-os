# 2026-10-28 — Menu publication worker investigation

Documented incident #111's downstream cause: publication queues durable events, while the production Menu recovery scheduler remains deliberately paused from cutover. Added a bounded, read-only operator inspection script for the two affected publications, canonical orders, optional CPU plans and Delivered-In indexes. No application behavior, credentials, scheduler configuration or live business records changed.

Validation: script syntax check and production read-only inspection succeeded; authenticated invalid-limit worker probe returned expected HTTP 422 without delivery. Application tests/typechecks/builds are not applicable to this diagnostic-only change. Governed validation results are recorded in the incident report. Deployment: none. Operational activation and actual delivery verification remain pending owner authority; the incident is open.
