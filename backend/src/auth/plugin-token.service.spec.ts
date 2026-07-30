import { HttpException, UnauthorizedException } from '@nestjs/common';
import { PluginTokenService } from './plugin-token.service';

describe('PluginTokenService', () => {
  const repo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const service = new PluginTokenService(repo as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects revoked or expired tokens', async () => {
    repo.findOne.mockResolvedValue({ id: 1, revokedAt: new Date(), expiresAt: null });
    await expect(service.verifyForDarkTradeQuery('xhs_test')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('limits each token to 60 requests per minute', async () => {
    repo.findOne.mockResolvedValue({ id: 88, revokedAt: null, expiresAt: null });
    repo.update.mockResolvedValue({ affected: 1 });
    for (let index = 0; index < 60; index += 1) {
      await expect(service.verifyForDarkTradeQuery('xhs_rate-limit')).resolves.toBeUndefined();
    }
    await expect(service.verifyForDarkTradeQuery('xhs_rate-limit')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
