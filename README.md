# CrateLite

CrateLite is a lightweight VS Code extension for editing `Cargo.toml`. It adds fast, focused completion for Rust dependencies without trying to be a full Cargo assistant.

## Features

- Crate name completion inside dependency sections
- Latest version completion from a cached crate index
- Feature completion inside `features = []`
- Local index caching for quick suggestions after the first download

## Usage

Open a `Cargo.toml` file and start typing in `[dependencies]`:

```toml
[dependencies]
ser
serde = "1"
tokio = { version = "1", features = ["rt-", "mac"] }
```

CrateLite will suggest:

- matching crate names like `serde`
- the latest known version for a crate
- available feature names for inline dependency tables

## Settings

- `cratelite.indexUrl`: URL of the compressed crate index file
- `cratelite.maxSuggestions`: maximum number of crate suggestions
- `cratelite.minTriggerLength`: minimum typed characters before crate suggestions appear
- `cratelite.featureIndexBaseUrl`: base URL for feature metadata lookups

## Notes

- The crate index is downloaded on first use and then cached locally.
- Feature suggestions may require network access to fetch crate metadata.
- This extension is focused on `Cargo.toml` editing.
