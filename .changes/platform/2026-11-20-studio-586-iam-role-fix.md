# 2026-11-20 — Remove unsupported Studio IAM permission

Omit resourcemanager.projects.list from the project-level custom role after Google Cloud rejected it on creation. The role manifest still has no Storage grant and its digest changes for explicit review.

Validation: focused Studio workflow tests.
Deployment: none.
