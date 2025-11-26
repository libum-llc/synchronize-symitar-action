import { validateApiKey, AuthenticationError, ConnectionError } from '../src/subscription';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('subscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateApiKey', () => {
    it('should throw AuthenticationError when API key is empty', async () => {
      await expect(validateApiKey('')).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError when API key is whitespace only', async () => {
      await expect(validateApiKey('   ')).rejects.toThrow(AuthenticationError);
    });

    it('should successfully validate a valid API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: '123', status: 'active' }],
        }),
      });

      await expect(validateApiKey('valid-api-key')).resolves.not.toThrow();
    });

    it('should throw AuthenticationError when API key is not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: false,
          subscriptions: [],
        }),
      });

      await expect(validateApiKey('invalid-api-key')).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError when no subscriptions exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [],
        }),
      });

      await expect(validateApiKey('api-key-no-subs')).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError on HTTP error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(validateApiKey('bad-api-key')).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError on invalid response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invalid: 'response',
        }),
      });

      await expect(validateApiKey('api-key')).rejects.toThrow(AuthenticationError);
    });

    it('should retry on network failure and throw ConnectionError after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(validateApiKey('api-key')).rejects.toThrow(ConnectionError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // MAX_API_RETRIES = 3
    }, 15000);
  });

  describe('AuthenticationError', () => {
    it('should contain apiKey and host properties', () => {
      const error = new AuthenticationError('test message', 'test-key', 'test-host');
      expect(error.message).toBe('test message');
      expect(error.apiKey).toBe('test-key');
      expect(error.host).toBe('test-host');
      expect(error.name).toBe('AuthenticationError');
    });
  });

  describe('ConnectionError', () => {
    it('should contain host, port, isSSL, and originalError properties', () => {
      const originalError = new Error('original');
      const error = new ConnectionError('test message', 'test-host', 443, true, originalError);
      expect(error.message).toBe('test message');
      expect(error.host).toBe('test-host');
      expect(error.port).toBe(443);
      expect(error.isSSL).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error.name).toBe('ConnectionError');
    });
  });
});
