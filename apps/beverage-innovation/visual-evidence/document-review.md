# Local document review — 7 November 2026

`document-review-desktop.png` (1448 × 1086) and `document-review-tablet.png` (1024 × 768) show the local development review of fictional DOCX and PPTX fixtures. The lower-left Next.js indicator is development-only. These are not staging captures or owner visual approval.

Chromium keyboard journeys covered source selection, focusing the file input, simulated file selection, previewing two candidates, selection, editing, confirmation and local draft creation for DOCX, PPTX and PDF. The DOCX run simulated a lost response after the emulator accepted the first commit; the retry sent the same file bytes, review and key and returned the same record. A same-name, same-size replacement and a switch to pasted text invalidated the preview. Signature and oversize failures were displayed; the 390px layout had no page overflow. No browser storage entries or requests outside localhost were observed.
