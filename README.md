# Baseline

A weekly-floor fitness tracker that installs to a phone's Home Screen.

- **Today**: tap sessions, press-up and pull-up sets, and food targets. The chart at the top shows the week against its floor.
- **Weeks**: day-by-day grid, weekly check-in (weight and waist) and every past week's verdict.
- **Trends**: weight and waist with 4-week averages, plus VO2 max, resting HR and body fat.
- **Setup**: sync, the Apple Health Shortcut guide and appearance.

Single HTML file, no build step, no third-party requests. Works offline; changes queue and sync later.

## Where the data lives

This repository holds the page only and no personal data. Logs, targets and plan dates are stored in a separate private repository as `data.json`, read and written through the GitHub API with a fine-grained token that is pasted once per device and kept in that device's local storage.

Apple Health figures arrive as small text files in the private repository's `inbox/` folder, posted by an iPhone Shortcut. The page merges them into `data.json` and deletes them.

## Updating

Bump `CACHE` in `sw.js` and `VERSION` in `index.html` together when `index.html` changes, so installed copies pick up the new version.

Font: Archivo (SIL Open Font License, see `fonts/OFL.txt`).
