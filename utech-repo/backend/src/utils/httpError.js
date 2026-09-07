'use strict';
class HttpError extends Error {
  constructor(statusCode, message, name = 'HttpError') {
    super(message);
    this.statusCode = statusCode;
    this.name = name;
  }
}
module.exports = HttpError;
