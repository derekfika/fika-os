# Hospitality public catalogue package

Hospitality Booking reads the governed global catalogue from the Hub's published package store. The Hub retains its private package, including CPU routing. A public booking projection is published alongside it with only booking fields; it omits CPU routing and internal Hub metadata.

The public package endpoints are bridge-authorized and are called server-to-server by Hospitality. The browser talks only to Hospitality's same-origin manifest and immutable gzip routes. Those routes read package storage through Hub and never query Firestore. The browser verifies compressed-byte SHA-256, parses the package, resolves the current OPLOC through the shared effective-offering resolver, and caches it in the Hospitality-owned versioned IndexedDB database.

## Release/bootstrap sequence

1. Deploy the validated Hub SHA to staging.
2. From the validated Hub checkout, run `npx tsx scripts/hospitality-catalogue-package-bootstrap.ts --project=fika-os-dev` with staging credentials. This explicit release action reads current canonical catalogue data and routing, then writes the private and public derived packages to the configured read-package bucket. It does not mutate Firestore. A normal GET never builds or repairs a package.
3. Confirm the public manifest is present, its dataset is `hospitality-booking/catalogue`, and its package hash is reachable.
4. Deploy the same validated SHA to Hospitality staging.
5. Verify cold and warm public portal loads and confirm catalogue requests do not invoke a Firestore catalogue route.

If package publication fails, stop the Hospitality rollout. Do not add a request-time Firestore fallback. Rebuild through the explicit authenticated release action after resolving the publication failure.
