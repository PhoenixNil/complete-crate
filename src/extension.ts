import * as vscode from "vscode";
import { CrateFeatureService } from "./crateFeatureService";
import { CrateIndex } from "./crateIndex";
import { CrateCompletionProvider } from "./crateProvider";
import { FeatureCompletionProvider } from "./featureProvider";
import { VersionCompletionProvider } from "./versionProvider";

const featureCompletionTriggerCharacters = [
  '"',
  ",",
  "-",
  "_",
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
];

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("CrateLite");
  context.subscriptions.push(outputChannel);

  const index = new CrateIndex(context);
  await index.initialize();

  const tomlSelector: vscode.DocumentSelector = [
    { language: "toml" },
    { scheme: "file", pattern: "**/Cargo.toml" },
  ];

  const crateProvider = new CrateCompletionProvider(index);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      tomlSelector,
      crateProvider
    )
  );

  const versionProvider = new VersionCompletionProvider(index);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      tomlSelector,
      versionProvider,
      '"'
    )
  );

  const config = vscode.workspace.getConfiguration("cratelite");
  const featureIndexBaseUrl = config.get<string>(
    "featureIndexBaseUrl",
    "https://index.crates.io"
  );
  const featureService = new CrateFeatureService(
    undefined,
    featureIndexBaseUrl,
    {
      warn(message: string) {
        outputChannel.appendLine(message);
      },
    }
  );
  const featureProvider = new FeatureCompletionProvider(featureService, {
    warn(message: string) {
      outputChannel.appendLine(message);
    },
  });
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      tomlSelector,
      featureProvider,
      ...featureCompletionTriggerCharacters
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cratelite.updateIndex", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CrateLite: updating crate index...",
          cancellable: false,
        },
        async () => {
          await index.initialize();
          vscode.window.showInformationMessage(
            `CrateLite: index updated (${index.getTotalCrates()} crates)`
          );
        }
      );
    })
  );

  if (index.isLoaded()) {
    vscode.window.setStatusBarMessage(
      `CrateLite: ${index.getTotalCrates()} crates loaded`,
      5000
    );
  }
}

export function deactivate(): void {
}
