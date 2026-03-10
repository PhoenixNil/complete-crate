import * as vscode from "vscode";
import { CrateIndex } from "./crateIndex";
import {
  isInDependenciesSection,
  isTypingCrateName,
  getCrateNameContext,
} from "./tomlParser";

/**
 * Crate 名称补全 Provider
 *
 * 核心逻辑：
 * 1. 检查光标是否在 [dependencies] 区域
 * 2. 检查是否正在输入 crate 名（而非版本号）
 * 3. 提取输入前缀，查询本地索引
 * 4. 返回按热门度排序的补全列表
 */
export class CrateCompletionProvider
  implements vscode.CompletionItemProvider {
  constructor(private index: CrateIndex) { }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionList | undefined {
    // 检查是否在依赖区域
    if (!isInDependenciesSection(document, position)) {
      return undefined;
    }

    // 检查是否在输入 crate 名
    if (!isTypingCrateName(document, position)) {
      return undefined;
    }

    // 提取前缀
    const lineText = document.lineAt(position.line).text;
    const crateNameContext = getCrateNameContext(
      lineText,
      position.character
    );
    const prefix = crateNameContext.prefix;
    const config = vscode.workspace.getConfiguration("cratelite");
    const minLength = config.get<number>("minTriggerLength", 2);

    if (prefix.length < minLength) {
      return undefined;
    }

    // 查询索引
    const maxResults = config.get<number>("maxSuggestions", 30);
    const results = this.index.search(prefix, maxResults);

    if (results.length === 0) {
      return undefined;
    }

    // 转换为 CompletionItem
    const items = results.map((entry, i) => {
      const item = new vscode.CompletionItem(
        entry.name,
        vscode.CompletionItemKind.Module
      );

      // sortText 保证按热门度排序（rank 越小越热门）
      item.sortText = String(i).padStart(5, "0");

      // filterText = crate 名本身
      item.filterText = entry.name;

      // 第一个结果（最热门的）默认选中
      if (i === 0) {
        item.preselect = true;
      }


      // range: 替换当前已输入的前缀
      item.range = new vscode.Range(
        position.line,
        crateNameContext.startCharacter,
        position.line,
        crateNameContext.endCharacter
      );

      // 右侧显示 "Latest: 1.0.219" 类似截图效果
      item.detail = `Latest: ${entry.version}`;
      item.documentation = new vscode.MarkdownString(
        `**${entry.name}** v${entry.version}\n\nPopularity rank: #${entry.rank + 1} on crates.io`
      );

      return item;
    });

    // isIncomplete = true: 告诉 VSCode 每次按键都重新调用 provider
    // 这样输入 "se" -> "sea" 时会重新查询，而不是在旧结果里模糊过滤
    return new vscode.CompletionList(items, true);
  }
}
