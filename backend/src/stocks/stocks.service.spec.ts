/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { StocksService } from './stocks.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Helper to convert UTF-8 string to GBK buffer for Chinese characters to prevent decoder issues.
function makeGbkBuffer(template: string, chineseReplacements: Record<string, number[]>): Buffer {
  let tempStr = template;
  const placeholders: { placeholder: string; bytes: number[] }[] = [];

  Object.entries(chineseReplacements).forEach(([key, bytes], idx) => {
    const placeholder = `__CHINESE_${idx}__`;
    tempStr = tempStr.replace(key, placeholder);
    placeholders.push({ placeholder, bytes });
  });

  const parts: number[][] = [];
  let currentIdx = 0;

  while (currentIdx < tempStr.length) {
    let matched = false;
    for (const ph of placeholders) {
      if (tempStr.startsWith(ph.placeholder, currentIdx)) {
        parts.push(ph.bytes);
        currentIdx += ph.placeholder.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      parts.push([tempStr.charCodeAt(currentIdx)]);
      currentIdx++;
    }
  }

  return Buffer.from(parts.flat());
}

describe('StocksService', () => {
  let service: StocksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StocksService],
    }).compile();

    service = module.get<StocksService>(StocksService);
    jest.clearAllMocks();
  });

  describe('getInfo (A-Share)', () => {
    it('should successfully get A-share info from Tencent (primary)', async () => {
      const tencentResponse = makeGbkBuffer(
        'v_sh600089="1~特变电工~600089~22.01~21.83~21.83~869889~438405~431484~22.01~5507~22.00~13169~21.99~1082~21.98~2778~21.97~574~22.02~1436~22.03~405~22.04~817~22.05~662~22.06~656~~20260703154819~0.18~0.82~22.24~21.79~22.01/869889/1919012827~869889~191901~1.72~18.03~~22.24~21.79~2.06~1112.12~1112.12~1.55~24.01~19.65~0.71~19134~22.06~15.32~18.68~~~1.74~191901.2827~0.0000~0~ ~GP-A~-0.95~-1.96~1.13~8.05~2.69~33.28~11.88~-5.62~-14.19~-13.69~5052792571~5052792571~70.64~29.85~5052792571~~~85.27~0.00~~CNY~0~___D__F__N~22.10~-2352~";',
        { 特变电工: [0xcc, 0xd8, 0xb1, 0xe4, 0xb5, 0xe7, 0xb9, 0xa4] },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: tencentResponse });

      const info = await service.getInfo('A', '600089');
      expect(info).toEqual({
        code: '600089',
        name: '特变电工',
        market: 'A',
        price: 22.01,
        change_pct: 0.82,
        turnover: 1919012827,
        volume: 86988900,
        turnover_rate: 1.72,
        market_cap: 111212000000,
        pe: 18.03,
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://qt.gtimg.cn/q=sh600089',
        expect.any(Object),
      );
    });

    it('should fallback to Sina if Tencent fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Tencent Timeout'));
      const sinaResponse = makeGbkBuffer(
        'var hq_str_sh600089="特变电工,21.830,21.830,22.010,22.240,21.790,22.010,22.020,86988857,1919012827.000,550700,22.010,1316900,22.000,108200,21.990,277800,21.980,57400,21.970,143590,22.020,40500,22.030,81700,22.040,66200,22.050,65600,22.060,2026-07-03,15:00:03,00,";',
        { 特变电工: [0xcc, 0xd8, 0xb1, 0xe4, 0xb5, 0xe7, 0xb9, 0xa4] },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: sinaResponse });

      const info = await service.getInfo('A', '600089');
      expect(info).toEqual({
        code: '600089',
        name: '特变电工',
        market: 'A',
        price: 22.01,
        change_pct: 0.82,
        turnover: 1919012827,
        volume: 86988857,
        turnover_rate: null,
        market_cap: null,
        pe: null,
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        1,
        'https://qt.gtimg.cn/q=sh600089',
        expect.any(Object),
      );
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        2,
        'https://hq.sinajs.cn/list=sh600089',
        expect.any(Object),
      );
    });
  });

  describe('getInfo (HK-Share)', () => {
    it('should successfully get HK-share info from Tencent (primary)', async () => {
      const tencentResponse = makeGbkBuffer(
        'v_hk00700="100~腾讯控股~00700~432.400~430.200~433.000~21534949.0~0~0~432.400~0~0~0~0~0~0~0~0~0~432.400~0~0~0~0~0~0~0~0~0~21534949.0~2026/07/03 15:33:55~2.200~0.51~445.800~431.200~432.400~21534949.0~9419760157.410~0~15.79~~0~0~3.39~39314.8235~39314.8235~TENCENT~1.23~677.700~411.000~0.67~24.82~0~0~0~0~0~14.76~3.12~0.24~100~-27.17~2.61~GP~20.59~11.53~-2.92~-7.29~-11.99~9092234841.00~9092234841.00~14.94~5.315~437.417~-35.29~HKD~1~30";',
        { 腾讯控股: [0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9] },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: tencentResponse });

      const info = await service.getInfo('HK', '00700');
      expect(info).toEqual({
        code: '00700',
        name: '腾讯控股',
        market: 'HK',
        price: 432.4,
        change_pct: 0.51,
        turnover: 9419760157.41,
        volume: 21534949,
        turnover_rate: 0,
        market_cap: 3931482350000,
        pe: 15.79,
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should fallback to Sina if Tencent fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Tencent Timeout'));
      const sinaResponse = makeGbkBuffer(
        'var hq_str_hk00700="TENCENT,腾讯控股,433.000,430.200,445.800,431.200,433.200,3.000,0.697,433.00000,433.20001,9238208268,21115649,0.000,0.000,675.134,411.000,2026/07/03,15:26";',
        { 腾讯控股: [0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9] },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: sinaResponse });

      const info = await service.getInfo('HK', '00700');
      expect(info).toEqual({
        code: '00700',
        name: '腾讯控股',
        market: 'HK',
        price: 433.2,
        change_pct: 0.697,
        turnover: 9238208268,
        volume: 21115649,
        turnover_rate: null,
        market_cap: null,
        pe: null,
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getBatchInfo', () => {
    it('should batch fetch info from Tencent successfully', async () => {
      const tencentResponse = makeGbkBuffer(
        'v_sh600089="1~特变电工~600089~22.01~21.83~21.83~869889~438405~431484~22.01~5507~22.00~13169~21.99~1082~21.98~2778~21.97~574~22.02~1436~22.03~405~22.04~817~22.05~662~22.06~656~~20260703154819~0.18~0.82~22.24~21.79~22.01/869889/1919012827~869889~191901~1.72~18.03~~22.24~21.79~2.06~1112.12~1112.12~1.55~24.01~19.65~0.71~19134~22.06~15.32~18.68~~~1.74~191901.2827~0.0000~0~ ~GP-A~-0.95~-1.96~1.13~8.05~2.69~33.28~11.88~-5.62~-14.19~-13.69~5052792571~5052792571~70.64~29.85~5052792571~~~85.27~0.00~~CNY~0~___D__F__N~22.10~-2352~";\n' +
          'v_hk00700="100~腾讯控股~00700~432.400~430.200~433.000~21534949.0~0~0~432.400~0~0~0~0~0~0~0~0~0~432.400~0~0~0~0~0~0~0~0~0~21534949.0~2026/07/03 15:33:55~2.200~0.51~445.800~431.200~432.400~21534949.0~9419760157.410~0~15.79~~0~0~3.39~39314.8235~39314.8235~TENCENT~1.23~677.700~411.000~0.67~24.82~0~0~0~0~0~14.76~3.12~0.24~100~-27.17~2.61~GP~20.59~11.53~-2.92~-7.29~-11.99~9092234841.00~9092234841.00~14.94~5.315~437.417~-35.29~HKD~1~30";',
        {
          特变电工: [0xcc, 0xd8, 0xb1, 0xe4, 0xb5, 0xe7, 0xb9, 0xa4],
          腾讯控股: [0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9],
        },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: tencentResponse });

      const result = await service.getBatchInfo(['A:600089', 'HK:00700']);
      expect(result['A:600089']).toEqual({
        code: '600089',
        name: '特变电工',
        market: 'A',
        price: 22.01,
        change_pct: 0.82,
        turnover: 1919012827,
        volume: 86988900,
        turnover_rate: 1.72,
        market_cap: 111212000000,
        pe: 18.03,
      });
      expect(result['HK:00700']).toEqual({
        code: '00700',
        name: '腾讯控股',
        market: 'HK',
        price: 432.4,
        change_pct: 0.51,
        turnover: 9419760157.41,
        volume: 21534949,
        turnover_rate: 0,
        market_cap: 3931482350000,
        pe: 15.79,
      });
    });

    it('should fallback to Sina for batch if Tencent fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Tencent batch failed'));

      const sinaResponse = makeGbkBuffer(
        'var hq_str_sh600089="特变电工,21.830,21.830,22.010,22.240,21.790,22.010,22.020,86988857,1919012827.000,550700,22.010,1316900,22.000,108200,21.990,277800,21.980,57400,21.970,143590,22.020,40500,22.030,81700,22.040,66200,22.050,65600,22.060,2026-07-03,15:00:03,00,";\n' +
          'var hq_str_hk00700="TENCENT,腾讯控股,433.000,430.200,445.800,431.200,433.200,3.000,0.697,433.00000,433.20001,9238208268,21115649,0.000,0.000,675.134,411.000,2026/07/03,15:26";',
        {
          特变电工: [0xcc, 0xd8, 0xb1, 0xe4, 0xb5, 0xe7, 0xb9, 0xa4],
          腾讯控股: [0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9],
        },
      );
      mockedAxios.get.mockResolvedValueOnce({ data: sinaResponse });

      const result = await service.getBatchInfo(['A:600089', 'HK:00700']);
      expect(result['A:600089']).toEqual({
        code: '600089',
        name: '特变电工',
        market: 'A',
        price: 22.01,
        change_pct: 0.82,
        turnover: 1919012827,
        volume: 86988857,
        turnover_rate: null,
        market_cap: null,
        pe: null,
      });
      expect(result['HK:00700']).toEqual({
        code: '00700',
        name: '腾讯控股',
        market: 'HK',
        price: 433.2,
        change_pct: 0.697,
        turnover: 9238208268,
        volume: 21115649,
        turnover_rate: null,
        market_cap: null,
        pe: null,
      });
    });
  });
});
