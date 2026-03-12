import type * as vscode from "vscode";

export interface CrateNameContext {
  prefix: string;
  startCharacter: number;
  endCharacter: number;
}

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface FeatureCompletionContext {
  crateName: string;
  versionRequirement: string;
  featurePrefix: string;
  range: TextRange;
  selectedFeatures: string[];
}

interface InlineDependencyStart {
  dependencyKey: string;
  openingBraceOffset: number;
}

interface ParsedString {
  value: string;
  contentStart: number;
  contentEnd: number;
  nextOffset: number;
}

interface ParsedFeatureArray {
  selectedFeatures: string[];
  featurePrefix: string;
  range: TextRange;
  nextOffset: number;
}

interface ParsedInlineDependencyTable {
  packageName: string | null;
  versionRequirement: string | null;
  featureArray: ParsedFeatureArray | null;
}

function isCrateNameCharacter(char: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(char);
}

function isTomlStringDelimiter(char: string): boolean {
  return char === '"' || char === "'";
}

function stripLineComment(lineText: string): string {
  let inString = false;
  let delimiter = "";
  let escaped = false;

  for (let i = 0; i < lineText.length; i++) {
    const char = lineText.charAt(i);

    if (inString) {
      if (delimiter === '"' && char === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      if (char === delimiter && !escaped) {
        inString = false;
        delimiter = "";
      }

      escaped = false;
      continue;
    }

    if (isTomlStringDelimiter(char)) {
      inString = true;
      delimiter = char;
      escaped = false;
      continue;
    }

    if (char === "#") {
      return lineText.substring(0, i);
    }
  }

  return lineText;
}

function getLineStartOffsets(text: string): number[] {
  const offsets = [0];

  for (let index = 0; index < text.length; index++) {
    if (text.charAt(index) === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function getOffsetFromLineCharacter(
  lineStartOffsets: number[],
  line: number,
  character: number
): number | null {
  const lineStartOffset = lineStartOffsets[line];
  if (lineStartOffset === undefined) {
    return null;
  }

  return lineStartOffset + character;
}

function toPosition(
  document: vscode.TextDocument,
  offset: number
): TextPosition {
  const position = document.positionAt(offset);
  return { line: position.line, character: position.character };
}

function toRange(
  document: vscode.TextDocument,
  startOffset: number,
  endOffset: number
): TextRange {
  return {
    start: toPosition(document, startOffset),
    end: toPosition(document, endOffset),
  };
}

function skipTrivia(text: string, offset: number, endOffset: number): number {
  let cursor = offset;

  while (cursor < endOffset) {
    const char = text.charAt(cursor);

    if (/\s/.test(char) || char === ",") {
      cursor++;
      continue;
    }

    if (char === "#") {
      cursor++;
      while (cursor < endOffset && text.charAt(cursor) !== "\n") {
        cursor++;
      }
      continue;
    }

    break;
  }

  return cursor;
}

function parseBareKey(
  text: string,
  offset: number,
  endOffset: number
): { key: string; nextOffset: number } | null {
  const keyMatch = text.substring(offset, endOffset).match(/^[A-Za-z0-9_-]+/);
  if (!keyMatch) {
    return null;
  }

  return {
    key: keyMatch[0],
    nextOffset: offset + keyMatch[0].length,
  };
}

function parseTomlString(
  text: string,
  offset: number,
  endOffset: number
): ParsedString | null {
  const delimiter = text.charAt(offset);
  if (!isTomlStringDelimiter(delimiter)) {
    return null;
  }

  let cursor = offset + 1;
  let escaped = false;
  let value = "";

  while (cursor < endOffset) {
    const char = text.charAt(cursor);

    if (delimiter === '"' && char === "\\" && !escaped) {
      escaped = true;
      cursor++;
      if (cursor < endOffset) {
        value += text.charAt(cursor);
        cursor++;
      }
      continue;
    }

    if (char === delimiter && !escaped) {
      return {
        value,
        contentStart: offset + 1,
        contentEnd: cursor,
        nextOffset: cursor + 1,
      };
    }

    value += char;
    escaped = false;
    cursor++;
  }

  return {
    value,
    contentStart: offset + 1,
    contentEnd: endOffset,
    nextOffset: endOffset,
  };
}

function findMatchingDelimiter(
  text: string,
  openingOffset: number,
  openingChar: string,
  closingChar: string,
  endOffset: number
): number | null {
  let depth = 0;
  let inString = false;
  let delimiter = "";
  let escaped = false;
  let inComment = false;

  for (let cursor = openingOffset; cursor < endOffset; cursor++) {
    const char = text.charAt(cursor);

    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }
      continue;
    }

    if (inString) {
      if (delimiter === '"' && char === "\\" && !escaped) {
        escaped = true;
        continue;
      }

      if (char === delimiter && !escaped) {
        inString = false;
        delimiter = "";
      }

      escaped = false;
      continue;
    }

    if (isTomlStringDelimiter(char)) {
      inString = true;
      delimiter = char;
      escaped = false;
      continue;
    }

    if (char === "#") {
      inComment = true;
      continue;
    }

    if (char === openingChar) {
      depth++;
      continue;
    }

    if (char === closingChar) {
      depth--;
      if (depth === 0) {
        return cursor;
      }
    }
  }

  return null;
}

function skipTomlValue(
  text: string,
  offset: number,
  endOffset: number
): number {
  const char = text.charAt(offset);

  if (isTomlStringDelimiter(char)) {
    return parseTomlString(text, offset, endOffset)?.nextOffset ?? endOffset;
  }

  if (char === "[") {
    const closingOffset = findMatchingDelimiter(
      text,
      offset,
      "[",
      "]",
      endOffset
    );
    return closingOffset === null ? endOffset : closingOffset + 1;
  }

  if (char === "{") {
    const closingOffset = findMatchingDelimiter(
      text,
      offset,
      "{",
      "}",
      endOffset
    );
    return closingOffset === null ? endOffset : closingOffset + 1;
  }

  let cursor = offset;

  while (cursor < endOffset) {
    const current = text.charAt(cursor);
    if (current === "," || current === "}") {
      return cursor;
    }
    if (current === "#") {
      while (cursor < endOffset && text.charAt(cursor) !== "\n") {
        cursor++;
      }
      return cursor;
    }
    cursor++;
  }

  return endOffset;
}

function parseFeatureArray(
  document: vscode.TextDocument,
  text: string,
  offset: number,
  endOffset: number,
  cursorOffset: number
): ParsedFeatureArray | null {
  if (text.charAt(offset) !== "[") {
    return null;
  }

  const closingOffset = findMatchingDelimiter(text, offset, "[", "]", endOffset);
  if (closingOffset === null) {
    return null;
  }

  const selectedFeatures: string[] = [];
  let featurePrefix: string | null = null;
  let range: TextRange | null = null;
  let cursor = offset + 1;

  while (cursor < closingOffset) {
    cursor = skipTrivia(text, cursor, closingOffset);
    if (cursor >= closingOffset) {
      break;
    }

    if (!isTomlStringDelimiter(text.charAt(cursor))) {
      cursor++;
      continue;
    }

    const parsedString = parseTomlString(text, cursor, closingOffset);
    if (!parsedString) {
      break;
    }

    const isCursorInsideCurrentString =
      cursorOffset >= parsedString.contentStart &&
      cursorOffset <= parsedString.contentEnd;

    if (isCursorInsideCurrentString) {
      featurePrefix = text.substring(parsedString.contentStart, cursorOffset);
      range = toRange(
        document,
        parsedString.contentStart,
        parsedString.contentEnd
      );
    } else if (parsedString.value.length > 0) {
      selectedFeatures.push(parsedString.value);
    }

    cursor = parsedString.nextOffset;
  }

  if (featurePrefix === null || !range) {
    return null;
  }

  return {
    selectedFeatures,
    featurePrefix,
    range,
    nextOffset: closingOffset + 1,
  };
}

function parseInlineDependencyTable(
  document: vscode.TextDocument,
  openingBraceOffset: number,
  closingBraceOffset: number,
  cursorOffset: number
): ParsedInlineDependencyTable {
  const text = document.getText();
  let packageName: string | null = null;
  let versionRequirement: string | null = null;
  let featureArray: ParsedFeatureArray | null = null;
  let cursor = openingBraceOffset + 1;

  while (cursor < closingBraceOffset) {
    cursor = skipTrivia(text, cursor, closingBraceOffset);
    if (cursor >= closingBraceOffset) {
      break;
    }

    const parsedKey = parseBareKey(text, cursor, closingBraceOffset);
    if (!parsedKey) {
      cursor++;
      continue;
    }

    cursor = skipTrivia(text, parsedKey.nextOffset, closingBraceOffset);
    if (text.charAt(cursor) !== "=") {
      cursor = skipTomlValue(text, cursor, closingBraceOffset);
      continue;
    }

    cursor = skipTrivia(text, cursor + 1, closingBraceOffset);
    const valueStart = cursor;

    if (
      (parsedKey.key === "package" || parsedKey.key === "version") &&
      isTomlStringDelimiter(text.charAt(valueStart))
    ) {
      const parsedString = parseTomlString(text, valueStart, closingBraceOffset);
      if (parsedString) {
        if (parsedKey.key === "package") {
          packageName = parsedString.value;
        } else {
          versionRequirement = parsedString.value;
        }
        cursor = parsedString.nextOffset;
        continue;
      }
    }

    if (parsedKey.key === "features" && text.charAt(valueStart) === "[") {
      featureArray = parseFeatureArray(
        document,
        text,
        valueStart,
        closingBraceOffset,
        cursorOffset
      );
      cursor = featureArray?.nextOffset ?? skipTomlValue(text, valueStart, closingBraceOffset);
      continue;
    }

    cursor = skipTomlValue(text, valueStart, closingBraceOffset);
  }

  return {
    packageName,
    versionRequirement,
    featureArray,
  };
}

function findInlineDependencyStart(
  document: vscode.TextDocument,
  position: vscode.Position
): InlineDependencyStart | null {
  const documentText = document.getText();
  const lineStartOffsets = getLineStartOffsets(documentText);
  const cursorOffset = document.offsetAt(position);

  for (let line = position.line; line >= 0; line--) {
    const rawLine = document.lineAt(line).text;
    const lineWithoutComment = stripLineComment(rawLine);
    const trimmed = lineWithoutComment.trim();

    if (line < position.line && /^\[.+\]$/.test(trimmed)) {
      return null;
    }

    const dependencyMatch = lineWithoutComment.match(
      /^\s*([A-Za-z0-9_-]+)\s*=\s*\{/
    );
    if (!dependencyMatch) {
      continue;
    }

    const eqIndex = lineWithoutComment.indexOf("=");
    const openingBraceColumn = lineWithoutComment.indexOf("{", eqIndex);
    if (openingBraceColumn === -1) {
      continue;
    }

    const openingBraceOffset = getOffsetFromLineCharacter(
      lineStartOffsets,
      line,
      openingBraceColumn
    );
    if (openingBraceOffset === null) {
      continue;
    }

    const closingBraceOffset = findMatchingDelimiter(
      documentText,
      openingBraceOffset,
      "{",
      "}",
      documentText.length
    );
    if (closingBraceOffset === null) {
      continue;
    }

    if (cursorOffset > openingBraceOffset && cursorOffset <= closingBraceOffset) {
      return {
        dependencyKey: dependencyMatch[1],
        openingBraceOffset,
      };
    }
  }

  return null;
}

export function getCrateNameContext(
  lineText: string,
  cursorCharacter: number
): CrateNameContext {
  const safeCursor = Math.max(0, Math.min(cursorCharacter, lineText.length));

  let startCharacter = safeCursor;
  while (
    startCharacter > 0 &&
    isCrateNameCharacter(lineText.charAt(startCharacter - 1))
  ) {
    startCharacter--;
  }

  let endCharacter = safeCursor;
  while (
    endCharacter < lineText.length &&
    isCrateNameCharacter(lineText.charAt(endCharacter))
  ) {
    endCharacter++;
  }

  return {
    prefix: lineText.substring(startCharacter, safeCursor),
    startCharacter,
    endCharacter,
  };
}

export function isInDependenciesSection(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const fileName = document.fileName.toLowerCase();
  if (!fileName.endsWith("cargo.toml")) {
    return false;
  }

  for (let line = position.line; line >= 0; line--) {
    const trimmed = stripLineComment(document.lineAt(line).text).trim();
    const sectionMatch = trimmed.match(/^\[(.+)\]\s*$/);
    if (!sectionMatch) {
      continue;
    }

    const sectionName = sectionMatch[1].toLowerCase();
    return (
      sectionName === "dependencies" ||
      sectionName === "dev-dependencies" ||
      sectionName === "build-dependencies" ||
      sectionName === "workspace.dependencies" ||
      sectionName.endsWith(".dependencies") ||
      sectionName.endsWith(".dev-dependencies") ||
      sectionName.endsWith(".build-dependencies")
    );
  }

  return false;
}

export function isTypingCrateName(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const lineText = document.lineAt(position.line).text;
  const textBeforeCursor = lineText.substring(0, position.character);
  const eqIndex = textBeforeCursor.indexOf("=");

  if (eqIndex !== -1) {
    return false;
  }

  return /^[\w-]*$/.test(textBeforeCursor.trim());
}

export function getCrateNamePrefix(
  document: vscode.TextDocument,
  position: vscode.Position
): string {
  const lineText = document.lineAt(position.line).text;
  return getCrateNameContext(lineText, position.character).prefix;
}

export function getFeatureCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): FeatureCompletionContext | null {
  if (!isInDependenciesSection(document, position)) {
    return null;
  }

  const dependencyStart = findInlineDependencyStart(document, position);
  if (!dependencyStart) {
    return null;
  }

  const documentText = document.getText();
  const closingBraceOffset = findMatchingDelimiter(
    documentText,
    dependencyStart.openingBraceOffset,
    "{",
    "}",
    documentText.length
  );
  if (closingBraceOffset === null) {
    return null;
  }

  const cursorOffset = document.offsetAt(position);
  const parsedTable = parseInlineDependencyTable(
    document,
    dependencyStart.openingBraceOffset,
    closingBraceOffset,
    cursorOffset
  );

  if (
    !parsedTable.featureArray ||
    !parsedTable.versionRequirement ||
    parsedTable.versionRequirement.trim().length === 0
  ) {
    return null;
  }

  return {
    crateName: parsedTable.packageName ?? dependencyStart.dependencyKey,
    versionRequirement: parsedTable.versionRequirement,
    featurePrefix: parsedTable.featureArray.featurePrefix,
    range: parsedTable.featureArray.range,
    selectedFeatures: parsedTable.featureArray.selectedFeatures,
  };
}
