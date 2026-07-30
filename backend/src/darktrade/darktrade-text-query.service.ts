import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { DarkTradeService, type DarkTradeData } from './darktrade.service';
import { getRandomCapitalSummarySuffix } from './capital-summary-suffixes';

export interface DarkTradeTextQueryResult {
  names: string[];
  results: Array<DarkTradeData & { displayName: string }>;
  notFoundNames: string[];
  summarySuffix: string;
}

interface LlmResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const SILICONFLOW_MODEL = 'Qwen/Qwen3-8B';
const STOCK_NAME_EXTRACTION_PROMPT = `
你负责从用户文本中提取可能提及的中国股票或场内 ETF 名称/简称。

【文本背景】
用户文本来自小红书股票咨询回复。

【提取规则】
1. 股名通常会被隐晦地写成中文、拼音首字母或二者混合。
2. 必须原样保留文本中的股名写法，不要擅自还原成正式全称。
3. 去掉“求看”“可以看下吗”“谢谢”“嘞”等语气词和无关词。
4. 不要补充文本中不存在的标的。
5. 去重，最多提取 12 个；没有则返回空数组。

【示例】
输入：多F多和南D光电，求看
输出：{"names":["多F多","南D光电"]}

输入：有研可以看下吗
输出：{"names":["有研"]}

输入：北方华c谢谢
输出：{"names":["北方华c"]}

输入：求通富wd
输出：{"names":["通富wd"]}

输入：dfd嘞
输出：{"names":["dfd"]}

输入：巨人呢
输出：{"names":["巨人"]}

输入：盈 fw.扬子 xc.金zd
输出：{"names":["盈fw","扬子xc","金zd"]}

【输出格式】
只返回 JSON，不要解释：{"names":["名称1","名称2"]}
`;

/** 通过 OpenAI 兼容模型从自然语言中提取股票名称，再查询已有日终资金数据。 */
@Injectable()
export class DarkTradeTextQueryService {
  private readonly logger = new Logger(DarkTradeTextQueryService.name);

  constructor(private readonly darkTradeService: DarkTradeService) {}

  async query(text: string, date?: string): Promise<DarkTradeTextQueryResult> {
    const normalizedText = text.trim();
    if (!normalizedText) throw new BadRequestException('text 不能为空');

    const names = await this.extractStockNames(normalizedText);
    this.logger.log(`LLM 提取个股（date=${date ?? '今日'}）：${names.join('、') || '无'}`);
    const settled = await Promise.all(
      names.map(async (name) => {
        try {
          return { name, data: await this.darkTradeService.getDailyResultByName(name, date) };
        } catch {
          // 单个候选尚未收盘或名称歧义时，不影响其余股票的查询结果。
          return { name, data: null };
        }
      }),
    );
    const results = settled.flatMap((item) => (item.data ? [item.data] : []));
    return {
      names,
      results,
      notFoundNames: settled.filter((item) => !item.data).map((item) => item.name),
      summarySuffix: getRandomCapitalSummarySuffix(),
    };
  }

  private async extractStockNames(text: string): Promise<string[]> {
    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '尚未配置硅基流动密钥，请在 backend/.env 中填写 SILICONFLOW_API_KEY',
      );
    }

    try {
      this.logger.log(`LLM 提取个股：${text}`);
      const response = await axios.post<LlmResponse>(
        `${SILICONFLOW_BASE_URL}/chat/completions`,
        {
          model: SILICONFLOW_MODEL,
          temperature: 0,
          max_tokens: 256,
          enable_thinking: false,
          messages: [
            {
              role: 'system',
              content: STOCK_NAME_EXTRACTION_PROMPT,
            },
            { role: 'user', content: text },
          ],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 20_000,
        },
      );
      return this.parseNames(response.data.choices?.[0]?.message?.content);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('模型提取失败，请检查模型服务配置后重试');
    }
  }

  private parseNames(content: string | undefined): string[] {
    if (!content) throw new BadRequestException('模型未返回股票名称');
    const jsonText = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
    if (!jsonText) throw new BadRequestException('模型返回格式不正确');
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new BadRequestException('模型返回格式不正确');
    }
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && 'names' in parsed
        ? (parsed as { names?: unknown }).names
        : [];
    if (!Array.isArray(values)) throw new BadRequestException('模型返回格式不正确');
    return [
      ...new Set(
        values
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, 12);
  }
}
