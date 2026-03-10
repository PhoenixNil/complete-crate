import assert from "node:assert/strict";
import test from "node:test";
import {
  getCrateNameContext,
  getFeatureCompletionContext,
  isTypingCrateName,
  type TextRange,
} from "./tomlParser";

function parseMarkedText(markedText: string): {
  text: string;
  cursorOffset: number;
} {
  const normalized = markedText.replace(/\r\n/g, "\n");
  const cursorOffset = normalized.indexOf("|");
  assert.notEqual(cursorOffset, -1, "marked text must contain a cursor");

  return {
    text: normalized.slice(0, cursorOffset) + normalized.slice(cursorOffset + 1),
    cursorOffset,
  };
}

function createMockDocument(markedText: string, fileName = "Cargo.toml") {
  const { text, cursorOffset } = parseMarkedText(markedText);
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let runningOffset = 0;

  for (const line of lines) {
    lineOffsets.push(runningOffset);
    runningOffset += line.length + 1;
  }

  function positionAt(offset: number) {
    const safeOffset = Math.max(0, Math.min(offset, text.length));

    for (let line = lines.length - 1; line >= 0; line--) {
      const lineOffset = lineOffsets[line];
      if (safeOffset >= lineOffset) {
        return {
          line,
          character: safeOffset - lineOffset,
        };
      }
    }

    return { line: 0, character: 0 };
  }

  function offsetAt(position: { line: number; character: number }): number {
    const safeLine = Math.max(0, Math.min(position.line, lines.length - 1));
    const lineText = lines[safeLine];
    const safeCharacter = Math.max(
      0,
      Math.min(position.character, lineText.length)
    );

    return lineOffsets[safeLine] + safeCharacter;
  }

  return {
    document: {
      fileName,
      lineCount: lines.length,
      getText() {
        return text;
      },
      lineAt(line: number) {
        return { text: lines[line] };
      },
      offsetAt,
      positionAt,
    },
    position: positionAt(cursorOffset),
    text,
  };
}

function getRangeText(
  document: ReturnType<typeof createMockDocument>["document"],
  range: TextRange
): string {
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  return document.getText().slice(start, end);
}

function createSingleLineDocument(
  lineText: string
): Parameters<typeof isTypingCrateName>[0] {
  return {
    lineCount: 1,
    fileName: "Cargo.toml",
    getText() {
      return lineText;
    },
    lineAt(line: number) {
      assert.equal(line, 0);
      return { text: lineText };
    },
    offsetAt(position: { line: number; character: number }) {
      assert.equal(position.line, 0);
      return position.character;
    },
    positionAt(offset: number) {
      return { line: 0, character: offset };
    },
  } as unknown as Parameters<typeof isTypingCrateName>[0];
}

function createPosition(
  cursorCharacter: number
): Parameters<typeof isTypingCrateName>[1] {
  return {
    line: 0,
    character: cursorCharacter,
  } as Parameters<typeof isTypingCrateName>[1];
}

function asFeatureDocument(document: ReturnType<typeof createMockDocument>["document"]) {
  return document as unknown as Parameters<typeof getFeatureCompletionContext>[0];
}

function asFeaturePosition(position: ReturnType<typeof createMockDocument>["position"]) {
  return position as unknown as Parameters<typeof getFeatureCompletionContext>[1];
}

test("getCrateNameContext keeps existing dependency suffix intact", () => {
  const { text, cursorOffset } = parseMarkedText('ser|de = "1"');

  assert.deepEqual(getCrateNameContext(text, cursorOffset), {
    prefix: "ser",
    startCharacter: 0,
    endCharacter: 5,
  });
});

test("getCrateNameContext does not include comments in the replacement range", () => {
  const { text, cursorOffset } = parseMarkedText("ser|de # comment");

  assert.deepEqual(getCrateNameContext(text, cursorOffset), {
    prefix: "ser",
    startCharacter: 0,
    endCharacter: 5,
  });
});

test("getCrateNameContext only spans the current token at token end", () => {
  const { text, cursorOffset } = parseMarkedText("tok|");

  assert.deepEqual(getCrateNameContext(text, cursorOffset), {
    prefix: "tok",
    startCharacter: 0,
    endCharacter: 3,
  });
});

test("getCrateNameContext treats hyphens as part of the crate token", () => {
  const { text, cursorOffset } = parseMarkedText('serde-j|son = "1"');

  assert.deepEqual(getCrateNameContext(text, cursorOffset), {
    prefix: "serde-j",
    startCharacter: 0,
    endCharacter: 10,
  });
});

test("isTypingCrateName rejects positions after the equals sign", () => {
  const { text, cursorOffset } = parseMarkedText('serde = "1|"');

  assert.equal(
    isTypingCrateName(
      createSingleLineDocument(text),
      createPosition(cursorOffset)
    ),
    false
  );
});

test("getFeatureCompletionContext parses a single-line inline dependency", () => {
  const { document, position } = createMockDocument(`
[dependencies]
serde = { version = "1", features = ["der|"] }
`);

  const context = getFeatureCompletionContext(
    asFeatureDocument(document),
    asFeaturePosition(position)
  );

  assert.ok(context);
  assert.equal(context.crateName, "serde");
  assert.equal(context.versionRequirement, "1");
  assert.equal(context.featurePrefix, "der");
  assert.deepEqual(context.selectedFeatures, []);
  assert.equal(getRangeText(document, context.range), "der");
});

test("getFeatureCompletionContext supports renamed crates and multi-line feature arrays", () => {
  const { document, position } = createMockDocument(`
[dependencies]
serde_json = {
  package = "serde",
  features = [
    "std",
    "der|ive",
  ],
  version = "1.0",
}
`);

  const context = getFeatureCompletionContext(
    asFeatureDocument(document),
    asFeaturePosition(position)
  );

  assert.ok(context);
  assert.equal(context.crateName, "serde");
  assert.equal(context.versionRequirement, "1.0");
  assert.equal(context.featurePrefix, "der");
  assert.deepEqual(context.selectedFeatures, ["std"]);
  assert.equal(getRangeText(document, context.range), "derive");
});

test("getFeatureCompletionContext keeps earlier feature selections for later items", () => {
  const { document, position } = createMockDocument(`
[dependencies]
serde = { version = "1", features = ["std", "der|ive"] }
`);

  const context = getFeatureCompletionContext(
    asFeatureDocument(document),
    asFeaturePosition(position)
  );

  assert.ok(context);
  assert.deepEqual(context.selectedFeatures, ["std"]);
  assert.equal(context.featurePrefix, "der");
});

test("getFeatureCompletionContext returns null outside the features array", () => {
  const { document, position } = createMockDocument(`
[dependencies]
serde = { version = "1|", features = ["derive"] }
`);

  assert.equal(
    getFeatureCompletionContext(
      asFeatureDocument(document),
      asFeaturePosition(position)
    ),
    null
  );
});

test("getFeatureCompletionContext returns null when version is missing", () => {
  const { document, position } = createMockDocument(`
[dependencies]
serde = { features = ["der|ive"] }
`);

  assert.equal(
    getFeatureCompletionContext(
      asFeatureDocument(document),
      asFeaturePosition(position)
    ),
    null
  );
});
