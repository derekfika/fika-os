# 2026-11-20 — Deliver approved Studio publications to staging Hub

The existing publication review can use the approved staging scope and current CPU evidence. Bind its confirmation across Studio instances and deliver only the persisted immutable bytes using the dedicated runtime. Record Hub's exact receipt separately from publication and activation. An interrupted delivery can retry the same package.

Validation: 51 Studio unit tests, six isolated Firestore tests, typecheck and build.
Deployment: none. Hosted publication remains disabled by default.
