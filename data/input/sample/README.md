# FAKE SAMPLE DATA — NOT REAL PLAYERS OR CLUBS

This directory contains **fictional** sample data for exercising the M6
pipeline. Every club, manager, player and nation here is invented. No real
football data is present.

The `dataset.json` file sets `"sample": true`; the build propagates that marker
to every generated player, team, league and nation so the UI can label it.

Files:

| File | Purpose |
| --- | --- |
| `dataset.json` | Sample marker and human-readable label |
| `leagues.csv` | One fictional top-division league |
| `clubs.csv` | Three fictional clubs, 20 players each |
| `nations.csv` | Five fictional player nationalities |
| `players.csv` | Sixty fictional players with the full attribute set |
| `name_overrides.csv` | Two hand-picked public names |

Build and validate from the repository root:

```bash
pnpm data:build
pnpm data:validate
```

The build writes generated JSON to `data/`, placeholder SVGs to
`data/assets/`, and the name-mutation audit to `data/reports/`. Replacing this
directory with a real CSV export uses the same command; remove or set
`dataset.json.sample` to `false` and document the source licence before
shipping anything derived from it.
