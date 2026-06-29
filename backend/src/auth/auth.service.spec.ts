import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let watchListsService: { migrateLegacyData: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve({ id: 1, ...data })),
    };
    watchListsService = { migrateLegacyData: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    service = new AuthService(userRepo as any, watchListsService as any);
  });

  describe('password hashing', () => {
    it('verifies a correct password and rejects a wrong one', () => {
      const stored = service.hashPassword('asdfasdf');
      expect(service.verifyPassword('asdfasdf', stored)).toBe(true);
      expect(service.verifyPassword('wrong', stored)).toBe(false);
    });

    it('produces a salted hash (different output each call)', () => {
      expect(service.hashPassword('x')).not.toEqual(service.hashPassword('x'));
    });
  });

  describe('token sign/verify', () => {
    it('round-trips a user through a signed token', () => {
      const token = service.signToken({ id: 7, username: 'ljj' });
      expect(service.verifyToken(token)).toEqual({ id: 7, username: 'ljj' });
    });

    it('rejects a tampered token', () => {
      const token = service.signToken({ id: 7, username: 'ljj' });
      expect(() => service.verifyToken(token + 'x')).toThrow(UnauthorizedException);
    });

    it('rejects a malformed token', () => {
      expect(() => service.verifyToken('not-a-token')).toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      const passwordHash = service.hashPassword('asdfasdf');
      userRepo.findOne.mockResolvedValue({ id: 1, username: 'ljj', passwordHash });

      const result = await service.login('ljj', 'asdfasdf');

      expect(result.user).toEqual({ id: 1, username: 'ljj' });
      expect(service.verifyToken(result.token)).toEqual({ id: 1, username: 'ljj' });
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      const passwordHash = service.hashPassword('asdfasdf');
      userRepo.findOne.mockResolvedValue({ id: 1, username: 'ljj', passwordHash });

      await expect(service.login('ljj', 'nope')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login('ghost', 'x')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('onModuleInit', () => {
    it('seeds the built-in account and migrates legacy data', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await service.onModuleInit();

      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ username: 'ljj' }));
      expect(watchListsService.migrateLegacyData).toHaveBeenCalledWith(1);
    });

    it('does not recreate the account when it already exists', async () => {
      userRepo.findOne.mockResolvedValue({ id: 5, username: 'ljj', passwordHash: 'x' });

      await service.onModuleInit();

      expect(userRepo.save).not.toHaveBeenCalled();
      expect(watchListsService.migrateLegacyData).toHaveBeenCalledWith(5);
    });
  });
});
