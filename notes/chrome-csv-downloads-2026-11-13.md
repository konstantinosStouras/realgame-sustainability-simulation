# Chrome CSV download verification — 13 November 2026

**Student reports and financial ledgers downloaded successfully in actual Chrome.** Each saved file was parsed and compared field by field with the synthetic classroom state. No application export defect was reproduced, so the export implementation was left unchanged.

This resolves the download-verification limitation in the earlier [student-experience report](chrome-student-experience-2026-11-13.md). The automation's download-event wait did not produce a file path while Chrome's native Save As dialog was awaiting completion. Bringing the Chrome test tab into view and completing that dialog produced normal completed downloads. A timeout alone was not evidence that CSV generation had failed.

## Method and results

A separate synthetic classroom contained three companies, ten completed daily reports, and 128 financial transactions. A synthetic student signed into the public GitHub Pages site using the live Firebase backend. The browser release was `1d4ffbd8ac92`. Exports were initiated through the normal report and finance buttons, saved through Chrome's native Save As dialog, then read from disk. No test file was fabricated from expected data.

| Export | Data rows (excluding header) | Actual file bytes | Result |
| --- | ---: | ---: | --- |
| Cumulative profit, all three companies, ten completed days | 30 | 1,429 | Exact match |
| Cumulative profit, all three companies, last seven days | 21 | 1,021 | Exact match |
| Cumulative profit, one selected company, last seven days | 7 | 462 | Exact match |
| Complete financial journal | 269 account postings from 128 transactions | 17,799 | Exact match; balanced to the cent |

The financial CSV included all transactions, exceeding the latest 100 entries shown on screen. Checks also verified headers, UTC dates, report selection, positive and negative numeric amounts, cent precision, and debit/credit balance. A company name containing a comma, quotation marks, an em dash, and a Greek character round-tripped correctly. A formula-like company name was escaped without turning negative financial values into spreadsheet text.

The existing eight focused export tests passed. This check verifies Chrome download completion and CSV contents; it does not claim that every spreadsheet application's automatic import settings were tested.

The synthetic browser tab was closed. Its classroom, membership/invite/request records, and both temporary Firebase identities were removed with cleanup checks passing. Only synthetic exported files were retained locally as evidence. Real student sessions and the original user tab were not modified.
