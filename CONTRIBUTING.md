# Contributing

Focused issues and pull requests are welcome. Describe the observed behavior, expected behavior, browser/OS, and a minimal synthetic reproduction. Never post real sensitive experiments, private backups or personal identifiers.

Run the core tests and syntax checks documented in the README. For UI or persistence changes, run the browser acceptance suite too. It uses a fresh temporary browser context and synthetic data. Avoid dependencies in the runtime unless the benefit is clear and discussed.

Preserve version-1 backup compatibility. Changes to grouping, uncertainty calculations, CSV coercion, or numeric interpretation need explicit documentation and tests. Do not silently add interpolation, imputation or inferential claims.

Keep destructive actions explicit, retain multi-tab revision protection, and update both language READMEs when behavior changes. The screenshots must show synthetic data only.

For security-sensitive findings, use GitHub's private vulnerability reporting when enabled or a contact method provided on the maintainer's profile. Do not publicly disclose private datasets to demonstrate a vulnerability.
