import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import debounce from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution', () => {
    const callback = vi.fn();
    const debounced = debounce(callback, 200);

    debounced('hello');
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledWith('hello');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('only executes the last call within the time window', () => {
    const callback = vi.fn();
    const debounced = debounce(callback, 200);

    debounced('first');
    vi.advanceTimersByTime(100);

    debounced('second');
    vi.advanceTimersByTime(150);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('second');
  });
});
