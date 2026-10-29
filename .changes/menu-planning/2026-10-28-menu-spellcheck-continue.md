# 2026-10-28 — Menu Planning: en-GB dictionary spellcheck (checkpoint)

The spellcheck now has a genuine en_GB speller on top of the known corrections. Unknown words that have a sensible
suggestion are flagged with up to five ranked UK suggestions. Acronyms, numbers, CamelCase, names with no suggestion and
other apostrophe forms are not judged, which keeps false positives low on culinary and brand names. The speller is
built from the pinned `dictionary-en-gb` 3.0.0 package (SCOWL word lists, licence MIT AND BSD) plus a FIKA culinary word
list, and packaged as a gzip payload with a sha256 checksum (`dictionary/en-GB-3.0.0-culinary-1.*`). The payload is
verified before decompression and is never sent to a third party.

Not yet in this change: Firestore distribution and caching, the Replace action and canonical dish governance, the copy-control
removal, and browser validation. Those remain open on PR #98.

Validation: typecheck clean; Menu Planning suite 326 of 326, including 17 new dictionary and spellcheck tests (British and US
forms, culinary terms, unknown misspellings, casing, apostrophes, integrity checks). On a 10-line sample of real-style dish names, 11 false-positive words were flagged before the culinary list was extended and none after; the sample also shaped that list, so the real rate is
not yet measured.
Deployment: none.
