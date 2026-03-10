import * as vscode from "vscode";
import { CrateIndex } from "./crateIndex";
import { isInDependenciesSection } from "./tomlParser";

interface VersionContext {
  crateName: string;
  versionPrefix: string;
  range: vscode.Range;
}

function getVersionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): VersionContext | null {
  if (!document.fileName.toLowerCase().endsWith("cargo.toml")) {
    return null;
  }

  if (!isInDependenciesSection(document, position)) {
    return null;
  }

  const lineText = document.lineAt(position.line).text;
  const textBeforeCursor = lineText.substring(0, position.character);
  const patterns = [
    /^\s*([\w-]+)\s*=\s*"([^"]*)"?$/,
    /^\s*([\w-]+)\s*=\s*\{.*\bversion\s*=\s*"([^"]*)"?$/,
  ];

  for (const pattern of patterns) {
    const match = textBeforeCursor.match(pattern);
    if (match) {
      const startCharacter = position.character - match[2].length;
      return {
        crateName: match[1],
        versionPrefix: match[2],
        range: new vscode.Range(
          position.line,
          startCharacter,
          position.line,
          position.character
        ),
      };
    }
  }

  return null;
}

export class VersionCompletionProvider
  implements vscode.CompletionItemProvider {
  constructor(private index: CrateIndex) { }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const context = getVersionContext(document, position);
    if (!context) {
      return undefined;
    }

    const latestVersion = this.index.getLatestVersion(context.crateName);
    if (!latestVersion || !latestVersion.startsWith(context.versionPrefix)) {
      return undefined;
    }

    const item = new vscode.CompletionItem(
      latestVersion,
      vscode.CompletionItemKind.Value
    );
    item.detail = "Latest (offline index)";
    item.sortText = "00000";
    item.preselect = true;
    item.range = context.range;

    return [item];
  }
}
