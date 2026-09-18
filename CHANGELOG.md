# Changelog

Release notes for the public Relayer repository. Dates use the release date recorded in Git.

## [0.2.0] — 2026-09-18

### Added

- Prepared the public fork for institution-controlled operation with sanitized fork/setup guidance, externalized operations documentation, and a container distribution path.
- Added first-administrator signup and the workspace setup wizard, including resumable setup, institution information, programs, worker invitations, and external-service guidance.
- Expanded the current workspace UI for schedules, participant information, case assignment, session editing and revision history, and consent management.
- Added the implemented AI, speech/STT, and document flows with consent gates, masking, human review, audit records, and retention handling.

### Changed

- The container serves the built web application and API together and applies pending migrations before starting the server. This documents distribution readiness; it does not claim a production deployment.

## [0.2.0-p1] — 2026-09-15

### Added

- Completed the real-data safety gate: separate personal-data and sensitive-information consent decisions, withdrawal handling, consent-copy hashes, and consent event records.
- Added access auditing, encryption for free-text records, and backup/restore rehearsal procedures.

### Changed

- Established the privacy, consent, audit, encryption, and backup controls required before moving beyond synthetic beta data.

## [0.1.0] — 2026-09-15

### Added

- Published the initial synthetic-data beta flow from participant registration and intake through scheduling, session recording, the short pre-session briefing, participant information, and case closure.
- Kept AI and STT outside the initial beta so the core record-and-review flow could be exercised without external processing.
