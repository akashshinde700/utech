'use strict';

// Tiny Zod-validation middleware factory.
// Usage: router.post('/', validate(schema), handler)
module.exports = function validate(schema, source = 'body') {
  return function (req, _res, next) {
    const data = req[source];
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return next(parsed.error);
    }
    req[source] = parsed.data;
    return next();
  };
};
