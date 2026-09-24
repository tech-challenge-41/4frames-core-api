import { InvalidRequestParamError } from '@/application/error/invalid-request-param-error';

import {
  DEFAULT_LIST_VIDEO_JOBS_LIMIT,
  MAX_LIST_VIDEO_JOBS_LIMIT,
  parseListVideoJobsQuery
} from '../list-video-jobs.validator';

describe('parseListVideoJobsQuery', () => {
  it('should default limit and offset when the query is empty', () => {
    expect(parseListVideoJobsQuery({})).toEqual({ limit: DEFAULT_LIST_VIDEO_JOBS_LIMIT, offset: 0 });
  });

  it('should coerce string query values to numbers', () => {
    expect(parseListVideoJobsQuery({ limit: '10', offset: '5' })).toEqual({ limit: 10, offset: 5 });
  });

  it('should accept the maximum allowed limit', () => {
    expect(parseListVideoJobsQuery({ limit: String(MAX_LIST_VIDEO_JOBS_LIMIT) })).toEqual({
      limit: MAX_LIST_VIDEO_JOBS_LIMIT,
      offset: 0
    });
  });

  it.each([{ limit: '0' }, { limit: '-1' }, { limit: String(MAX_LIST_VIDEO_JOBS_LIMIT + 1) }, { limit: 'abc' }])(
    'should throw InvalidRequestParamError (400) for invalid limit %p',
    query => {
      expect(() => parseListVideoJobsQuery(query)).toThrow(InvalidRequestParamError);
    }
  );

  it.each([{ offset: '-1' }, { offset: 'abc' }])(
    'should throw InvalidRequestParamError (400) for invalid offset %p',
    query => {
      expect(() => parseListVideoJobsQuery(query)).toThrow(InvalidRequestParamError);
    }
  );
});
