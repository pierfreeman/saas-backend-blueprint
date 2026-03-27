import { AllExceptionsFilter } from './all-exceptions.filter';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Mock, vi } from 'vitest';

function makeHost(
  method = 'GET',
  url = '/test',
): { host: ArgumentsHost; json: Mock; status: Mock } {
  const json = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusFn }),
      getRequest: () => ({ method, url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status: statusFn };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('handles HttpException and returns its status code', () => {
    const { host, status, json } = makeHost('POST', '/orgs');
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Not found',
        path: '/orgs',
        method: 'POST',
      }),
    );
  });

  it('defaults to 500 for non-HttpException errors', () => {
    const { host, status } = makeHost();
    filter.catch(new Error('Unexpected boom'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('includes timestamp in the response body', () => {
    const { host, json } = makeHost();
    filter.catch(new HttpException('oops', 400), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(String) }),
    );
  });

  it('unwraps nested message from HttpException response object', () => {
    const { host, json } = makeHost();
    const exception = new HttpException(
      { message: 'Validation failed', error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation failed' }),
    );
  });

  it('handles non-Error exceptions (string throw)', () => {
    const { host, status } = makeHost();
    filter.catch('raw string error', host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('does not log WARN for silent browser paths (favicon)', () => {
    const { host } = makeHost('GET', '/favicon.ico');
    const warnSpy = vi
      .spyOn(filter['logger'], 'warn')
      .mockImplementation(() => undefined);
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs ERROR with stack for 5xx exceptions', () => {
    const { host } = makeHost('GET', '/crash');
    const errorSpy = vi
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined);
    filter.catch(new Error('boom'), host);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('500'),
      expect.stringContaining('boom'),
    );
  });
});
