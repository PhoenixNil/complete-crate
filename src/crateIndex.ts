import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { httpGet } from "./httpClient";

interface CrateEntry {
  name: string;
  version: string;
  rank: number;
}

/**
 * CrateIndex: 下载并管理 crate 名称索引
 *
 * 核心数据结构：前两字符桶（prefixBuckets）
 * 每个桶内按 rank（行号）升序排列，即按下载量降序
 * 查询时直接遍历桶，前 N 个匹配即为最热门结果
 */
export class CrateIndex {
  private prefixBuckets = new Map<string, CrateEntry[]>();
  private loaded = false;
  private loading = false;
  private totalCrates = 0;

  constructor(private context: vscode.ExtensionContext) { }

  /**
   * 获取本地缓存文件路径
   */
  private getCachePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "crates-index.txt");
  }

  /**
   * 获取缓存元数据路径（记录上次更新时间）
   */
  private getMetaPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "index-meta.json");
  }

  /**
   * 检查缓存是否过期（超过 24 小时）
   */
  private isCacheExpired(): boolean {
    const metaPath = this.getMetaPath();
    if (!fs.existsSync(metaPath)) {
      return true;
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const lastUpdate = new Date(meta.lastUpdate).getTime();
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      return now - lastUpdate > twentyFourHours;
    } catch {
      return true;
    }
  }

  /**
   * 保存缓存元数据
   */
  private saveMeta(): void {
    const metaPath = this.getMetaPath();
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ lastUpdate: new Date().toISOString() })
    );
  }

  /**
   * 初始化索引：优先从本地缓存加载，过期则后台更新
   */
  async initialize(): Promise<void> {
    const cachePath = this.getCachePath();

    // 确保存储目录存在
    const storageDir = this.context.globalStorageUri.fsPath;
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // 如果有本地缓存，先加载它
    if (fs.existsSync(cachePath)) {
      this.loadFromFile(cachePath);

      // 如果缓存过期，后台静默更新
      if (this.isCacheExpired()) {
        this.downloadIndex().catch((err) => {
          console.warn("CrateLite: 后台更新索引失败:", err.message);
        });
      }
    } else {
      // 没有缓存，必须先下载
      await this.downloadIndex();
    }
  }

  /**
   * 从文件加载索引到内存
   */
  private loadFromFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf-8");
    this.buildIndex(content);
  }

  /**
   * 构建前缀桶索引
   * 文件格式: 每行 "crate_name latest_version"
   */
  private buildIndex(content: string): void {
    this.prefixBuckets.clear();
    const lines = content.split("\n").filter(Boolean);
    this.totalCrates = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // 解析 "serde 1.0.219" 格式
      const spaceIdx = line.indexOf(" ");
      const name = spaceIdx > 0 ? line.substring(0, spaceIdx) : line;
      const version = spaceIdx > 0 ? line.substring(spaceIdx + 1) : "0.0.0";

      if (name.length < 2) {
        continue;
      }

      const entry: CrateEntry = { name, version, rank: i };
      const prefix = name.substring(0, 2).toLowerCase();

      let bucket = this.prefixBuckets.get(prefix);
      if (!bucket) {
        bucket = [];
        this.prefixBuckets.set(prefix, bucket);
      }
      bucket.push(entry);
    }

    this.loaded = true;
    console.log(
      `CrateLite: 索引加载完成，${this.totalCrates} 个 crate，${this.prefixBuckets.size} 个桶`
    );
  }

  /**
   * 下载 gzip 压缩的索引文件
   */
  private async downloadIndex(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;

    const config = vscode.workspace.getConfiguration("cratelite");
    const url = config.get<string>(
      "indexUrl",
      "https://github.com/PhoenixNil/Autoupdate-cratelite/releases/download/latest/crates-index.txt.gz"
    );

    try {
      const data = await httpGet(url);
      const decompressed = zlib.gunzipSync(data);
      const content = decompressed.toString("utf-8");

      // 写入缓存
      const cachePath = this.getCachePath();
      fs.writeFileSync(cachePath, content, "utf-8");
      this.saveMeta();

      // 构建索引
      this.buildIndex(content);

      vscode.window.setStatusBarMessage(
        `CrateLite: 索引已更新 (${this.totalCrates} crates)`,
        3000
      );
    } catch (err: any) {
      console.error("CrateLite: 下载索引失败:", err.message);
      if (!this.loaded) {
        vscode.window.showWarningMessage(
          `CrateLite: 无法下载 crate 索引。请检查网络连接。`
        );
      }
    } finally {
      this.loading = false;
    }
  }

  /**
   * 前缀搜索：返回匹配 query 的 crate，按热门度排序
   */
  search(query: string, maxResults: number = 30): CrateEntry[] {
    if (!this.loaded || query.length < 2) {
      return [];
    }

    const q = query.toLowerCase();
    const prefix = q.substring(0, 2);
    const bucket = this.prefixBuckets.get(prefix);

    if (!bucket) {
      return [];
    }

    // 桶内已按 rank 升序（热门度降序），遍历取前 N 个匹配
    const results: CrateEntry[] = [];
    for (const entry of bucket) {
      if (entry.name.toLowerCase().startsWith(q)) {
        results.push(entry);
        if (results.length >= maxResults) {
          break;
        }
      }
    }

    return results;
  }

  getLatestVersion(crateName: string): string | null {
    if (!this.loaded) {
      return null;
    }

    const normalizedName = crateName.toLowerCase();
    const buckets =
      normalizedName.length >= 2
        ? [this.prefixBuckets.get(normalizedName.substring(0, 2))]
        : Array.from(this.prefixBuckets.values());

    for (const bucket of buckets) {
      const entry = bucket?.find(
        (candidate) => candidate.name.toLowerCase() === normalizedName
      );
      if (entry) {
        return entry.version;
      }
    }

    return null;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getTotalCrates(): number {
    return this.totalCrates;
  }
}
