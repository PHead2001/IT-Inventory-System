export class InvalidFileContentError extends Error {
  readonly code = 'INVALID_FILE_CONTENT';

  constructor(message = 'The uploaded file content could not be validated.') {
    super(message);
    this.name = 'InvalidFileContentError';
  }
}
