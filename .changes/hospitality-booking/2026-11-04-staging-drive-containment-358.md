# 2026-11-04 — Hold unverified staging Drive artifacts

The shared Drive token provider blocks Hospitality staging menu, quote and matrix Drive access until the staging destination and ACL boundary is verified. Production and local token paths are unchanged.

Validation: seven related Hospitality tests passed; three existing matrix route tests still expect staging Drive calls and fail under this hold. Hospitality typecheck and Next build passed using checked-in generated assets without rerunning the generator. No Drive writes were performed.
Deployment: none.
