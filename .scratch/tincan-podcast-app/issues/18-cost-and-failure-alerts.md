# 18: Cost and failure alerts

**What to build:** The owner gets an email if TinCan starts costing money or if its backend starts failing, so neither goes unnoticed in an app nobody else is watching. (Spec story 59; spec Delivery section.)

**Blocked by:** 02

**Status:** done

**Human step:** the owner must confirm the alert email subscription from their inbox. Say when that confirmation has been sent.

- [x] The owner is emailed when monthly AWS spend passes a threshold, 5 US dollars by default
- [x] The owner is emailed when a backend function fails repeatedly
- [x] Failure alerts cover every backend function that exists, and functions added later are covered without extra work
- [x] The alerts are defined in the backend code and deployed by the pipeline
- [x] The owner's email address is supplied as configuration and is not committed to the repo
- [x] The README lists the alerts and how to change their thresholds
