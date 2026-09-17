import authUserSchema from '../auth-user.validator';

describe('AuthUserValidator', () => {
  it('should validate valid auth user data', () => {
    const validData = {
      email: 'test@example.com',
      password: 'password123'
    };

    const result = authUserSchema.safeParse(validData);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(validData);
  });

  it('should reject invalid email', () => {
    const invalidData = {
      email: 'not-an-email',
      password: 'password123'
    };

    const result = authUserSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Email inválido');
  });

  it('should reject password shorter than 6 characters', () => {
    const invalidData = {
      email: 'test@example.com',
      password: '12345'
    };

    const result = authUserSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Senha deve ter ao menos 6 caracteres');
  });

  it('should reject password longer than 30 characters', () => {
    const invalidData = {
      email: 'test@example.com',
      password: 'a'.repeat(31)
    };

    const result = authUserSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Senha deve ter no máximo 30 caracteres');
  });

  it('should reject non-string password', () => {
    const invalidData = {
      email: 'test@example.com',
      password: 123456
    };

    const result = authUserSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Senha deve ser uma string');
  });
});
