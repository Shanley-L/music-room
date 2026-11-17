import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export function validationMiddleware(type) {
  return async (req, res, next) => {
    const dtoObj = plainToInstance(type, req.body);
    const errors = await validate(dtoObj, { whitelist: true, forbidNonWhitelisted: true });

    if (errors.length > 0) {
      const details = errors.map(err => Object.values(err.constraints || {}).join(', '));
      return res.status(400).json({ error: 'Validation failed', details });
    }

    req.body = dtoObj;
    next();
  };
}