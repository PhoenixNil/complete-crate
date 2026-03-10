import * as vscode from "vscode";
import {
  CrateFeatureService,
  type FeatureServiceLogger,
} from "./crateFeatureService";
import { getSuggestedFeatures } from "./featureSuggestions";
import { getFeatureCompletionContext } from "./tomlParser";

export class FeatureCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(
    private readonly featureService: CrateFeatureService,
    private readonly logger?: FeatureServiceLogger
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      const context = getFeatureCompletionContext(document, position);
      if (!context) {
        return undefined;
      }

      const featureNames = await this.featureService.getFeatures(
        context.crateName,
        context.versionRequirement
      );
      if (token.isCancellationRequested) {
        return undefined;
      }

      if (!featureNames) {
        return undefined;
      }

      const suggestions = getSuggestedFeatures(
        featureNames,
        context.featurePrefix,
        context.selectedFeatures
      );
      if (suggestions.length === 0) {
        return undefined;
      }

      return suggestions.map((featureName, index) => {
        const item = new vscode.CompletionItem(
          featureName,
          vscode.CompletionItemKind.EnumMember
        );

        item.sortText = String(index).padStart(5, "0");
        item.filterText = featureName;
        item.preselect = index === 0;
        item.detail = `Feature for ${context.crateName}`;
        item.range = new vscode.Range(
          context.range.start.line,
          context.range.start.character,
          context.range.end.line,
          context.range.end.character
        );

        return item;
      });
    } catch (error) {
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.logger?.warn(
        `CrateLite: feature provider crashed: ${message}`
      );
      return undefined;
    }
  }
}
