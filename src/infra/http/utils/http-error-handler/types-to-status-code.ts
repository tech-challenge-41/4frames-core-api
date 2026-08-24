import { DomainErrorTypes } from '@/domain/error/error-types';

type TypesToStatusCode = Record<DomainErrorTypes, number>;

export const typesToStatusCode: TypesToStatusCode = {
  [DomainErrorTypes.INVALID_ARGUMENT]: 400,
  [DomainErrorTypes.NOT_FOUND]: 404,
  [DomainErrorTypes.CONFLICT]: 409,
  [DomainErrorTypes.INVALID_STATE]: 422,
  [DomainErrorTypes.PRECONDITION_FAILED]: 412,
  [DomainErrorTypes.VALIDATION_ERROR]: 422
};
