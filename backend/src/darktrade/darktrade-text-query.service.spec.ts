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

    const result = await service.query('看看贵州茅台和宁德时代', '20260729');

    expect(result).toMatchObject({
      names: ['贵州茅台', '宁德时代'],
      results: [maotai],
      notFoundNames: ['宁德时代'],
    });
    expect(result.summary).toBe(`贵州mt，暗--，明--${result.summarySuffix}`);
    expect(getDailyResultByName).toHaveBeenNthCalledWith(1, '贵州茅台', '20260729');
    expect(getDailyResultByName).toHaveBeenNthCalledWith(2, '宁德时代', '20260729');
  });

  it('extracts six-digit stock codes from the original text before querying model candidates', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { choices: [{ message: { content: '{"names":["伊戈尔"]}' } }] },
    });
    const yig = { code: '002922', name: '伊戈尔', displayName: '伊ge' };
    getDailyResultByName.mockResolvedValueOnce(yig).mockResolvedValueOnce(yig);

    await expect(service.query('002922 和伊戈尔', '20260729')).resolves.toMatchObject({
      names: ['002922', '伊戈尔'],
      results: [yig],
      notFoundNames: [],
    });
    expect(getDailyResultByName).toHaveBeenNthCalledWith(1, '002922', '20260729');
  });

  it('queries a code-only input without requiring the LLM service', async () => {
    const yig = { code: '002922', name: '伊戈尔', displayName: '伊ge' };
    getDailyResultByName.mockResolvedValue(yig);

    await expect(service.query('002922', '20260729')).resolves.toMatchObject({
      names: ['002922'],
      results: [yig],
      notFoundNames: [],
    });
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
    expect(getDailyResultByName).toHaveBeenCalledWith('002922', '20260729');
  });
});
