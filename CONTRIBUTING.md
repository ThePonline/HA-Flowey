# Contributing

Thanks for helping to improve HA Flow Builder! Bug reports, ideas and pull requests are welcome.

## Reporting a bug

Open an [issue](https://github.com/ThePonline/HA-Flowey/issues/new/choose) with:

- the HA Flow Builder and Home Assistant versions,
- what you did, what you expected and what happened,
- the automation YAML of the flow (*YAML* button in the editor), with secrets such as webhook ids removed,
- errors from the browser console or the Home Assistant log, if any.

## Development setup

Frontend (Node 24):

```bash
cd frontend
npm ci
npm test
npm run build
```

Backend (Python 3.14):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements_test.txt
pytest
ruff check . && ruff format .
```

To try a change in a real Home Assistant, link or copy `custom_components/ha_flow_builder` into its `config/custom_components/` and restart Home Assistant after every build.

## Pull requests

- Keep a pull request focused on one change and describe why it is needed.
- Add or update tests: the compiler in `frontend/tests/`, the integration in `tests/`.
- Commit the rebuilt bundle (`custom_components/ha_flow_builder/static/`); CI checks that it matches the sources.
- Add a line under *Unreleased* in [CHANGELOG.md](CHANGELOG.md) for anything users will notice.
- UI texts are written in Dutch in the code and translated in `frontend/src/i18n-en.ts`; add the English text for every new string.

## Licensing of contributions

HA Flow Builder is dual-licensed under the AGPL-3.0 and a commercial license (see the [README](README.md#license)). To keep that possible, the project needs to be able to license your contribution under both.

By opening a pull request you confirm that:

1. the contribution is your own work, or you have the right to submit it, and
2. you license it under the AGPL-3.0 **and** grant ThePonline a perpetual, worldwide, non-exclusive, royalty-free license to use, modify and relicense it, including under commercial terms.

You keep the copyright of your contribution.

## Releasing (maintainers)

1. Update the version in `custom_components/ha_flow_builder/manifest.json`, `frontend/package.json` (`npm version X.Y.Z --no-git-tag-version`) and `pyproject.toml`.
2. Rebuild the bundle and move the *Unreleased* changelog entries under the new version.
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
   The release workflow checks the versions and publishes the GitHub release with the changelog section as notes.
