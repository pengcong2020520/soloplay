/**
 * 从上传文件中提取纯文本。
 * - TXT / Markdown：直接读取
 * - DOCX：动态加载 mammoth（若未安装则提示）
 * - PDF：动态加载 pdf-parse（若未安装则提示）
 * 解析库以 optionalDependencies 处理，缺失时给出清晰错误，不阻塞 TXT/MD 路径。
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const lower = filename.toLowerCase();

  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    return buffer.toString("utf-8");
  }

  if (lower.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
    try {
      // @ts-ignore 可选依赖
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch {
      throw new Error(
        "解析 DOCX 需要 mammoth 依赖。请运行 `npm i mammoth`，或改用 TXT/Markdown 上传。"
      );
    }
  }

  if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
    try {
      // @ts-ignore 可选依赖
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      return data.text;
    } catch {
      throw new Error(
        "解析 PDF 需要 pdf-parse 依赖。请运行 `npm i pdf-parse`，或改用 TXT/Markdown 上传。"
      );
    }
  }

  // 兜底：当作纯文本
  return buffer.toString("utf-8");
}
