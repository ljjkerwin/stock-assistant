import axios from 'axios';
import { DarkTradeTextQueryService } from './darktrade-text-query.service';
import { DarkTradeService } from './darktrade.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DarkTradeTextQueryService', () => {
  const originalEnv = { ...process.env };
  const getDailyResultByName = jest.fn();
  const darkTradeService = { getDailyResultByName } as unknown as DarkTradeService;
  const service = new DarkTradeTextQueryService(darkTradeService);

  beforeEach(() => {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    jest.clearAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(0.7);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('extracts distinct names then reuses the daily-result query for every candidate', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [
          { message: { content: '```json\n{"names":["贵州茅台","宁德时代","贵州茅台"]}\n```' } },
        ],
      },
    });
    const maotai = { code: '600519', name: '贵州茅台', displayName: '贵州mt' };
    getDailyResultByName.mockResolvedValueOnce(maotai).mockResolvedValueOnce(null);

    await expect(service.query('看看贵州茅台和宁德时代', '20260729')).resolves.toEqual({
      names: ['贵州茅台', '宁德时代'],
      results: [maotai],
      notFoundNames: ['宁德时代'],
      summarySuffix: '[吃瓜R]',
    });
    expect(getDailyResultByName).toHaveBeenNthCalledWith(1, '贵州茅台', '20260729');
    expect(getDailyResultByName).toHaveBeenNthCalledWith(2, '宁德时代', '20260729');
  });
});
