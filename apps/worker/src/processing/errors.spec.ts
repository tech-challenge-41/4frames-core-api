import { failureMetricReason, FAILURE_REASONS } from './errors';

describe('failureMetricReason', () => {
  it.each([
    [FAILURE_REASONS.invalidVideo, 'invalid_video'],
    [FAILURE_REASONS.noVideoStream, 'no_video_stream'],
    [FAILURE_REASONS.unsupportedFormat, 'unsupported_format'],
    [FAILURE_REASONS.unknownDuration, 'unknown_duration'],
    [FAILURE_REASONS.noFrames, 'no_frames'],
    [FAILURE_REASONS.sourceNotFound, 'source_not_found'],
    [FAILURE_REASONS.retriesExhausted, 'retries_exhausted']
  ])('should turn "%s" into %s', (reason, code) => {
    expect(failureMetricReason(reason)).toBe(code);
  });

  it('should give every duration of a video that is too long the same code', () => {
    expect(failureMetricReason(FAILURE_REASONS.tooLong(600.5, 600))).toBe('too_long');
    expect(failureMetricReason(FAILURE_REASONS.tooLong(3601, 600))).toBe('too_long');
  });

  it('should use other for a reason outside the list', () => {
    expect(failureMetricReason('Erro inesperado')).toBe('other');
  });
});
